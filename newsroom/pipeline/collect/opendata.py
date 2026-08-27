"""Tier A open-data collectors — the sources we write original analysis from.

Each collector turns a public API response into
:class:`~newsroom.pipeline.detect.series.TimeSeries` objects. Nothing here
interprets the data; interpretation is stage 2's job and is deterministic.

Only sources registered in ``newsroom/sources.yaml`` are reachable from here —
the registry lookup is what supplies the endpoint, the licence and the
attribution that ends up in the article's provenance block.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Sequence

from newsroom.pipeline.collect.httpclient import CollectorHttp
from newsroom.pipeline.detect.series import (
    COLLECTED_GEOGRAPHIES,
    SUBJECT_GEOGRAPHIES,
    Observation,
    TimeSeries,
)
from newsroom.pipeline.models import SourceRef, isoformat, utcnow
from newsroom.pipeline.safety import registry

log = logging.getLogger(__name__)

#: The three states this wire reports on. Re-exported from the detection layer
#: so the collector, the detectors and the context builder cannot disagree
#: about who is a subject and who is a denominator.
BALTIC = SUBJECT_GEOGRAPHIES


# ---------------------------------------------------------------------------
# Eurostat (JSON-stat 2.0)
# ---------------------------------------------------------------------------
class EurostatDataset:
    """A single Eurostat dataset and how to read it as a per-country series."""

    def __init__(
        self,
        *,
        dataset: str,
        metric: str,
        metric_label: str,
        unit: str,
        section: str,
        params: dict[str, str],
        frequency: str = "monthly",
        chart_ref: str | None = None,
        periods: int = 60,
        geo_dimension: str = "geo",
        geographies: Sequence[str] | None = None,
    ) -> None:
        self.dataset = dataset
        self.metric = metric
        self.metric_label = metric_label
        self.unit = unit
        self.section = section
        self.params = params
        self.frequency = frequency
        self.chart_ref = chart_ref
        self.periods = periods
        #: Which dimension carries the geography. Almost always ``geo`` — but
        #: the maritime cubes are one dataset per country and key their
        #: territorial axis on ``rep_mar`` (reporting port), where the country's
        #: own code means "all ports in this country". A collector that assumes
        #: ``geo`` reads those as having no geography at all and drops every
        #: observation, which is why the newsroom had no maritime series while
        #: the dashboard published three panels of them.
        self.geo_dimension = geo_dimension
        #: Values to request on that dimension, or ``()`` when the dataset
        #: pins its own in ``params``. ``None`` means the collector's default.
        self.geographies = tuple(geographies) if geographies is not None else None


def request_params(
    spec: EurostatDataset, geographies: Sequence[str] = COLLECTED_GEOGRAPHIES
) -> list[tuple[str, str]]:
    """The query as actually sent. One definition, because two would drift.

    The cache is keyed on this, and several definitions read the same cube and
    differ only here — ``bop_c6_q`` backs ten of them, ``prc_hicp_minr``
    eight. A key that misses one of these pairs serves one metric's payload
    under another's name, which is how five articles published real Eurostat
    figures attached to metrics they never measured.

    ``test_no_two_datasets_can_collide_on_a_key`` asserts no two specs produce
    the same key. It used to rebuild this list itself, and had already drifted:
    it hardcoded the three Baltic states while the collector's default had
    become ``COLLECTED_GEOGRAPHIES``. It made no difference to the outcome,
    which is exactly why nobody noticed — a guard must read the same object
    the behaviour reads, or it is checking a copy of the code rather than the
    code.
    """
    # A dataset that pins its own territorial axis asks for none here. Sending
    # geo=LV to a per-country maritime cube that has no geo dimension is an
    # HTTP 400, not an empty series.
    requested = spec.geographies if spec.geographies is not None else geographies
    return [
        ("format", "JSON"),
        ("lang", "EN"),
        ("lastTimePeriod", str(spec.periods)),
        *spec.params.items(),
        *[(spec.geo_dimension, geo) for geo in requested],
    ]


EUROSTAT_DATASETS: tuple[EurostatDataset, ...] = (
    EurostatDataset(
        dataset="une_rt_m",
        metric="unemployment_rate",
        metric_label="unemployment rate",
        unit="% of the labour force",
        section="labour",
        frequency="monthly",
        chart_ref="unemployment",
        params={"s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT"},
    ),
    EurostatDataset(
        # ECOICOP ver.2. The ver.1 tables (prc_hicp_manr and friends) were
        # frozen on 2026-02-06 with 2025-12 as their last period, and they still
        # answer HTTP 200 and still list all 467 old codes — so nothing failed,
        # nothing logged, and the newsroom went on reading December 2025 as
        # though it were this month's inflation. api/shared/indicators.js was
        # migrated for the dashboard in #60; this copy was not, which is the
        # drift test_collector_matches_dashboard.py now exists to prevent.
        #
        # ver.2 renames the dimension coicop -> coicop18, renames all-items
        # CP00 -> TOTAL, and folds the index and the rates of change into one
        # cube, so unit must be pinned to RCH_A to get the annual rate that
        # prc_hicp_manr used to return on its own.
        dataset="prc_hicp_minr",
        metric="hicp_annual_rate",
        metric_label="annual consumer price inflation (HICP)",
        unit="%",
        section="economy",
        frequency="monthly",
        chart_ref="inflation",
        params={"coicop18": "TOTAL", "unit": "RCH_A"},
    ),
    # --- Added coverage -----------------------------------------------------
    # The newsroom read two series while the dashboard already published
    # thirty. That is why the wire ran to one original article: detection can
    # only find what collection fetched, and nothing below lowers the quality
    # floor. Every dataset and parameter string here is copied from
    # api/shared/indicators.js, which PR #18 verified against live Eurostat,
    # so these return real Baltic observations rather than empty series.
    EurostatDataset(
        dataset="sts_trtu_m",
        metric="retail_turnover",
        metric_label="retail trade volume",
        unit="% year on year",
        section="economy",
        frequency="monthly",
        chart_ref="retail",
        params={"nace_r2": "G47", "indic_bt": "VOL_SLS", "s_adj": "CA", "unit": "PCH_SM"},
    ),
    EurostatDataset(
        dataset="sts_inpr_m",
        metric="industrial_production",
        metric_label="industrial production",
        unit="% month on month",
        section="economy",
        frequency="monthly",
        chart_ref="industrial",
        params={"nace_r2": "B-D", "indic_bt": "PRD", "s_adj": "SCA", "unit": "PCH_PRE"},
    ),
    EurostatDataset(
        dataset="sts_inpp_m",
        metric="producer_prices",
        metric_label="producer prices",
        unit="% month on month",
        section="economy",
        frequency="monthly",
        chart_ref="ppi",
        params={"nace_r2": "B-D", "s_adj": "NSA", "unit": "PCH_PRE"},
    ),
    EurostatDataset(
        dataset="ei_bssi_m_r2",
        metric="economic_sentiment",
        metric_label="economic sentiment indicator",
        # No digits in a unit. ``unit`` is interpolated into ``comparison_basis``,
        # which is pipeline-authored prose the writer is REQUIRED to restate — so
        # "index (long-run average = 100)" put a bare 100 into every basis this
        # series produced, with no field able to declare it. The article was then
        # rejected for a numeral the pipeline wrote itself. The base is a
        # property of the index, not of this reading, and it belongs on the chart
        # axis rather than in every sentence.
        unit="index points",
        section="economy",
        frequency="monthly",
        chart_ref="economic_sentiment",
        params={"indic": "BS-ESI-I", "s_adj": "SA"},
    ),
    EurostatDataset(
        dataset="prc_hpi_q",
        metric="house_prices",
        metric_label="house prices",
        unit="% year on year",
        section="property",
        frequency="quarterly",
        chart_ref="house_prices",
        params={"purchase": "TOTAL", "unit": "RCH_A"},
        periods=40,
    ),
    EurostatDataset(
        dataset="namq_10_gdp",
        metric="gdp_growth",
        metric_label="GDP",
        unit="% quarter on quarter",
        section="economy",
        frequency="quarterly",
        chart_ref="gdp",
        params={"unit": "CLV_PCH_PRE", "s_adj": "SCA", "na_item": "B1GQ"},
        periods=40,
    ),
    EurostatDataset(
        dataset="sts_copr_q",
        metric="construction_output",
        metric_label="construction output",
        unit="% quarter on quarter",
        section="property",
        frequency="quarterly",
        chart_ref="construction",
        params={"nace_r2": "F", "indic_bt": "PRD", "s_adj": "SCA", "unit": "PCH_PRE"},
        periods=40,
    ),
    EurostatDataset(
        dataset="lc_lci_lev",
        metric="hourly_labour_cost",
        metric_label="hourly labour cost",
        unit="EUR per hour",
        section="labour",
        frequency="annual",
        chart_ref="salary",
        params={"lcstruct": "D1_D4_MD5", "unit": "EUR", "nace_r2": "B-S_X_O"},
        periods=20,
    ),
    # --- External balances --------------------------------------------------
    # The newsroom read no trade series at all, so the widest divergence in the
    # Baltic external accounts was invisible to detection: Latvia's goods and
    # services balance has been negative for most of two decades while
    # Lithuania's ran a growing surplus, and nothing in the pipeline could see
    # it because collection never fetched the series.
    #
    # The split is registered as well as the total, because the total hides the
    # finding. All three states run a goods deficit of a broadly similar size —
    # in 2025, 9.2% of GDP in Latvia against 8.0% in Lithuania and 6.6% in
    # Estonia — and the entire difference between a negative Latvian headline
    # and a positive Lithuanian one sits in services. A detector reading only
    # the combined figure would report the divergence and could never locate
    # it; reading the four component balances, it can.
    #
    # 60 quarters, not the 40 used elsewhere, because structural divergence is
    # measured against the start of the series and 10 years is not long enough
    # to contain this one.
    EurostatDataset(
        dataset="bop_c6_q",
        metric="trade_balance",
        metric_label="the goods and services balance",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        chart_ref="trade_balance",
        params={"freq": "Q", "bop_item": "GS", "stk_flow": "BAL", "partner": "WRL_REST",
                "currency": "MIO_EUR", "sectpart": "S1", "sector10": "S1"},
        periods=60,
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="goods_balance",
        metric_label="the goods balance",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        chart_ref="goods_balance",
        params={"freq": "Q", "bop_item": "G", "stk_flow": "BAL", "partner": "WRL_REST",
                "currency": "MIO_EUR", "sectpart": "S1", "sector10": "S1"},
        periods=60,
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="services_balance",
        metric_label="the services balance",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        chart_ref="services_balance",
        params={"freq": "Q", "bop_item": "S", "stk_flow": "BAL", "partner": "WRL_REST",
                "currency": "MIO_EUR", "sectpart": "S1", "sector10": "S1"},
        periods=60,
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="transport_services_balance",
        metric_label="the transport services balance",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        chart_ref="transport_services",
        params={"freq": "Q", "bop_item": "SC", "stk_flow": "BAL", "partner": "WRL_REST",
                "currency": "MIO_EUR", "sectpart": "S1", "sector10": "S1"},
        periods=60,
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="financial_services_balance",
        metric_label="the financial services balance",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        chart_ref="financial_services",
        params={"freq": "Q", "bop_item": "SG", "stk_flow": "BAL", "partner": "WRL_REST",
                "currency": "MIO_EUR", "sectpart": "S1", "sector10": "S1"},
        periods=60,
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="ict_services_balance",
        metric_label="the telecommunications, computer and information services balance",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        chart_ref="ict_services",
        params={"freq": "Q", "bop_item": "SI", "stk_flow": "BAL", "partner": "WRL_REST",
                "currency": "MIO_EUR", "sectpart": "S1", "sector10": "S1"},
        periods=60,
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="other_business_services_balance",
        metric_label="the other business services balance",
        unit="million EUR",
        section="trade",
        frequency="quarterly",
        chart_ref="other_business_services",
        params={"freq": "Q", "bop_item": "SJ", "stk_flow": "BAL", "partner": "WRL_REST",
                "currency": "MIO_EUR", "sectpart": "S1", "sector10": "S1"},
        periods=60,
    ),
    # --- Maritime -----------------------------------------------------------
    # The maritime beat had a correspondent, a section, a persona and a place on
    # the masthead, and had never published, because nothing here ever fetched a
    # maritime series. The dashboard has read these same cubes since #40.
    #
    # Three datasets rather than one: Eurostat splits port statistics by country
    # (`mar_go_qm_lv`, `_ee`, `_lt`) instead of carrying a geo dimension, and
    # keys the territorial axis on `rep_mar` — the reporting port — where the
    # country's own code means "every port in this country". Hence
    # `geo_dimension` and the empty `geographies`: asking these cubes for
    # geo=LV is an HTTP 400.
    #
    # `cargo=TOTAL` deliberately. Latvia publishes 36 cargo categories and
    # Lithuania a similar number, but ESTONIA PUBLISHES ONLY THE TOTAL, so a
    # composition series would give two countries a breakdown and the third an
    # empty series — and `detect_divergence` needs all three to compare. The
    # composition story is real and worth having; it needs its own handling for
    # the asymmetry rather than being smuggled in here.
    #
    # AND DO NOT ADD PASSENGERS WITHOUT READING THIS. `mar_pa_qm_lv` looks like
    # the obvious companion series and it is a trap. Riga stopped filing
    # passenger returns after 2021-Q4 — the last four quarters it reported are
    # literal zeroes, and the cube queried entirely unpinned returns no non-null
    # cell for it since. So Latvia's *national* passenger total has been exactly
    # equal to Ventspils since 2022-Q1.
    #
    # Every gate here would pass a sentence built on that. "Latvian sea
    # passengers fell to X" is traceable, uninvented, and correctly compared —
    # and is a statement about one port presented as a statement about a
    # country. Set against Estonia's whole coastline it is not a comparison at
    # all. The API marks such ports `discontinued`, so the asymmetry is
    # readable rather than something to infer; a passenger series has to carry
    # it explicitly or not exist.
    #
    # 48 quarters, verified live: LV and EE run 2014-Q1..2025-Q4 and LT to
    # 2026-Q1. The two-quarter publication lag is inherent to the source, so
    # this beat is analysis rather than breaking news — roughly four stories a
    # year, which is what the data supports.
    *(
        EurostatDataset(
            dataset=f"mar_go_qm_{country.lower()}",
            metric="port_goods_throughput",
            metric_label="seaborne goods handled in the country's ports",
            unit="thousand tonnes",
            section="maritime",
            frequency="quarterly",
            # No chart. The dashboard DOES publish these series, but through
            # api/shared/ports.js, which is not an /api/baltic-compare
            # indicator — there is no `port_goods` id and a ref naming one would
            # 404 and render the empty "Live data" panel chart-ref.ts exists to
            # prevent. A maritime article therefore carries no chart until a
            # port indicator exists on the API side, which is not this
            # package's to add. Absent is honest; dangling is not.
            chart_ref=None,
            params={
                "freq": "Q",
                "direct": "TOTAL",
                "cargo": "TOTAL",
                "unit": "THS_T",
                "par_mar": "TOTAL",
                "rep_mar": country,
            },
            periods=48,
            geo_dimension="rep_mar",
            geographies=(),
        )
        for country in BALTIC
    ),
    # --- Maritime, by cargo type --------------------------------------------
    # Total throughput moves slowly and says little; the story is which cargo
    # moved. "Dry bulk at Klaipeda: the highest third quarter since before the
    # pandemic" is a piece, and it needs the composition rather than the total.
    #
    # LATVIA AND LITHUANIA ONLY, and this is the asymmetry that has to be
    # explicit rather than discovered. Estonia publishes `cargo=TOTAL` and
    # nothing else: the cube answers HTTP 200 for `cargo=DBK`, returns all 48
    # quarters in its time dimension, and carries ZERO values in them — checked
    # live for DBK, LBK and LCNT. Nothing errors. `parse_jsonstat` drops a
    # series with no observations, so Estonia contributes no series at all
    # rather than an empty one, which is the safe outcome; asking for it anyway
    # would spend three requests a run to learn that again.
    #
    # A consequence worth stating: `detect_divergence` needs three geographies
    # and will therefore never fire on a cargo category. That is correct, not a
    # gap. The composition story is a single-port one — a record, a run, a
    # seasonal departure — and ranking folds the Latvian and Lithuanian
    # readings of one category into one article anyway.
    #
    # Four categories, not the six that partition the total. `RO_MNSP` is a
    # technical split of ro-ro traffic and `OTH` is the residual bucket; a
    # record high in "other cargo" is not a story, and both would consume wire
    # capacity that the four real ones deserve.
    *(
        EurostatDataset(
            dataset=f"mar_go_qm_{country.lower()}",
            metric=f"port_goods_{slug}",
            metric_label=f"seaborne {label} handled in the country's ports",
            unit="thousand tonnes",
            section="maritime",
            frequency="quarterly",
            # Same reason as the total above: there is no port indicator on
            # /api/baltic-compare to point at.
            chart_ref=None,
            params={
                "freq": "Q",
                "direct": "TOTAL",
                "cargo": code,
                "unit": "THS_T",
                "par_mar": "TOTAL",
                "rep_mar": country,
            },
            periods=48,
            geo_dimension="rep_mar",
            geographies=(),
        )
        for country in ("LV", "LT")
        for code, slug, label in (
            ("LBK", "liquid_bulk", "liquid bulk"),
            ("DBK", "dry_bulk", "dry bulk"),
            ("LCNT", "containers", "containerised cargo"),
            ("RO_MSP", "roro", "roll-on/roll-off freight"),
        )
    ),
    # --- Business demography ------------------------------------------------
    # `business` routed to a correspondent who could never file: personas.yaml
    # assigns the beat, and no series anywhere in the pipeline carried
    # section="business". A masthead naming a correspondent who has never
    # published and structurally cannot is worse than a masthead with one fewer
    # name on it.
    #
    # `sts_rb_q` closes it. Verified live: registrations and bankruptcies for
    # all three countries, 24 quarters with no gaps, through 2026-Q2 — the
    # freshest series the newsroom reads, fresher than trade or property.
    #
    # Indexed (2021=100) rather than a rate of change, because an index is what
    # `detect_record_extreme` and `detect_streak` can say something about: "the
    # most bankruptcies in any quarter since the series began" is a story, and
    # "bankruptcies rose 3% on the quarter" is a number.
    EurostatDataset(
        dataset="sts_rb_q",
        metric="business_registrations",
        metric_label="new business registrations",
        unit="index points",
        section="business",
        frequency="quarterly",
        chart_ref="business_registrations",
        params={"freq": "Q", "indic_bt": "REG", "nace_r2": "B-S_X_O_S94",
                "s_adj": "SCA", "unit": "I21"},
        periods=40,
    ),
    EurostatDataset(
        dataset="sts_rb_q",
        metric="business_bankruptcies",
        metric_label="business bankruptcy declarations",
        unit="index points",
        section="business",
        frequency="quarterly",
        chart_ref="bankruptcies",
        params={"freq": "Q", "indic_bt": "BKRT", "nace_r2": "B-S_X_O_S94",
                "s_adj": "SCA", "unit": "I21"},
        periods=40,
    ),
    # --- Environment --------------------------------------------------------
    # The last silent section, and the only one whose silence was a collection
    # gap rather than a ranking one.
    #
    # NOT Open-Meteo, which is what the dashboard uses. It serves history on
    # demand and the app stores nothing, so a detector cannot say "the warmest
    # August since" without refetching years of hourly readings on every check.
    # Doing it properly needs a timer-triggered aggregation into durable
    # storage, which is real new infrastructure. The caching layer added for
    # the dashboard in #86 does not help: it is a per-process `Map` inside the
    # Static Web App's managed functions, holding one hourly reading, in a
    # different app from this one.
    #
    # Quarterly air emissions accounts need none of that. Verified live: 40
    # quarters for all three countries, 120 values with no gaps, through
    # 2026-Q1 — deep enough for a record, a run or a seasonal departure to mean
    # something.
    #
    # `TOTAL_HH` and nothing finer, because there is nothing finer to have: the
    # cube lists ten NACE breakdowns and every one of them returns 40 periods
    # and ZERO values for the Baltics, on both the adjusted and unadjusted
    # slice. A sector series would look like a working configuration and fetch
    # nothing, which is the same trap as Estonian cargo.
    #
    # Params copied from the dashboard's `ghg_emissions` exactly, so the drift
    # check can compare them and the article's chart resolves.
    EurostatDataset(
        dataset="env_ac_aigg_q",
        metric="ghg_emissions",
        metric_label="greenhouse gas emissions",
        # Spelled out, not "CO2 equivalent". The unit is interpolated into the
        # comparison basis, which the writer is required to restate, so the 2
        # in CO2 would arrive in the prose as a bare numeral with no field able
        # to declare it — and the article would die for it. Caught by
        # TestNoUnitCarriesANumeral, which exists because
        # "index (long-run average = 100)" did exactly this.
        unit="thousand tonnes of carbon dioxide equivalent",
        section="environment",
        frequency="quarterly",
        chart_ref="ghg_emissions",
        params={"freq": "Q", "s_adj": "SA", "nace_r2": "TOTAL_HH",
                "airpol": "GHG", "unit": "THS_T"},
        periods=40,
    ),

    # ── Mirrored from api/shared/indicators.js ───────────────────────────
    # Session A live-verified every definition below in #141: per-country
    # coverage, cadence, lag, and conformance to its own sanity band, with
    # zero `assumptions` across the set. The dataset, the pinned dimensions
    # and the chart_ref are theirs and are checked against the dashboard by
    # `test_collector_matches_dashboard.py` on every run. The section, unit
    # and metric_label are the newsroom's: a section must be a real
    # DashboardSection or the article's "check it yourself" link points at
    # nothing, and a unit has to read inside a sentence rather than on an axis.
    EurostatDataset(
        dataset="sdg_08_10",
        metric="gdp_per_capita",
        metric_label="GDP per capita",
        unit="EUR per person",
        section="economy",
        frequency="annual",
        chart_ref="gdp_per_capita",
        periods=20,
        params={'na_item': 'B1GQ', 'unit': 'CLV20_EUR_HAB'},
    ),
    EurostatDataset(
        dataset="prc_hicp_minr",
        metric="energy_inflation",
        metric_label="energy inflation",
        unit="% change on a year earlier",
        section="economy",
        frequency="monthly",
        chart_ref="energy_inflation",
        periods=60,
        params={'coicop18': 'NRG', 'unit': 'RCH_A'},
    ),
    EurostatDataset(
        dataset="prc_hicp_minr",
        metric="food_inflation",
        metric_label="food inflation",
        unit="% change on a year earlier",
        section="economy",
        frequency="monthly",
        chart_ref="food_inflation",
        periods=60,
        params={'coicop18': 'FOOD', 'unit': 'RCH_A'},
    ),
    EurostatDataset(
        dataset="prc_hicp_minr",
        metric="core_inflation",
        metric_label="core inflation",
        unit="% change on a year earlier",
        section="economy",
        frequency="monthly",
        chart_ref="core_inflation",
        periods=60,
        params={'coicop18': 'TOT_X_NRG_FOOD', 'unit': 'RCH_A'},
    ),
    EurostatDataset(
        dataset="prc_hicp_minr",
        metric="services_inflation",
        metric_label="services inflation",
        unit="% change on a year earlier",
        section="economy",
        frequency="monthly",
        chart_ref="services_inflation",
        periods=60,
        params={'coicop18': 'SERV', 'unit': 'RCH_A'},
    ),
    EurostatDataset(
        dataset="prc_hicp_minr",
        metric="goods_inflation",
        metric_label="goods inflation",
        unit="% change on a year earlier",
        section="economy",
        frequency="monthly",
        chart_ref="goods_inflation",
        periods=60,
        params={'coicop18': 'GD', 'unit': 'RCH_A'},
    ),
    EurostatDataset(
        dataset="prc_hicp_minr",
        metric="admin_prices",
        metric_label="administered prices",
        unit="% change on a year earlier",
        section="economy",
        frequency="monthly",
        chart_ref="admin_prices",
        periods=60,
        params={'coicop18': 'AP', 'unit': 'RCH_A'},
    ),
    EurostatDataset(
        dataset="prc_hicp_minr",
        metric="home_energy_inflation",
        metric_label="home energy inflation",
        unit="% change on a year earlier",
        section="economy",
        frequency="monthly",
        chart_ref="home_energy_inflation",
        periods=60,
        params={'coicop18': 'ELC_GAS', 'unit': 'RCH_A'},
    ),
    EurostatDataset(
        dataset="irt_lt_mcby_m",
        metric="interest_rate",
        metric_label="long-term interest rate",
        unit="%",
        section="economy",
        frequency="monthly",
        chart_ref="interest_rate",
        periods=60,
        params={},
    ),
    EurostatDataset(
        dataset="ei_bsco_m",
        metric="consumer_confidence",
        metric_label="consumer confidence",
        unit="balance of responses",
        section="economy",
        frequency="monthly",
        chart_ref="consumer_confidence",
        periods=60,
        params={'indic': 'BS-CSMCI', 's_adj': 'SA', 'unit': 'BAL'},
    ),
    EurostatDataset(
        dataset="une_rt_m",
        metric="youth_unemployment",
        metric_label="youth unemployment rate",
        unit="% of the young labour force",
        section="labour",
        frequency="monthly",
        chart_ref="youth_unemployment",
        periods=60,
        params={'age': 'Y_LT25', 's_adj': 'SA', 'sex': 'T', 'unit': 'PC_ACT'},
    ),
    EurostatDataset(
        dataset="lfsi_emp_q",
        metric="employment_rate",
        metric_label="employment rate",
        unit="% of the working-age population",
        section="labour",
        frequency="quarterly",
        chart_ref="employment_rate",
        periods=40,
        params={'age': 'Y20-64', 'indic_em': 'EMP_LFS', 's_adj': 'SA', 'sex': 'T', 'unit': 'PC_POP'},
    ),
    EurostatDataset(
        dataset="jvs_q_nace2",
        metric="job_vacancy",
        metric_label="job vacancy rate",
        unit="% of posts unfilled",
        section="labour",
        frequency="quarterly",
        chart_ref="job_vacancy",
        periods=40,
        params={'indic_em': 'JVR', 'nace_r2': 'B-S', 's_adj': 'SA', 'sizeclas': 'TOTAL'},
    ),
    EurostatDataset(
        dataset="lc_lci_r2_q",
        metric="wages_mfg",
        metric_label="manufacturing labour cost",
        unit="index",
        section="labour",
        frequency="quarterly",
        chart_ref="wages_mfg",
        periods=40,
        params={'lcstruct': 'D1_D4_MD5', 'nace_r2': 'C', 's_adj': 'SCA', 'unit': 'I20'},
    ),
    EurostatDataset(
        dataset="lc_lci_r2_q",
        metric="wages_it",
        metric_label="IT sector labour cost",
        unit="index",
        section="labour",
        frequency="quarterly",
        chart_ref="wages_it",
        periods=40,
        params={'lcstruct': 'D1_D4_MD5', 'nace_r2': 'J', 's_adj': 'SCA', 'unit': 'I20'},
    ),
    EurostatDataset(
        dataset="earn_mw_cur",
        metric="minimum_wage",
        metric_label="minimum wage",
        unit="EUR per month",
        section="labour",
        frequency="semi-annual",
        chart_ref="minimum_wage",
        periods=20,
        params={'currency': 'EUR'},
    ),
    EurostatDataset(
        dataset="gov_10dd_edpt1",
        metric="gov_debt_gdp",
        metric_label="government debt",
        unit="% of GDP",
        section="government",
        frequency="annual",
        chart_ref="gov_debt_gdp",
        periods=20,
        params={'na_item': 'GD', 'sector': 'S13', 'unit': 'PC_GDP'},
    ),
    EurostatDataset(
        dataset="gov_10q_ggnfa",
        metric="gov_revenue",
        metric_label="government revenue",
        unit="EUR million",
        section="government",
        frequency="quarterly",
        chart_ref="gov_revenue",
        periods=40,
        params={'na_item': 'TR', 's_adj': 'NSA', 'sector': 'S13', 'unit': 'MIO_EUR'},
    ),
    EurostatDataset(
        dataset="gov_10q_ggnfa",
        metric="gov_deficit",
        metric_label="government net lending",
        unit="EUR million",
        section="government",
        frequency="quarterly",
        chart_ref="gov_deficit",
        periods=40,
        params={'na_item': 'B9', 's_adj': 'NSA', 'sector': 'S13', 'unit': 'MIO_EUR'},
    ),
    EurostatDataset(
        dataset="ilc_di12",
        metric="inequality",
        metric_label="income inequality",
        unit="Gini coefficient",
        section="government",
        frequency="annual",
        chart_ref="inequality",
        periods=20,
        params={'age': 'TOTAL', 'statinfo': 'GINI_HND'},
    ),
    EurostatDataset(
        dataset="ilc_peps01n",
        metric="poverty_risk",
        metric_label="at risk of poverty or social exclusion",
        unit="% of the population",
        section="government",
        frequency="annual",
        chart_ref="poverty_risk",
        periods=20,
        params={'age': 'TOTAL', 'sex': 'T', 'unit': 'PC'},
    ),
    EurostatDataset(
        dataset="demo_mlexpec",
        metric="life_expectancy",
        metric_label="life expectancy at birth",
        unit="years",
        section="environment",
        frequency="annual",
        chart_ref="life_expectancy",
        periods=20,
        params={'age': 'Y_LT1', 'sex': 'T', 'unit': 'YR'},
    ),
    EurostatDataset(
        dataset="demo_pjan",
        metric="population",
        metric_label="population",
        unit="people",
        section="environment",
        frequency="annual",
        chart_ref="population",
        periods=20,
        params={'age': 'TOTAL', 'sex': 'T'},
    ),
    EurostatDataset(
        dataset="demo_gind",
        metric="net_migration",
        metric_label="net migration rate",
        unit="per thousand inhabitants",
        section="environment",
        frequency="annual",
        chart_ref="net_migration",
        periods=20,
        params={'indic_de': 'CNMIGRATRT'},
    ),
    EurostatDataset(
        dataset="demo_gind",
        metric="birth_rate",
        metric_label="crude birth rate",
        unit="per thousand inhabitants",
        section="environment",
        frequency="annual",
        chart_ref="birth_rate",
        periods=20,
        params={'indic_de': 'GBIRTHRT'},
    ),
    EurostatDataset(
        dataset="sdg_09_10",
        metric="rd_spending",
        metric_label="research and development spending",
        unit="% of GDP",
        section="government",
        frequency="annual",
        chart_ref="rd_spending",
        periods=20,
        params={'sectperf': 'TOTAL', 'unit': 'PC_GDP'},
    ),
    EurostatDataset(
        dataset="sdg_04_70",
        metric="digital_skills",
        metric_label="basic digital skills",
        unit="% of individuals",
        section="government",
        frequency="annual",
        chart_ref="digital_skills",
        periods=20,
        params={'ind_type': 'IND_TOTAL', 'indic_is': 'I_DSK2_BAB', 'unit': 'PC_IND'},
    ),
    EurostatDataset(
        dataset="isoc_ec_ib20",
        metric="online_shoppers",
        metric_label="online shoppers",
        unit="% of individuals",
        section="government",
        frequency="annual",
        chart_ref="online_shoppers",
        periods=20,
        params={'ind_type': 'IND_TOTAL', 'indic_is': 'I_BLT12', 'unit': 'PC_IND'},
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="exports",
        metric_label="goods exports",
        unit="EUR million",
        section="trade",
        frequency="quarterly",
        chart_ref="exports",
        periods=40,
        params={'bop_item': 'G', 'currency': 'MIO_EUR', 'partner': 'WRL_REST', 'sector10': 'S1', 'sectpart': 'S1', 'stk_flow': 'CRE'},
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="imports",
        metric_label="goods imports",
        unit="EUR million",
        section="trade",
        frequency="quarterly",
        chart_ref="imports",
        periods=40,
        params={'bop_item': 'G', 'currency': 'MIO_EUR', 'partner': 'WRL_REST', 'sector10': 'S1', 'sectpart': 'S1', 'stk_flow': 'DEB'},
    ),
    EurostatDataset(
        dataset="bop_c6_q",
        metric="current_account",
        metric_label="current account balance",
        unit="EUR million",
        section="trade",
        frequency="quarterly",
        chart_ref="current_account",
        periods=40,
        params={'bop_item': 'CA', 'currency': 'MIO_EUR', 'partner': 'WRL_REST', 'sector10': 'S1', 'sectpart': 'S1', 'stk_flow': 'BAL'},
    ),
    EurostatDataset(
        dataset="tour_occ_nim",
        metric="tourism",
        metric_label="tourist arrivals",
        unit="arrivals",
        section="business",
        frequency="monthly",
        chart_ref="tourism",
        periods=60,
        params={'c_resid': 'TOTAL', 'nace_r2': 'I551-I553', 'unit': 'NR'},
    ),
    EurostatDataset(
        dataset="tour_occ_nim",
        metric="tourism_foreign",
        metric_label="nights spent by foreign visitors",
        unit="nights",
        section="business",
        frequency="monthly",
        chart_ref="tourism_foreign",
        periods=60,
        params={'c_resid': 'FOR', 'nace_r2': 'I551-I553', 'unit': 'NR'},
    ),
    EurostatDataset(
        dataset="tour_occ_anor2",
        metric="hotel_occupancy",
        metric_label="hotel bed occupancy",
        unit="% of bed places",
        section="business",
        frequency="annual",
        chart_ref="hotel_occupancy",
        periods=20,
        params={'accomunit': 'BEDPL'},
    ),
    EurostatDataset(
        dataset="nrg_cb_pem",
        metric="elec_production",
        metric_label="electricity production",
        unit="GWh",
        section="energy",
        frequency="monthly",
        chart_ref="elec_production",
        periods=60,
        params={'siec': 'TOTAL', 'unit': 'GWH'},
    ),
    EurostatDataset(
        dataset="nrg_cb_pem",
        metric="elec_renewable_gen",
        metric_label="renewable electricity generation",
        unit="GWh",
        section="energy",
        frequency="monthly",
        chart_ref="elec_renewable_gen",
        periods=60,
        params={'siec': 'RA000', 'unit': 'GWH'},
    ),
    EurostatDataset(
        dataset="nrg_ind_ren",
        metric="renewables",
        metric_label="renewable energy share",
        unit="% of gross final consumption",
        section="energy",
        frequency="annual",
        chart_ref="renewables",
        periods=20,
        params={'nrg_bal': 'REN'},
    ),
    EurostatDataset(
        dataset="nrg_pc_204",
        metric="elec_price_household",
        metric_label="household electricity price",
        unit="EUR per kWh",
        section="energy",
        frequency="semi-annual",
        chart_ref="elec_price_household",
        periods=20,
        params={'currency': 'EUR', 'nrg_cons': 'TOT_KWH', 'tax': 'I_TAX'},
    ),
    EurostatDataset(
        dataset="nrg_pc_205",
        metric="elec_price_industry",
        metric_label="industrial electricity price",
        unit="EUR per kWh",
        section="energy",
        frequency="semi-annual",
        chart_ref="elec_price_industry",
        periods=20,
        params={'currency': 'EUR', 'nrg_cons': 'MWH500-1999', 'tax': 'X_TAX', 'unit': 'KWH'},
    ),
    EurostatDataset(
        dataset="road_eqs_carhab",
        metric="vehicles",
        metric_label="passenger cars per 1,000 inhabitants",
        unit="cars per thousand inhabitants",
        section="trade",
        frequency="annual",
        chart_ref="vehicles",
        periods=20,
        params={},
    ),
    EurostatDataset(
        dataset="avia_paoc",
        metric="air_passengers",
        metric_label="air passengers carried",
        unit="passengers",
        section="trade",
        frequency="quarterly",
        chart_ref="air_passengers",
        periods=40,
        params={'schedule': 'TOTAL', 'tra_cov': 'TOTAL', 'tra_meas': 'PAS_CRD', 'unit': 'PAS'},
    ),
    EurostatDataset(
        dataset="rail_go_quartal",
        metric="rail_freight",
        metric_label="rail freight",
        unit="million tonne-kilometres",
        section="trade",
        frequency="quarterly",
        chart_ref="rail_freight",
        periods=40,
        params={'unit': 'MIO_TKM'},
    ),
    EurostatDataset(
        dataset="road_go_tq_tott",
        metric="road_freight",
        metric_label="road freight",
        unit="thousand tonnes",
        section="trade",
        frequency="quarterly",
        chart_ref="road_freight",
        periods=40,
        params={'tra_oper': 'TOTAL', 'tra_type': 'TOTAL', 'unit': 'THS_T'},
    ),
    EurostatDataset(
        dataset="road_go_tq_tott",
        metric="road_freight_tkm",
        metric_label="road freight in tonne-kilometres",
        unit="million tonne-kilometres",
        section="trade",
        frequency="quarterly",
        chart_ref="road_freight_tkm",
        periods=40,
        params={'tra_oper': 'TOTAL', 'tra_type': 'TOTAL', 'unit': 'MIO_TKM'},
    ),
    EurostatDataset(
        dataset="rail_pa_quartal",
        metric="rail_passengers",
        metric_label="rail passengers",
        unit="thousand passengers",
        section="trade",
        frequency="quarterly",
        chart_ref="rail_passengers",
        periods=40,
        params={'unit': 'THS_PAS'},
    ),
    EurostatDataset(
        dataset="nama_10_lp_ulc",
        metric="labour_productivity",
        metric_label="labour productivity per person",
        unit="index",
        section="labour",
        frequency="annual",
        chart_ref="labour_productivity",
        periods=20,
        params={'na_item': 'RLPR_PER', 'unit': 'I20'},
    ),
)


def _jsonstat_index(sizes: Sequence[int], coords: Sequence[int]) -> int:
    index = 0
    for size, coord in zip(sizes, coords):
        index = index * size + coord
    return index


def parse_jsonstat(
    payload: dict[str, Any],
    spec: EurostatDataset,
    *,
    retrieved_at: str,
    url: str,
) -> list[TimeSeries]:
    """Turn a JSON-stat 2.0 response into one series per geography.

    Eurostat returns ``value`` as a **sparse** mapping of flat-index -> number:
    a period with no observation yet is simply absent rather than null. Treating
    a missing key as zero would invent a collapse in the data, so missing points
    are dropped and the series is simply shorter.
    """
    dimension_ids: list[str] = payload.get("id", [])
    sizes: list[int] = payload.get("size", [])
    dimensions = payload.get("dimension", {})
    raw_values = payload.get("value", {})

    geo_dim = spec.geo_dimension
    if geo_dim not in dimension_ids or "time" not in dimension_ids:
        log.warning("%s: response lacks %s/time dimensions", spec.dataset, geo_dim)
        return []

    def values_at(flat_index: int) -> float | None:
        if isinstance(raw_values, list):
            if 0 <= flat_index < len(raw_values):
                value = raw_values[flat_index]
                return float(value) if isinstance(value, (int, float)) else None
            return None
        value = raw_values.get(str(flat_index))
        return float(value) if isinstance(value, (int, float)) else None

    geo_index: dict[str, int] = dimensions[geo_dim]["category"]["index"]
    time_index: dict[str, int] = dimensions["time"]["category"]["index"]
    if isinstance(time_index, list):  # some responses use a list form
        time_index = {period: i for i, period in enumerate(time_index)}
    if isinstance(geo_index, list):
        geo_index = {geo: i for i, geo in enumerate(geo_index)}

    dataset_version = payload.get("updated") or payload.get("extension", {}).get("datasetVersion")

    series_out: list[TimeSeries] = []
    for geo, geo_pos in geo_index.items():
        observations: list[Observation] = []
        for period, time_pos in sorted(time_index.items(), key=lambda kv: kv[1]):
            coords = []
            for dim_id in dimension_ids:
                if dim_id == geo_dim:
                    coords.append(geo_pos)
                elif dim_id == "time":
                    coords.append(time_pos)
                else:
                    coords.append(0)
            value = values_at(_jsonstat_index(sizes, coords))
            if value is not None:
                observations.append(Observation(period=period, value=value))
        if not observations:
            log.info("%s/%s: no observations returned", spec.dataset, geo)
            continue
        observations.sort(key=lambda o: o.period)
        series_out.append(
            TimeSeries(
                metric=spec.metric,
                metric_label=spec.metric_label,
                geography=geo,
                unit=spec.unit,
                section=spec.section,
                observations=tuple(observations),
                frequency=spec.frequency,
                chart_ref=spec.chart_ref,
                source=SourceRef(
                    source_id="eurostat",
                    retrieved_at=retrieved_at,
                    dataset=spec.dataset,
                    dataset_version=str(dataset_version) if dataset_version else None,
                    url=url,
                ),
            )
        )
    return series_out


async def collect_eurostat(
    http: CollectorHttp,
    datasets: Iterable[EurostatDataset] = EUROSTAT_DATASETS,
    *,
    geographies: Sequence[str] = COLLECTED_GEOGRAPHIES,
) -> list[TimeSeries]:
    source = registry().get("eurostat")
    out: list[TimeSeries] = []
    for spec in datasets:
        url = source.endpoint.format(dataset=spec.dataset)
        # A dataset that pins its own territorial axis asks for none here. Sending
        # geo=LV to a per-country maritime cube that has no geo dimension is an
        # HTTP 400, not an empty series.
        params = request_params(spec, geographies)
        result = await http.fetch(
            source_id="eurostat",
            url=url,
            cache_ttl_minutes=source.cache_ttl_minutes,
            accept="application/json",
            params=params,  # type: ignore[arg-type]
        )
        if not result.ok or result.item is None:
            log.warning("eurostat/%s: %s", spec.dataset, result.skipped_reason)
            continue
        try:
            payload = json.loads(result.item.body)
        except json.JSONDecodeError:
            log.error("eurostat/%s: response was not JSON", spec.dataset)
            continue
        out.extend(
            parse_jsonstat(payload, spec, retrieved_at=result.item.retrieved_at, url=result.item.url)
        )
    return out


# ---------------------------------------------------------------------------
# Elering — Nord Pool day-ahead electricity prices
# ---------------------------------------------------------------------------
def parse_elering(
    payload: dict[str, Any],
    *,
    retrieved_at: str,
    url: str,
    geographies: Sequence[str] = BALTIC,
) -> list[TimeSeries]:
    """Aggregate Elering's sub-hourly price points into daily series.

    Two series per country are produced because they answer different
    questions: the daily **mean** is what a household pays on average, while the
    daily **spread** between the cheapest and dearest interval is what decides
    whether shifting industrial load is worth doing. Aggregating to whole days
    also makes the collector indifferent to Elering's resolution, which is
    currently 15 minutes rather than the hourly it used to be.

    The current (partial) day is dropped: a day that is still being filled in
    would otherwise look like a collapse in volume against complete days.
    """
    data = payload.get("data", {})
    today = utcnow().date().isoformat()
    series_out: list[TimeSeries] = []

    for geo in geographies:
        points = data.get(geo.lower()) or []
        by_day: dict[str, list[float]] = {}
        for point in points:
            timestamp = point.get("timestamp")
            price = point.get("price")
            if timestamp is None or not isinstance(price, (int, float)):
                continue
            day = datetime.fromtimestamp(int(timestamp), tz=timezone.utc).date().isoformat()
            by_day.setdefault(day, []).append(float(price))

        complete = {day: prices for day, prices in by_day.items() if day < today and prices}
        if not complete:
            continue

        source = SourceRef(
            source_id="elering",
            retrieved_at=retrieved_at,
            dataset="nps/price day-ahead",
            url=url,
        )
        means = tuple(
            Observation(period=day, value=round(sum(prices) / len(prices), 2))
            for day, prices in sorted(complete.items())
        )
        spreads = tuple(
            Observation(period=day, value=round(max(prices) - min(prices), 2))
            for day, prices in sorted(complete.items())
        )
        series_out.append(
            TimeSeries(
                metric="day_ahead_power_price",
                metric_label="day-ahead wholesale electricity price",
                geography=geo,
                unit="EUR/MWh",
                section="energy",
                observations=means,
                frequency="daily",
                chart_ref=None,
                source=source,
            )
        )
        series_out.append(
            TimeSeries(
                metric="day_ahead_power_spread",
                metric_label="daily spread between the cheapest and dearest power interval",
                geography=geo,
                unit="EUR/MWh",
                section="energy",
                observations=spreads,
                frequency="daily",
                chart_ref=None,
                source=source,
            )
        )
    return series_out


async def collect_elering(http: CollectorHttp, *, days: int = 120) -> list[TimeSeries]:
    source = registry().get("elering")
    end = utcnow().replace(hour=23, minute=59, second=59, microsecond=0)
    start = (end - timedelta(days=days)).replace(hour=0, minute=0, second=0)
    result = await http.fetch(
        source_id="elering",
        url=source.endpoint,
        cache_ttl_minutes=source.cache_ttl_minutes,
        accept="application/json",
        params={
            "start": start.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "end": end.strftime("%Y-%m-%dT%H:%M:%S.999Z"),
        },
    )
    if not result.ok or result.item is None:
        log.warning("elering: %s", result.skipped_reason)
        return []
    try:
        payload = json.loads(result.item.body)
    except json.JSONDecodeError:
        log.error("elering: response was not JSON")
        return []
    if not payload.get("success", True):
        log.error("elering: API reported failure")
        return []
    return parse_elering(payload, retrieved_at=result.item.retrieved_at, url=result.item.url)


async def collect_open_data(http: CollectorHttp) -> list[TimeSeries]:
    """Every tier A collector. A failing source costs coverage, never accuracy."""
    series: list[TimeSeries] = []
    for name, coroutine in (("elering", collect_elering(http)), ("eurostat", collect_eurostat(http))):
        try:
            series.extend(await coroutine)
        except Exception:  # noqa: BLE001 - one bad source must not sink the run
            log.exception("%s collector failed; continuing with fewer series", name)
    log.info("collected %d series from tier A sources", len(series))
    return series


__all__ = [
    "EUROSTAT_DATASETS",
    "EurostatDataset",
    "collect_elering",
    "collect_eurostat",
    "collect_open_data",
    "parse_elering",
    "parse_jsonstat",
]

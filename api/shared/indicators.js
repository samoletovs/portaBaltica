/**
 * Baltic comparison indicators — single source of truth.
 *
 * Every definition pins *every* dimension of its Eurostat cube. That is not
 * stylistic: the parser used to fall back to category index 0 for anything a
 * query left open, so a retired or mistyped code produced a valid-looking
 * response containing either nothing or a different statistic under the old
 * label. A live audit found nine indicators returning no data and three
 * rendering the wrong series entirely — including a chart labelled
 * "Income inequality (Gini)" that was actually plotting net foreign direct
 * investment as a share of GDP.
 *
 * `sanity` is the guard against that second, quieter failure. It is the range
 * a plausible latest value must fall in, and the contract test asserts it. A
 * Gini index reading 8.9 fails `[20, 45]`; an empty chart fails on point count.
 * When adding an indicator, set the band from what the statistic *means*, not
 * from what the API happens to return today.
 *
 * `euAggregation` says what the `EU27_2020` figure on the same cube actually
 * *is*, and it is mandatory for the same reason `sanity` is — absence must not
 * resolve to "draw it".
 *
 *   - `average` — an intensive statistic: a rate, a share, a price, a per-capita
 *     or per-1000 figure, an index. The EU value is a weighted average of its
 *     members, it sits in the same numeric range as the three, and it answers
 *     "is 6.8% good or bad". This is the benchmark `/api/baltic-compare`
 *     returns as `reference`.
 *   - `sum` — an extensive total: euros, persons, nights, GWh, tonnes,
 *     tonne-km, passengers. The EU value is not a benchmark at all; it is the
 *     whole of which Latvia is a part, and it is one to two orders of magnitude
 *     larger. EU27 population is ~449M against Latvia's ~1.85M, a ratio of 240,
 *     so plotting both on one linear axis prices the axis in EU units and
 *     collapses all three Baltic series into a flat line along the bottom. The
 *     chart then shows the reader nothing about the three countries it exists
 *     to compare.
 *
 * The band itself is corroborating evidence of the split: `sanity` is written
 * from what a *Baltic* reading means, and every `sum` indicator's EU value
 * falls far outside its own band while every `average` one falls inside it.
 */

const INDICATORS = {
  // ---- Output & prices -------------------------------------------------
  gdp: {
    dataset: 'namq_10_gdp',
    params: 'unit=CLV_PCH_PRE&s_adj=SCA&na_item=B1GQ&freq=Q',
    freq: 'Q',
    title: 'GDP Growth Rate',
    unit: '% QoQ',
    euAggregation: 'average',
    sanity: [-20, 20],
  },
  gdp_per_capita: {
    dataset: 'sdg_08_10',
    // CLV10_EUR_HAB was retired when Eurostat rebased chain-linked volumes to 2020.
    params: 'freq=A&unit=CLV20_EUR_HAB&na_item=B1GQ',
    freq: 'A',
    title: 'GDP per capita',
    unit: 'EUR',
    euAggregation: 'average',
    sanity: [5000, 60000],
  },
  // Eurostat moved HICP from ECOICOP ver.1 to ver.2. The ver.1 tables
  // (prc_hicp_manr, prc_hicp_midx, prc_hicp_mmor) were frozen on 2026-02-06
  // with 2025-12 as their last period — they still answer HTTP 200 and still
  // list every old code, so nothing failed and four charts quietly went eight
  // months stale. The ver.2 table renames the dimension `coicop` -> `coicop18`,
  // renames all-items CP00 -> TOTAL, and folds the index and the rates of
  // change into one cube, so `unit` must now be pinned to RCH_A to get the
  // annual rate that prc_hicp_manr used to return on its own.
  inflation: {
    dataset: 'prc_hicp_minr',
    params: 'coicop18=TOTAL&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'HICP Inflation',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-10, 40],
  },
  energy_inflation: {
    dataset: 'prc_hicp_minr',
    params: 'coicop18=NRG&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'Energy inflation',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-60, 100],
  },
  food_inflation: {
    dataset: 'prc_hicp_minr',
    params: 'coicop18=FOOD&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'Food inflation',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-30, 50],
  },
  core_inflation: {
    dataset: 'prc_hicp_minr',
    params: 'coicop18=TOT_X_NRG_FOOD&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'Core inflation (excl. energy & food)',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-10, 30],
  },
  services_inflation: {
    dataset: 'prc_hicp_minr',
    params: 'coicop18=SERV&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'Services inflation',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-10, 30],
  },
  goods_inflation: {
    dataset: 'prc_hicp_minr',
    params: 'coicop18=GD&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'Goods inflation',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-20, 40],
  },
  admin_prices: {
    // Prices set or approved by government rather than by the market. In the
    // Baltics this is where energy policy shows up as a consumer price, and it
    // diverges sharply between the three — which the headline rate hides.
    dataset: 'prc_hicp_minr',
    params: 'coicop18=AP&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'Administered prices',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-30, 60],
  },
  home_energy_inflation: {
    // Electricity, gas, solid fuels and heat — the household energy bill.
    // The band is wide because it genuinely was: this series ran well above
    // 100% across the Baltics during the 2022 energy shock.
    dataset: 'prc_hicp_minr',
    params: 'coicop18=ELC_GAS&unit=RCH_A&freq=M',
    freq: 'M',
    title: 'Home energy inflation',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-70, 200],
  },
  ppi: {
    dataset: 'sts_inpp_m',
    params: 'nace_r2=B-D&s_adj=NSA&unit=PCH_PRE&freq=M',
    freq: 'M',
    title: 'Producer prices',
    unit: '% MoM',
    euAggregation: 'average',
    sanity: [-25, 25],
  },
  industrial: {
    // nace_r2=B-D36 is not a code in this dataset; the aggregate is B-D.
    dataset: 'sts_inpr_m',
    params: 'nace_r2=B-D&indic_bt=PRD&s_adj=SCA&unit=PCH_PRE&freq=M',
    freq: 'M',
    title: 'Industrial production',
    unit: '% MoM',
    euAggregation: 'average',
    sanity: [-30, 30],
  },
  retail: {
    dataset: 'sts_trtu_m',
    params: 'nace_r2=G47&indic_bt=VOL_SLS&s_adj=CA&unit=PCH_SM&freq=M',
    freq: 'M',
    title: 'Retail sales growth',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-40, 40],
  },
  construction: {
    // sts_copr_m carries no Baltic data at all — the geo dimension comes back
    // empty. The quarterly table does.
    dataset: 'sts_copr_q',
    params: 'nace_r2=F&indic_bt=PRD&s_adj=SCA&unit=PCH_PRE&freq=Q',
    freq: 'Q',
    title: 'Construction output',
    unit: '% QoQ',
    euAggregation: 'average',
    sanity: [-40, 40],
  },

  // Building permits, the one leading indicator on this page.
  //
  // Construction output above is what is being built now; a permit is what
  // someone has decided to build later, so the two move months apart and the
  // gap between them is the story. Three definitions rather than one because
  // the cube carries a composition — residential plus non-residential make up
  // the total — which lets an article ask *which* segment moved rather than
  // adding a fourth line to a chart of national aggregates.
  //
  // Two traps, both measured against the live cube on 2026-08-28 rather than
  // read from a table:
  //
  //   - `indic_bt=PSQM` is the obvious guess and it is empty. It answers HTTP
  //     200 and returns 0 of 42 quarters for all three countries, which is
  //     indistinguishable from a working query on a quiet cube. BPRM_SQM is
  //     the code that carries data: 106 of 106 quarters, 100%, LV, EE and LT
  //     alike, from 2000-Q1 to 2026-Q2 with no interior holes.
  //   - `indic_bt` says "m2 of useful floor area" but `unit` is an index. The
  //     figure is not square metres and the label must not imply it is, which
  //     is the same mistake as calling a consumption band a total.
  //
  // `s_adj=SCA` because permits are strongly seasonal in the Baltics and an
  // unadjusted series produces a "record low" every winter. Same pin as
  // `construction` above and as the business demography pair below.
  //
  // The band is the plausible range for an index rebased to 2021=100 in a
  // construction cycle, not the observed range: across the full 106 quarters
  // these run 15.5 to 370.7, spanning the 2006 boom and the 2009 collapse. A
  // reading below 5 or above 700 is a definition pointing somewhere else — a
  // raw floor-area count would be six figures, a percentage change would
  // usually be negative in a downturn and fail the floor.
  building_permits: {
    dataset: 'sts_cobp_q',
    params: 'freq=Q&indic_bt=BPRM_SQM&cpa2_1=CPA_F41001_41002&s_adj=SCA&unit=I21',
    freq: 'Q',
    title: 'Building permits',
    unit: 'index (2021=100)',
    euAggregation: 'average',
    sanity: [5, 700],
  },
  building_permits_residential: {
    dataset: 'sts_cobp_q',
    params: 'freq=Q&indic_bt=BPRM_SQM&cpa2_1=CPA_F41001&s_adj=SCA&unit=I21',
    freq: 'Q',
    title: 'Building permits (residential)',
    unit: 'index (2021=100)',
    euAggregation: 'average',
    sanity: [5, 700],
  },
  building_permits_non_residential: {
    dataset: 'sts_cobp_q',
    params: 'freq=Q&indic_bt=BPRM_SQM&cpa2_1=CPA_F41002&s_adj=SCA&unit=I21',
    freq: 'Q',
    title: 'Building permits (non-residential)',
    unit: 'index (2021=100)',
    euAggregation: 'average',
    sanity: [5, 700],
  },
  // Office permits (`cpa2_1=CPA_F410023`) are published for all three and were
  // deliberately not added. Measured over the same 106 quarters the series
  // reaches **0** in Latvia and Estonia and 618.8 in Lithuania, so a sanity
  // band wide enough to be true is too wide to catch anything, and a segment
  // that legitimately spends quarters at zero produces a record extreme most
  // times it moves. Left out on the measurement, not by oversight.
  house_prices: {
    dataset: 'prc_hpi_q',
    params: 'purchase=TOTAL&unit=RCH_A&freq=Q',
    freq: 'Q',
    title: 'House Price Change',
    unit: '% YoY',
    euAggregation: 'average',
    sanity: [-40, 50],
  },
  interest_rate: {
    dataset: 'irt_lt_mcby_m',
    params: 'freq=M',
    freq: 'M',
    title: 'Long-term interest rate',
    unit: '%',
    euAggregation: 'average',
    sanity: [-2, 20],
  },
  consumer_confidence: {
    // BS-CSMCI-BAL is not a code: BAL is a value of the separate `unit` dimension.
    dataset: 'ei_bsco_m',
    params: 'indic=BS-CSMCI&s_adj=SA&unit=BAL&freq=M',
    freq: 'M',
    title: 'Consumer confidence',
    unit: 'balance',
    euAggregation: 'average',
    sanity: [-70, 30],
  },
  economic_sentiment: {
    // The "Economic sentiment" card used to be mapped onto consumer
    // confidence, which is one of its five components rather than the index.
    dataset: 'ei_bssi_m_r2',
    params: 'freq=M&indic=BS-ESI-I&s_adj=SA',
    freq: 'M',
    title: 'Economic sentiment indicator',
    unit: 'index (long-term avg=100)',
    euAggregation: 'average',
    sanity: [40, 150],
  },

  // ---- Labour ----------------------------------------------------------
  unemployment: {
    dataset: 'une_rt_m',
    params: 'unit=PC_ACT&s_adj=SA&age=TOTAL&sex=T&freq=M',
    freq: 'M',
    title: 'Unemployment Rate',
    unit: '%',
    euAggregation: 'average',
    sanity: [1, 30],
  },
  youth_unemployment: {
    dataset: 'une_rt_m',
    params: 'unit=PC_ACT&s_adj=SA&age=Y_LT25&sex=T&freq=M',
    freq: 'M',
    title: 'Youth unemployment (under 25)',
    unit: '%',
    euAggregation: 'average',
    sanity: [2, 50],
  },
  employment_rate: {
    // The 20-64 band is the one the EU employment target is written against,
    // and it moves independently of unemployment: a falling participation rate
    // can flatter the unemployment rate while employment itself shrinks.
    dataset: 'lfsi_emp_q',
    params: 'freq=Q&indic_em=EMP_LFS&s_adj=SA&sex=T&age=Y20-64&unit=PC_POP',
    freq: 'Q',
    title: 'Employment rate (20-64)',
    unit: '%',
    euAggregation: 'average',
    sanity: [40, 90],
  },
  job_vacancy: {
    // indic_em=JOBRATE is not a code; the job vacancy rate is JVR.
    dataset: 'jvs_q_nace2',
    params: 'freq=Q&nace_r2=B-S&s_adj=SA&sizeclas=TOTAL&indic_em=JVR',
    freq: 'Q',
    title: 'Job vacancy rate',
    unit: '%',
    euAggregation: 'average',
    sanity: [0, 12],
  },
  salary: {
    dataset: 'lc_lci_lev',
    params: 'freq=A&lcstruct=D1_D4_MD5&unit=EUR&nace_r2=B-S_X_O',
    freq: 'A',
    title: 'Hourly labour cost',
    unit: 'EUR/hour',
    euAggregation: 'average',
    sanity: [3, 80],
  },
  wages_mfg: {
    dataset: 'lc_lci_r2_q',
    params: 'freq=Q&nace_r2=C&unit=I20&s_adj=SCA&lcstruct=D1_D4_MD5',
    freq: 'Q',
    title: 'Labour cost: manufacturing',
    unit: 'index (2020=100)',
    euAggregation: 'average',
    sanity: [60, 300],
  },
  wages_it: {
    dataset: 'lc_lci_r2_q',
    params: 'freq=Q&nace_r2=J&unit=I20&s_adj=SCA&lcstruct=D1_D4_MD5',
    freq: 'Q',
    title: 'Labour cost: IT sector',
    unit: 'index (2020=100)',
    euAggregation: 'average',
    sanity: [60, 300],
  },
  minimum_wage: {
    dataset: 'earn_mw_cur',
    params: 'freq=S&currency=EUR',
    freq: 'S',
    title: 'Minimum wage',
    unit: 'EUR/month',
    euAggregation: 'average',
    sanity: [200, 3000],
  },

  // ---- Government & society -------------------------------------------
  gov_debt_gdp: {
    // The sector dimension was left open, so the parser read S1 (total
    // economy), which carries no general government debt.
    dataset: 'gov_10dd_edpt1',
    params: 'na_item=GD&unit=PC_GDP&sector=S13&freq=A',
    freq: 'A',
    title: 'Government debt / GDP',
    unit: '% GDP',
    euAggregation: 'average',
    sanity: [0, 200],
  },
  gov_revenue: {
    dataset: 'gov_10q_ggnfa',
    params: 'na_item=TR&freq=Q&unit=MIO_EUR&sector=S13&s_adj=NSA',
    freq: 'Q',
    title: 'Government revenue',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [100, 50000],
  },
  gov_deficit: {
    dataset: 'gov_10q_ggnfa',
    params: 'na_item=B9&freq=Q&unit=MIO_EUR&sector=S13&s_adj=NSA',
    freq: 'Q',
    title: 'Government net lending/borrowing',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-20000, 20000],
  },
  inequality: {
    // Was tipsii20, which is net foreign direct investment as % of GDP — not
    // an inequality measure at all. ilc_di12 is the Gini of equivalised
    // disposable income.
    dataset: 'ilc_di12',
    params: 'freq=A&age=TOTAL&statinfo=GINI_HND',
    freq: 'A',
    title: 'Income inequality (Gini)',
    unit: 'index',
    euAggregation: 'average',
    sanity: [20, 45],
  },
  poverty_risk: {
    dataset: 'ilc_peps01n',
    params: 'freq=A&unit=PC&age=TOTAL&sex=T',
    freq: 'A',
    title: 'At risk of poverty or social exclusion',
    unit: '% of population',
    euAggregation: 'average',
    sanity: [5, 45],
  },
  // Weekly deaths — the only series on this page that moves faster than a
  // month, and the reason it is here.
  //
  // Every other indicator in this registry is monthly or slower, which means a
  // daily pipeline reads each new release once and then has nothing to say
  // until the next one lands. Mining more monthly cubes cannot fix that; only
  // a faster cadence can. `demo_r_mwk_ts` publishes 52 observations a year and
  // has done since 2000-W01.
  //
  // Measured live on 2026-08-28: 1384 points for Latvia and 1383 each for
  // Estonia and Lithuania out of 1388 weeks, 99.7% / 99.6% / 99.6%, no
  // interior holes. `freq=W&sex=T&unit=NR` leaves the parser nothing to
  // choose — `unit` carries only NR today, and pinning it means a second code
  // appearing later is an explicit change here rather than a silent
  // assumption in the response.
  //
  // **Latvia runs a week ahead.** LV's newest observation was 2026-W28 while
  // EE and LT were at 2026-W27, so anything reading a shared newest period
  // will drop Latvia's most recent week or invent a null for the other two.
  // Per-country `latest` is the only correct read.
  //
  // The band is what a Baltic weekly death count means, not what the API
  // returned: across the full 26 years these run 230 (EE) to 1395 (LT),
  // including the 2021 COVID peaks. A per-100 000 rate would read about 20
  // and fail the floor; an annual total would read about 28 000 and fail the
  // ceiling.
  weekly_deaths: {
    dataset: 'demo_r_mwk_ts',
    params: 'freq=W&sex=T&unit=NR',
    freq: 'W',
    title: 'Deaths per week',
    unit: 'deaths/week',
    euAggregation: 'sum',
    sanity: [50, 2000],
  },
  life_expectancy: {
    // age=Y1 is life expectancy *at age 1*; at birth is Y_LT1.
    dataset: 'demo_mlexpec',
    params: 'freq=A&sex=T&age=Y_LT1&unit=YR',
    freq: 'A',
    title: 'Life expectancy at birth',
    unit: 'years',
    euAggregation: 'average',
    sanity: [65, 90],
  },
  population: {
    dataset: 'demo_pjan',
    params: 'sex=T&age=TOTAL&freq=A',
    freq: 'A',
    title: 'Population',
    unit: 'persons',
    euAggregation: 'sum',
    sanity: [100000, 20000000],
  },
  net_migration: {
    dataset: 'demo_gind',
    params: 'freq=A&indic_de=CNMIGRATRT',
    freq: 'A',
    title: 'Net migration rate',
    unit: 'per 1000 inhabitants',
    euAggregation: 'average',
    sanity: [-40, 40],
  },
  /**
   * First-time asylum applications, monthly.
   *
   * `AGENTS.md` recorded this cube as "newsworthy; codes unresolved" after it
   * answered HTTP 413 unpinned and 400 pinned. The blocker was `citizen`, which
   * carries **206** values — every nationality plus five aggregates — and was
   * never going to be guessed. Asking the cube for its own codes settles it in
   * one call:
   *
   *     ?format=JSON&geo=LV&lastTimePeriod=1   ->  200, ~9.6KB
   *     dimensions  freq unit citizen sex applicant age geo time
   *     citizen aggregates  EU27_2020 EXT_EU27_2020 STLS TOTAL UNK
   *
   * That generalises to every future 413: the metadata call is cheap and the
   * cube will tell you what it accepts.
   *
   * Measured 2026-08-29 through `buildUrl`/`parseJsonStat`, five paced runs:
   * 5/5 OK, `assumptions` empty every time, 79 observations per country over
   * `sinceTimePeriod=2020-01`, newest reading `2026-06`, newest eight
   * contiguous for all three, observed step one month — so `freq: 'M'` is
   * honest and no `maxAgeMonths` override is owed.
   *
   * **The recorded 413 no longer reproduces**: unpinned `citizen` now answers
   * 200 in ~122ms. Pinning still matters, but for the quieter reason — the
   * parser would otherwise choose a nationality on our behalf and say so in
   * `assumptions`. A reader who tests for a refusal will not find one.
   *
   * `applicant=FRST` rather than `TOTAL`: first-time applications are the
   * headline Eurostat and the Commission report, whereas `TOTAL` folds in
   * repeat applications, which track case processing rather than arrivals.
   *
   * The floor is 0 because Estonia genuinely files zero months; a floor of 1
   * would reject real data. The ceiling sits above any Baltic month observed
   * (max 1460) and below an EU-wide monthly figure, which runs to tens of
   * thousands — so a drift onto the `EU27_2020` aggregate is caught rather
   * than plotted.
   */
  asylum_applications: {
    dataset: 'migr_asyappctzm',
    params: 'freq=M&unit=PER&citizen=TOTAL&sex=T&applicant=FRST&age=TOTAL',
    freq: 'M',
    title: 'First-time asylum applications',
    unit: 'applications/month',
    euAggregation: 'sum',
    sanity: [0, 50000],
  },
  birth_rate: {
    dataset: 'demo_gind',
    params: 'freq=A&indic_de=GBIRTHRT',
    freq: 'A',
    title: 'Crude birth rate',
    unit: 'per 1000 inhabitants',
    euAggregation: 'average',
    sanity: [3, 25],
  },
  rd_spending: {
    dataset: 'sdg_09_10',
    params: 'freq=A&unit=PC_GDP&sectperf=TOTAL',
    freq: 'A',
    title: 'R&D expenditure',
    unit: '% GDP',
    euAggregation: 'average',
    sanity: [0.1, 6],
  },
  digital_skills: {
    dataset: 'sdg_04_70',
    params: 'freq=A&unit=PC_IND&indic_is=I_DSK2_BAB&ind_type=IND_TOTAL',
    freq: 'A',
    title: 'Basic digital skills',
    unit: '% of individuals',
    euAggregation: 'average',
    sanity: [10, 95],
    // The cube's `freq` dimension says A and the query needs it, but Eurostat
    // publishes this one every **two** years — 2021, 2023, 2025, with no 2022
    // or 2024 coordinate at all. That distinction matters: `freq` here is the
    // dimension code, not the publication cadence, and for this single
    // indicator of the sixty-six they disagree.
    //
    // The age of the newest observation therefore oscillates from about 8
    // months just after publication to **30** just before the next one, which
    // is exactly the annual default. So it sits on the boundary: a one-month
    // slip in publication marks a healthy series stale, and anyone tightening
    // MAX_AGE_MONTHS.A to a perfectly sensible 18 breaks it for more than half
    // of every cycle. Pinned here so the allowance travels with the fact that
    // explains it rather than depending on a shared default staying generous.
    maxAgeMonths: 36,
  },
  online_shoppers: {
    // Individuals who bought online in the last 12 months. Digital skills say
    // what people can do; this says what they actually do with it.
    dataset: 'isoc_ec_ib20',
    params: 'freq=A&ind_type=IND_TOTAL&indic_is=I_BLT12&unit=PC_IND',
    freq: 'A',
    title: 'Online shoppers',
    unit: '% of individuals',
    euAggregation: 'average',
    sanity: [10, 95],
  },

  // ---- Trade & external ------------------------------------------------
  exports: {
    // ext_tec01 is trade *by enterprise characteristics* — annual, and shaped
    // around size class and NACE, so a monthly geo/time read of it is empty.
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=G&stk_flow=CRE&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Exports of goods',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [100, 100000],
  },
  imports: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=G&stk_flow=DEB&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Imports of goods',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [100, 100000],
  },
  trade_balance: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=GS&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Trade balance (goods & services)',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-20000, 20000],
  },
  // The two halves of `trade_balance`, which the combined figure hides.
  //
  // Read together they overturn the obvious reading of the headline chart. All
  // three Baltic states run a goods deficit and always have — in 2025 Latvia's
  // was 9.2% of GDP against Lithuania's 8.0% and Estonia's 6.6%, a gap far too
  // small to explain why one headline is negative and another is not. The
  // entire difference sits in services, and nothing on the dashboard showed it:
  // a reader could see that Latvia diverged but had no way to see where.
  goods_balance: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=G&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Goods balance',
    unit: 'M EUR',
    euAggregation: 'sum',
    // A quarterly external-balance flow for an economy of roughly 10-22bn EUR
    // per quarter. Anything outside this is a different statistic or a
    // different unit, not a Baltic goods balance.
    sanity: [-6000, 3000],
  },
  services_balance: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=S&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Services balance',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-3000, 7000],
  },

  // The four service categories that account for the divergence. In 2025 the
  // gap between Lithuania's services surplus and Latvia's was 8.0bn EUR, and
  // these four carry 6.9bn of it — transport 3.2bn, other business services
  // 1.5bn, financial 1.4bn, ICT 0.7bn. They are separate indicators rather than
  // one aggregate because the causes are unrelated: transport is the east-west
  // transit corridor, financial is what followed ABLV's failure in 2018.
  transport_services: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=SC&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Transport services balance',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-2000, 3000],
  },
  financial_services: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=SG&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Financial services balance',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-1500, 2500],
  },
  ict_services: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=SI&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Telecom, computer & information services balance',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-1500, 2500],
  },
  other_business_services: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=SJ&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Other business services balance',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-1500, 2500],
  },
  current_account: {
    dataset: 'bop_c6_q',
    params: 'freq=Q&bop_item=CA&stk_flow=BAL&partner=WRL_REST&currency=MIO_EUR&sectpart=S1&sector10=S1',
    freq: 'Q',
    title: 'Current account balance',
    unit: 'M EUR',
    euAggregation: 'sum',
    sanity: [-20000, 20000],
  },
  tourism: {
    dataset: 'tour_occ_nim',
    params: 'nace_r2=I551-I553&unit=NR&c_resid=TOTAL&freq=M',
    freq: 'M',
    title: 'Tourist arrivals',
    unit: 'persons',
    euAggregation: 'sum',
    sanity: [1000, 10000000],
  },
  tourism_foreign: {
    dataset: 'tour_occ_nim',
    params: 'nace_r2=I551-I553&unit=NR&c_resid=FOR&freq=M',
    freq: 'M',
    title: 'Nights spent by foreign visitors',
    unit: 'nights',
    euAggregation: 'sum',
    sanity: [1000, 10000000],
  },
  hotel_occupancy: {
    // The "Hotel occupancy" card used to be mapped onto tourist arrivals, so
    // it displayed a headcount under a percentage label.
    dataset: 'tour_occ_anor2',
    params: 'freq=A&accomunit=BEDPL',
    freq: 'A',
    title: 'Net occupancy rate of bed places',
    unit: '%',
    euAggregation: 'average',
    sanity: [5, 95],
  },

  // ---- Energy & infrastructure ----------------------------------------
  elec_production: {
    // nrg_cb_em is the import/export table: it has neither siec=TOTAL nor
    // nrg_bal=GEP. Gross electricity production lives in nrg_cb_pem.
    dataset: 'nrg_cb_pem',
    params: 'freq=M&siec=TOTAL&unit=GWH',
    freq: 'M',
    title: 'Electricity production',
    unit: 'GWh',
    euAggregation: 'sum',
    sanity: [10, 20000],
  },
  elec_renewable_gen: {
    dataset: 'nrg_cb_pem',
    params: 'freq=M&siec=RA000&unit=GWH',
    freq: 'M',
    title: 'Renewable electricity generation',
    unit: 'GWh',
    euAggregation: 'sum',
    sanity: [1, 20000],
  },
  renewables: {
    dataset: 'nrg_ind_ren',
    params: 'freq=A&nrg_bal=REN',
    freq: 'A',
    title: 'Renewable energy share',
    unit: '%',
    euAggregation: 'average',
    sanity: [0, 100],
  },
  elec_price_household: {
    dataset: 'nrg_pc_204',
    params: 'freq=S&nrg_cons=TOT_KWH&tax=I_TAX&currency=EUR',
    freq: 'S',
    title: 'Electricity price (households)',
    unit: 'EUR/kWh',
    euAggregation: 'average',
    sanity: [0.03, 1],
  },
  elec_price_industry: {
    dataset: 'nrg_pc_205',
    // `TOT_KWH` is the emptiest code in this cube, not the fullest. Measured
    // across the ten half-years to 2025-S2 it carries LV=3, EE=9, LT=4
    // observations, while all six real consumption bands carry 10/10/10 — so
    // the "total" drew a Latvian line with three points in ten and a Lithuanian
    // one with four, next to a nearly complete Estonian line. Nothing was
    // malformed; the chart simply implied Latvia had stopped reporting.
    //
    // MWH500-1999 is Eurostat's band IC, the medium industrial consumer it uses
    // for its own headline non-household price, and it is complete for all
    // three countries. The band is named in the title because a band is not a
    // total and the reader is entitled to know which one they are looking at.
    params: 'freq=S&nrg_cons=MWH500-1999&tax=X_TAX&currency=EUR&unit=KWH',
    freq: 'S',
    title: 'Electricity price (industry, 500\u20132000 MWh)',
    unit: 'EUR/kWh',
    euAggregation: 'average',
    // Observed 0.0834 to 0.3294 EUR/kWh for this band across the same window.
    sanity: [0.02, 1],
  },
  gas_price_household: {
    dataset: 'nrg_pc_202',
    // The same trap as nrg_pc_205 above, in a different cube, and this one is
    // worse. Measured across the twenty half-years to 2025-S2, `TOT_GJ` — the
    // aggregate, the code anyone would reach for — carries **LV=1, EE=1,
    // LT=3** observations, and its newest is 2024-S1. All three real
    // consumption bands carry 20/20/20 and reach 2025-S2. So the total is not
    // merely the emptiest code here, it is also eighteen months more stale
    // than the bands, and a definition using it would have drawn a Baltic
    // comparison from a single point per country.
    //
    // GJ20-199 is Eurostat's band D2, the medium household consumer it uses
    // for its own headline household gas price. The band is named in the
    // title for the same reason it is on the electricity series: a band is
    // not a total.
    params: 'freq=S&nrg_cons=GJ20-199&tax=I_TAX&currency=EUR&unit=KWH&siec=G3000',
    freq: 'S',
    title: 'Gas price (households, 20\u2013200 GJ)',
    unit: 'EUR/kWh',
    euAggregation: 'average',
    // Gas is cheaper per kWh than electricity and the band reflects that:
    // 0.0826 EUR/kWh for Latvia at 2025-S2. The floor is low enough to survive
    // a pre-2021 price and the ceiling high enough to survive another 2022.
    sanity: [0.01, 0.5],
  },
  vehicles: {
    dataset: 'road_eqs_carhab',
    params: 'freq=A',
    freq: 'A',
    title: 'Passenger cars per 1000 inhabitants',
    unit: 'per 1000',
    euAggregation: 'average',
    sanity: [100, 900],
  },
  air_passengers: {
    // Passengers carried, all schedules, national and international. The
    // dashboard already covers sea freight; this is the other half of how
    // people and goods actually reach the Baltics.
    dataset: 'avia_paoc',
    params: 'freq=Q&unit=PAS&tra_meas=PAS_CRD&tra_cov=TOTAL&schedule=TOTAL',
    freq: 'Q',
    title: 'Air passengers carried',
    unit: 'passengers/quarter',
    euAggregation: 'sum',
    sanity: [1000, 50000000],
  },
  ghg_emissions: {
    // All NACE activities plus households, seasonally adjusted, in CO2
    // equivalent. Quarterly air emissions accounts are the only greenhouse gas
    // series that moves fast enough to sit next to quarterly GDP.
    dataset: 'env_ac_aigg_q',
    params: 'freq=Q&s_adj=SA&nace_r2=TOTAL_HH&airpol=GHG&unit=THS_T',
    freq: 'Q',
    title: 'Greenhouse gas emissions',
    unit: 'thousand tonnes CO2-eq',
    euAggregation: 'sum',
    sanity: [100, 50000],
  },

  // ---- Business demography ---------------------------------------------
  // The monthly table sts_rb_m carries Latvia only — Estonia and Lithuania
  // report these to the quarterly table, so a Baltic comparison has to use
  // sts_rb_q or it silently renders one country.
  business_registrations: {
    dataset: 'sts_rb_q',
    params: 'freq=Q&indic_bt=REG&nace_r2=B-S_X_O_S94&s_adj=SCA&unit=I21',
    freq: 'Q',
    title: 'New business registrations',
    unit: 'index (2021=100)',
    euAggregation: 'average',
    sanity: [10, 400],
  },
  bankruptcies: {
    dataset: 'sts_rb_q',
    params: 'freq=Q&indic_bt=BKRT&nace_r2=B-S_X_O_S94&s_adj=SCA&unit=I21',
    freq: 'Q',
    title: 'Bankruptcy declarations',
    unit: 'index (2021=100)',
    euAggregation: 'average',
    sanity: [10, 500],
  },

  // Freight, which is what a port statistic looks like once it leaves the port.
  //
  // The maritime tile counts tonnes across a quay; these two count tonnes
  // moving inland, and the split between them is a different question about the
  // same economy. Rail is also the clearest single measure of what the 2022
  // sanctions did to Baltic transit: Latvia carried 4,806 million tonne-km in a
  // quarter early in this window and 594 in 2026-Q1, a fall of nearly 90%.
  rail_freight: {
    dataset: 'rail_go_quartal',
    params: 'freq=Q&unit=MIO_TKM',
    freq: 'Q',
    title: 'Rail freight',
    unit: 'M tonne-km',
    euAggregation: 'sum',
    // Observed 71 (Estonia, 2025-Q4) to 4,806 (Latvia, pre-sanctions) across
    // eight years. The upper bound leaves room for a revision without being so
    // wide it would accept a percentage or a headcount by mistake.
    sanity: [10, 8000],
  },
  road_freight: {
    dataset: 'road_go_tq_tott',
    // `tra_type` carries four categories — HIRE, NSP, OWN and TOTAL — and an
    // unpinned dimension makes the parser choose a slice on our behalf and
    // report it in `assumptions`. Hire-and-reward alone is roughly two thirds
    // of the total, which is a plausible-looking number for the wrong thing.
    params: 'freq=Q&tra_oper=TOTAL&tra_type=TOTAL&unit=THS_T',
    freq: 'Q',
    title: 'Road freight',
    unit: 'k tonnes',
    euAggregation: 'sum',
    // Observed 4,413 (Estonia) to 36,034 (Lithuania).
    sanity: [500, 50000],
  },

  /**
   * The same road haulage measured in tonne-kilometres rather than tonnes.
   *
   * Both are real and they answer different questions: `road_freight` is how
   * much was lifted, this is how much was moved and how far. Only the second is
   * comparable with rail, because a tonne on a train travels much further than
   * a tonne on a lorry — so a modal split computed from tonnes lifted would
   * flatter road enormously and mean nothing.
   */
  road_freight_tkm: {
    dataset: 'road_go_tq_tott',
    params: 'freq=Q&tra_oper=TOTAL&tra_type=TOTAL&unit=MIO_TKM',
    freq: 'Q',
    title: 'Road freight (tonne-km)',
    unit: 'M tonne-km',
    euAggregation: 'sum',
    // Observed 897 (Estonia, 2025-Q4) to 17,547 (Lithuania).
    sanity: [100, 40000],
  },

  /**
   * The same network as `rail_freight`, carrying people instead of tonnes.
   *
   * It is worth having precisely because it does not track the freight series:
   * Latvia carries roughly twice Estonia's rail passengers and nearly four
   * times Lithuania's (4,653k, 2,058k and 1,198k thousand in the latest
   * quarter), which is the inverse of the freight ranking. A reader who has
   * just seen Latvian rail freight fall by nearly 90% since 2022 would
   * reasonably assume the railway is emptying; the passenger series says the
   * opposite, and the two together are a different story than either alone.
   *
   * Every dimension is pinned — the cube offers only `freq`, `unit`, `geo` and
   * `time`, and all three of the first are fixed here, so the parser is never
   * asked to choose a slice.
   */
  rail_passengers: {
    dataset: 'rail_pa_quartal',
    // The cube offers exactly two units, and they differ by a factor of ~25:
    // MIO_PKM (Latvia 162–212) and THS_PAS (Latvia 4,653–6,074). Pinning the
    // wrong one yields a well-formed series of plausible-looking numbers, so
    // the sanity band below is set to catch that specific mis-pin.
    params: 'freq=Q&unit=THS_PAS',
    freq: 'Q',
    title: 'Rail passengers',
    unit: 'k passengers',
    euAggregation: 'sum',
    // Observed 519 (Lithuania, at the 2020 trough) to 6,074 (Latvia) over
    // 2019-Q1..2026-Q2. The floor sits above Latvia's entire MIO_PKM range and
    // still 42% below the lowest quarter ever recorded, including the pandemic
    // collapse; the ceiling is about 2.5x the highest.
    sanity: [300, 15000],
  },

  // Real labour productivity per person, indexed to 2020.
  //
  // This is the series that explains a wage chart rather than restating it: pay
  // can only diverge for long if output per worker does. It is worth reading
  // carefully, because the obvious guess about who leads is wrong — Latvia is
  // at 111.7 against its 2020 base while Estonia is at 99.6, still below where
  // it started after peaking at 108.1 in 2021.
  labour_productivity: {
    dataset: 'nama_10_lp_ulc',
    params: 'freq=A&na_item=RLPR_PER&unit=I20',
    freq: 'A',
    title: 'Labour productivity per person',
    unit: 'index (2020=100)',
    euAggregation: 'average',
    // An index rebased to 100, so a decade of real movement stays well inside
    // this while a raw euro or headcount series would not.
    sanity: [60, 200],
  },
};

module.exports = INDICATORS;

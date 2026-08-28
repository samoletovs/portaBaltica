"""Research retrieval asks the finding what it is about, not the shelf it sits on.

THE MEASURED FAILURE
--------------------
Lithuania's crude birth rate hit a record low and the newsroom published it. The
five items research retrieved for that article, read back off the published
provenance, were:

    Farmers to recieve money to offset rising prices and bad weather
    Environment agency tracks record crane numbers as migration nears
    Commission endorses Greece's Social Climate Plan
    Latvijas Banka Publishes Its Climate-Related Financial Disclosures Report
    Daily News 25 / 08 / 2026

Not one about demographics, and the one document actually fetched and read into
the prompt was the climate disclosures report. The article closed by saying the
data did not show what drove the change.

The cause was that ``_topic_terms`` knew only the section vocabulary, and the
piece is filed under ``environment`` — the beat its correspondent covers — so
the only words available to match on were ``climate``, ``environment`` and
``weather``. The crane story matched. The birth rate story could not have.
"""

from __future__ import annotations

import pytest

from newsroom.pipeline import config, research
from newsroom.pipeline.models import FeedItem

from .conftest import make_signal


def _item(title: str, *, source_id: str = "err_en") -> FeedItem:
    return FeedItem(
        source_id=source_id,
        guid=title,
        title=title,
        link="https://news.err.ee/1",
        description="",
        published="Thu, 27 Aug 2026 10:00:00 +0300",
        retrieved_at="2026-08-27T17:08:01Z",
        raw_blob="",
    )


@pytest.fixture
def birth_rate():
    """The signal behind the published article this module was written after."""
    return make_signal(
        metric="birth_rate",
        metric_label="crude birth rate",
        section="environment",
        geography="LT",
        period="2025",
        unit="per thousand inhabitants",
        value=6.1,
    )


def test_the_metric_supplies_its_own_vocabulary(birth_rate):
    terms = research._topic_terms(birth_rate)
    assert "birth" in terms, "the finding's own subject must reach the matcher"
    assert "environment" in terms, "the section's synonyms are still wanted"


def test_a_relevant_headline_now_clears_the_bar(birth_rate):
    score = research._score(birth_rate, _item("Lithuania birth rate falls to record low"))
    assert score >= config.RESEARCH_MIN_RELEVANCE


def test_relevance_beats_the_story_it_used_to_lose_to(birth_rate):
    """The inversion, stated as a comparison rather than as a threshold.

    An absolute score is an implementation detail and would pin the weights.
    What must hold is the ordering: a story about the thing being reported
    outranks one that shares only a section label. Before this fix the
    demographic headline scored zero and the crane story was selected.
    """
    on_topic = research._score(
        birth_rate, _item("Lithuania birth rate falls to record low")
    )
    off_topic = research._score(
        birth_rate, _item("Environment agency tracks record crane numbers as migration nears")
    )
    assert on_topic > off_topic


def test_the_section_vocabulary_still_carries_synonyms_a_label_lacks():
    """Why the section terms were kept rather than replaced.

    "Day-ahead wholesale electricity price" does not contain the word "grid",
    and an energy story about the grid is squarely relevant. A metric label is
    a better subject than a section; it is not a thesaurus.
    """
    power = make_signal(
        metric="power_price",
        metric_label="day-ahead wholesale electricity price",
        section="energy",
        geography="LV",
        unit="EUR/MWh",
    )
    terms = research._topic_terms(power)
    assert "grid" in terms
    assert "electricity" in terms


def test_a_metric_label_contributing_only_stop_words_is_harmless():
    """The degenerate case: the union must never shrink below the section set."""
    thin = make_signal(
        metric="x", metric_label="the rate", section="labour", geography="LV", unit="%"
    )
    assert research._SECTION_TERMS["labour"] - research._STOP_WORDS <= research._topic_terms(
        thin
    )

"""The cap on a wrap's findings: where it falls, and which findings it keeps.

WHY THIS FILE EXISTS
--------------------
`MAX_FINDINGS` had no test at all. Measured on master before this file:
truncating to `MAX_FINDINGS - 1` left **1993 tests passing**. The cap could
silently drop to seven and every signal in the repo stayed green.

That is the plant class named in this programme as *the fixture never reaches
the discriminating region*: `MIN_FINDINGS` is exercised at exactly
`MIN_FINDINGS - 1` and `MIN_FINDINGS`, both sides of its boundary and expressed
relative to the constant so they cannot drift — a model of how to do it — while
the upper bound had no fixture with enough findings to reach it. Nothing was
weak or vacuous; there was simply never an input where the correct code and an
off-by-one disagree.

AND THE COMMENT WAS WRONG
-------------------------
The note above `MAX_FINDINGS` claimed "the highest-scoring findings are kept".
There is no score in `collect_week`: it sorts on `published_at` descending and
slices. The rule is recency. `collect_week`'s own docstring says "newest first"
and is correct, 120 lines below the wrong claim — so a reader who went to check
found an accurate statement and stopped looking.

A claim about behaviour, stated in guidance and never executed, is the failure
`AGENTS.md` describes for examples in prose. These tests execute it.

WHAT IS DELIBERATELY *NOT* ASSERTED HERE
----------------------------------------
Whether dropping the start of a busy week is the right editorial rule. It is a
real consequence — measured below — and it is a decision for an editor, not
something to freeze because it is today's behaviour. What is pinned is that the
rule is *recency*, so that if someone later decides a wrap should sample the
whole week, this file fails and the comment above `MAX_FINDINGS` has to be
rewritten in the same change.
"""

from __future__ import annotations

from datetime import date

import pytest

from newsroom.pipeline.weekly import MAX_FINDINGS, MIN_FINDINGS, collect_week

NOW = date(2026, 8, 30)  # a Sunday, which is when a wrap is written


class Figure:
    """The three fields `collect_week` reads off a `PublishedFigure`."""

    def __init__(self, slug: str, published_at: str) -> None:
        self.slug = slug
        self.published_at = published_at


def a_week(count: int, *, start_day: int = 24) -> list[Figure]:
    """`count` findings, one per article, spread forward from Monday 24 August.

    Distinct days where possible so the ordering under test is observable: a
    fixture where every figure shares a timestamp cannot tell "newest first"
    from "input order".
    """
    return [
        Figure(f"art-{i:02d}", f"2026-08-{start_day + (i % 7):02d}T09:00:00Z")
        for i in range(count)
    ]


#: The sizes of week the cap is exercised against.
#:
#: Named rather than inlined in the decorator so the control below can read the
#: values actually used. The first version asserted that the *helper* could
#: build a week larger than the cap, which is not the same claim: shrinking this
#: list to `[MAX_FINDINGS - 1]` left the helper untouched, so the control passed
#: while an off-by-one in the cap went undetected — the very blind spot this
#: file was written to close, reintroduced inside it. Found by planting both at
#: once.
CAP_CASES = [MAX_FINDINGS - 1, MAX_FINDINGS, MAX_FINDINGS + 4]


def test_the_fixture_reaches_past_the_cap() -> None:
    """Control, and the whole reason this file exists.

    Every assertion below is about truncation. If no case offered more findings
    than the cap, none of them could tell a correct cap from a wrong one — which
    is exactly the state master was in.

    Asserted against `CAP_CASES`, the list the parametrised test actually runs,
    rather than against the helper that builds the weeks. A guard that
    enumerates something adjacent to its subject is not a guard.
    """
    assert max(CAP_CASES) > MAX_FINDINGS, (
        f"no case in CAP_CASES={CAP_CASES} exceeds MAX_FINDINGS={MAX_FINDINGS}, "
        f"so the truncation is never exercised and an off-by-one in the cap "
        f"would pass every test in this file."
    )
    assert MAX_FINDINGS in CAP_CASES, (
        "the boundary itself must be a case: MAX_FINDINGS exactly is what "
        "separates [:MAX_FINDINGS] from [:MAX_FINDINGS - 1]."
    )


@pytest.mark.parametrize("offered", CAP_CASES)
def test_a_wrap_never_cites_more_than_the_cap(offered: int) -> None:
    """Both sides of the boundary and one beyond it.

    `MAX_FINDINGS` exactly is the case that separates `[:MAX_FINDINGS]` from
    `[:MAX_FINDINGS - 1]`; without it an off-by-one is invisible, which is what
    1993 passing tests demonstrated.
    """
    corpus = collect_week(a_week(offered), now=NOW)
    assert len(corpus) == min(offered, MAX_FINDINGS)


def test_the_cap_keeps_the_most_recent_findings_not_an_arbitrary_slice() -> None:
    """The rule the comment above MAX_FINDINGS now states.

    Written against the *ordering*, not against a fixed list of slugs, so it
    keeps meaning if the fixture changes size.
    """
    offered = a_week(MAX_FINDINGS + 4)
    corpus = collect_week(offered, now=NOW)

    kept = {f.slug for f in corpus.figures}
    dropped = [f for f in offered if f.slug not in kept]
    assert dropped, "control: the fixture must actually lose something"

    newest_dropped = max(f.published_at for f in dropped)
    oldest_kept = min(f.published_at for f in corpus.figures)
    assert oldest_kept >= newest_dropped, (
        f"a finding published {newest_dropped} was dropped while one from "
        f"{oldest_kept} was kept, so the cap is not taking the most recent. "
        f"If that is now intended, the comment above MAX_FINDINGS says "
        f"'recency, not merit' and must be rewritten in the same change."
    )


def test_the_findings_are_ordered_newest_first() -> None:
    """`collect_week`'s docstring claims this; nothing executed it either."""
    corpus = collect_week(a_week(MAX_FINDINGS + 4), now=NOW)
    stamps = [f.published_at for f in corpus.figures]
    assert stamps == sorted(stamps, reverse=True), stamps


def test_the_two_bounds_do_not_overlap() -> None:
    """A cap below the floor would refuse every week, whatever the week did.

    Not a hypothetical pair of constants: `is_worth_writing` rejects a corpus
    smaller than `MIN_FINDINGS`, and `collect_week` can never return more than
    `MAX_FINDINGS`, so `MAX < MIN` makes a wrap unwritable while every run
    reports the ordinary "not enough findings" outcome — indistinguishable from
    a quiet week, forever.
    """
    assert MIN_FINDINGS <= MAX_FINDINGS, (
        f"MIN_FINDINGS={MIN_FINDINGS} exceeds MAX_FINDINGS={MAX_FINDINGS}, so "
        f"no week can ever produce a publishable wrap."
    )

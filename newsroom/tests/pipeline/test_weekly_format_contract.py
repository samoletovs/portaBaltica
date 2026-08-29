"""The wrap's ``format`` value has one definition, and every copy agrees.

WHAT THIS PREVENTS, AND WHY NOTHING ELSE CATCHES IT
---------------------------------------------------
``/weekly`` selects its content on one string. ``weekly.py`` stamps
``article.format = WEEKLY_FORMAT`` on a wrap it publishes, and ``news-api.ts``
finds it again with ``article.format === 'weekly_wrap'``. Those two literals are
written out independently, in two languages, and until this file nothing
required them to be the same string.

Measured on master, by renaming the value in both Python artefacts together --
the constant and the schema enum, which is what a real rename would touch --
and leaving the frontend alone:

    python -m pytest newsroom/tests -q      1946 passed
    npm run test                            2030 passed, 114 files

Three thousand nine hundred and seventy-six tests green, and ``/weekly`` empty
forever. ``weeklyWraps`` would filter for a value no article can now carry, so
the page falls to its "no review published" state and stays there.

That is the failure worth the file: **the broken state is byte-identical to the
honest one**. The page cannot tell "nothing was published this week" from
"something was published under a name I do not recognise", and neither can a
reader, and neither could an audit -- an audit did in fact record ``/weekly``
as "renders but is unpopulated", which is exactly what both states look like.

WHY ONLY THIS EDGE
------------------
The obvious instinct is to assert every copy of the literal against every other.
Measured, that would be four assertions duplicating the TypeScript compiler.
Changing ``ArticleFormat`` alone and building gives:

    src/news-api.ts(134,26)                  error TS2367  no overlap
    src/components/news/ArticleView.tsx(374) error TS2367  no overlap
    src/components/news/FormatBadge.tsx(4,3) error TS2353  unknown property

So the three frontend copies are already held together -- ``FormatBadge`` keys a
``Record<ArticleFormat, ...>``, and the two comparisons are literal-typed. A test
re-checking those would be belt-and-braces against a state the build cannot
reach.

The language boundary is the one edge no compiler spans, and it is the only one
asserted here. This mirrors ``newsroom/tests/test_one_section_list.py``, which
reached the same conclusion for the ``section`` taxonomy and says so: "Python
cannot import a TypeScript constant, and a JSON Schema cannot import anything.
So they are asserted instead."

THE SIBLING THAT CONCEALED IT
-----------------------------
That file guards ``section`` across ``weekly.py``, the schema and ``sections.ts``
-- three artefacts, two languages, fully asserted. ``format`` sat beside it with
nothing, and ``format`` is the field ``/weekly`` actually selects on. A reader
checking whether the wrap's identity fields were guarded would have found the
section assertions and stopped, which is how the gap survived: not a missing
idea, a departure from a pattern already present.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]

SCHEMA_JSON = REPO / "newsroom" / "schemas" / "article.schema.json"
NEWS_TYPES_TS = REPO / "src" / "news-types.ts"
NEWS_API_TS = REPO / "src" / "news-api.ts"


def _typescript_article_formats() -> list[str]:
    """The formats the frontend's type admits.

    Reads the union rather than a list of examples, so adding a second format to
    TypeScript without adding it to the schema fails here rather than shipping a
    value validation will reject.
    """
    source = NEWS_TYPES_TS.read_text(encoding="utf-8")
    match = re.search(r"export type ArticleFormat\s*=\s*([^;]+);", source)
    # Absence must not resolve to success. A renamed or reformatted declaration
    # makes this regex miss, and a miss that returned [] would compare empty to
    # empty in at least one direction and pass while checking nothing.
    assert match is not None, (
        "ArticleFormat not found in src/news-types.ts. This guard reads that "
        "union; if the declaration moved, point it at the new one rather than "
        "deleting the assertion."
    )
    formats = re.findall(r"'([a-z_]+)'", match.group(1))
    assert formats, f"ArticleFormat parsed to nothing from: {match.group(1)!r}"
    return sorted(formats)


def _schema_formats() -> list[str]:
    schema = json.loads(SCHEMA_JSON.read_text(encoding="utf-8"))
    enum = schema["properties"]["format"]["enum"]
    assert enum, "article.schema.json declares an empty format enum"
    return sorted(enum)


def test_the_writer_stamps_a_format_the_frontend_can_select() -> None:
    """The one edge no compiler spans, asserted in the direction that breaks."""
    from newsroom.pipeline.weekly import WEEKLY_FORMAT

    assert WEEKLY_FORMAT in _typescript_article_formats(), (
        f"weekly.py stamps format={WEEKLY_FORMAT!r} and src/news-types.ts does "
        f"not admit it. weeklyWraps() in src/news-api.ts selects /weekly's "
        f"content on this string, so a wrap published under a value the "
        f"frontend does not know is invisible -- and the page renders its "
        f"'no review published' state, which is indistinguishable from the "
        f"truth. Change both copies or neither."
    )


def test_validation_admits_exactly_the_formats_the_frontend_renders() -> None:
    """The schema is the gate; the type is the reader. They must be one set.

    Equality rather than membership, and in both directions on purpose. A format
    the schema admits but the frontend cannot type is an article that publishes
    and renders no badge; a format the frontend types but the schema rejects is a
    page branch no article can ever reach.
    """
    assert _schema_formats() == _typescript_article_formats(), (
        f"article.schema.json admits {_schema_formats()} and "
        f"src/news-types.ts declares {_typescript_article_formats()}. These are "
        f"the same set in two languages and neither may grow alone."
    )


def test_the_frontend_selects_on_the_value_it_declares() -> None:
    """The selector uses a literal, and this is what ties it to the union.

    The TypeScript compiler already rejects a mismatch here -- measured as
    ``TS2367: no overlap`` -- so this assertion is not the guard. It is the
    control for the two above: it proves the string this file has been comparing
    is the one ``/weekly`` genuinely filters on, rather than a constant that
    agrees everywhere and is read nowhere.
    """
    source = NEWS_API_TS.read_text(encoding="utf-8")
    match = re.search(r"article\.format\s*===\s*'([a-z_]+)'", source)
    assert match is not None, (
        "no `article.format === '...'` comparison in src/news-api.ts. If "
        "weeklyWraps stopped selecting on format, the two assertions above are "
        "guarding a value nothing reads."
    )
    from newsroom.pipeline.weekly import WEEKLY_FORMAT

    assert match.group(1) == WEEKLY_FORMAT, (
        f"weeklyWraps() selects on {match.group(1)!r} and weekly.py stamps "
        f"{WEEKLY_FORMAT!r}."
    )


def test_the_guard_is_reading_real_files() -> None:
    """Vacuity floor.

    Every assertion above compares two things read off disk. If a path were
    wrong the reads would raise, but a future refactor that made either helper
    return a default would make the comparisons trivially true. This states the
    population is non-empty and that the value under test is the live one.
    """
    from newsroom.pipeline.weekly import WEEKLY_FORMAT

    assert SCHEMA_JSON.exists() and NEWS_TYPES_TS.exists() and NEWS_API_TS.exists()
    assert _schema_formats(), "the schema format enum read as empty"
    assert _typescript_article_formats(), "the TypeScript union read as empty"
    assert WEEKLY_FORMAT, "WEEKLY_FORMAT is falsy"

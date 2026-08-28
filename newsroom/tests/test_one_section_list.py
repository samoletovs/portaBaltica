"""The dashboard's section taxonomy has one definition, and every copy agrees.

``weekly.py`` already states the risk, in a comment, and nothing enforces it:

    #: The dashboard sections an article may be filed under. A wrap uses one of
    #: these like anything else: the newsroom borrows the dashboard's taxonomy,
    #: and a section with no tile behind it would break the article to /data
    #: round trip.

That is the whole failure, named accurately, sitting next to a hand-written
tuple that can drift from the taxonomy it says it borrows. The same nine strings
are written out in six places across three languages:

    src/sections.ts                       what the dashboard renders
    src/components/Header.tsx             what a reader can click
    api/news-sitemap/index.js             what search engines are told exists
    newsroom/pipeline/models.py           what an article may be filed under
    newsroom/pipeline/weekly.py           what a wrap may be filed under
    newsroom/schemas/article.schema.json  what validation admits

The frontend three were collapsed into one import and two derivations. These
cannot be: Python cannot import a TypeScript constant, and a JSON Schema cannot
import anything. So they are asserted instead — the copies stay, and none of
them may drift alone.

The failure this prevents is silent in the direction that reaches a reader. An
article filed under a section the dashboard does not render passes validation,
publishes, and links to ``/data/<section>`` — where ``App.tsx`` falls back to
``'all'`` and serves the Overview. The round trip the comment is worried about
breaks by rendering the wrong page, not by erroring.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

SECTIONS_TS = REPO / "src" / "sections.ts"
SITEMAP_JS = REPO / "api" / "news-sitemap" / "index.js"
SCHEMA_JSON = REPO / "newsroom" / "schemas" / "article.schema.json"


def _quoted(block: str) -> list[str]:
    """Every single- or double-quoted string in a source fragment."""
    return re.findall(r"['\"]([a-z_]+)['\"]", block)


def _dashboard_sections() -> list[str]:
    """The canonical list, from the value the dashboard actually branches on."""
    source = SECTIONS_TS.read_text(encoding="utf-8")
    match = re.search(
        r"export const DASHBOARD_SECTIONS\s*=\s*\[(.*?)\]\s*as const;",
        source,
        flags=re.DOTALL,
    )
    assert match is not None, "DASHBOARD_SECTIONS not found in src/sections.ts"

    found = _quoted(match.group(1))
    # An empty list would make every comparison below pass, which is the one
    # outcome that must not read as agreement.
    assert found, "DASHBOARD_SECTIONS parsed to an empty list — the read is broken"
    return found


def _sitemap_sections() -> list[str]:
    source = SITEMAP_JS.read_text(encoding="utf-8")
    match = re.search(r"const SECTIONS\s*=\s*\[(.*?)\];", source, flags=re.DOTALL)
    assert match is not None, "SECTIONS not found in api/news-sitemap/index.js"

    found = _quoted(match.group(1))
    assert found, "sitemap SECTIONS parsed to an empty list — the read is broken"
    return found


def test_the_canonical_list_parses_and_is_not_empty() -> None:
    """The control for everything below.

    Each comparison here is against ``_dashboard_sections()``. If that read
    silently returned ``[]`` every other test would pass while checking
    nothing, so its emptiness is asserted on its own rather than only inside
    the comparisons that depend on it.
    """
    sections = _dashboard_sections()
    assert len(sections) > 6, f"suspiciously few sections parsed: {sections}"
    assert "overview" not in sections, (
        "the overview is /data itself, never /data/overview — a section by that "
        "name would render the Overview twice under two URLs"
    )


def test_the_pipeline_files_articles_under_sections_the_dashboard_renders() -> None:
    from newsroom.pipeline.models import SECTIONS

    assert sorted(SECTIONS) == sorted(_dashboard_sections()), (
        "newsroom/pipeline/models.py and src/sections.ts disagree. An article "
        "filed under a section with no tile behind it links to /data/<section>, "
        "which renders the Overview instead of erroring."
    )


def test_the_weekly_wrap_uses_the_same_taxonomy() -> None:
    from newsroom.pipeline.weekly import SECTION_LABELS_ALLOWED

    assert sorted(SECTION_LABELS_ALLOWED) == sorted(_dashboard_sections()), (
        "weekly.py's SECTION_LABELS_ALLOWED and src/sections.ts disagree — the "
        "comment above that tuple says it borrows the dashboard's taxonomy, so "
        "this is the assertion that makes the comment true."
    )


def test_validation_admits_exactly_those_sections() -> None:
    schema = json.loads(SCHEMA_JSON.read_text(encoding="utf-8"))
    enum = schema["properties"]["section"]["enum"]

    assert sorted(enum) == sorted(_dashboard_sections()), (
        "article.schema.json's section enum and src/sections.ts disagree. The "
        "schema is the gate: a section it admits but the dashboard cannot "
        "render publishes a working article that links to the wrong page."
    )


def test_the_sitemap_advertises_exactly_those_sections() -> None:
    assert sorted(_sitemap_sections()) == sorted(_dashboard_sections()), (
        "api/news-sitemap and src/sections.ts disagree. The sitemap is what "
        "search engines are told exists, so a section here that the dashboard "
        "does not render advertises a duplicate of the Overview under its own "
        "URL."
    )

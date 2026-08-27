"""The newsroom has one roster, and every copy of it agrees.

PR #43 renamed the whole newsroom to lighthouse surnames and said why:

    "Ilze Bērziņa" reads as an ordinary Latvian name and does none of the
    disclosure work; "Ilze Nida" reads as a place and quietly reinforces the
    label instead of fighting it.

It applied that rename to the frontend registry and to the published policy,
and it never touched ``personas.yaml`` — which is the copy the pipeline
actually bylines articles from. So for every article written since, the stored
byline, the RSS ``<dc:creator>`` and the provenance passport carried the older,
more human-sounding surname, while the page rendered the lighthouse one.

Nothing failed, because ``renderByline`` rebuilds the byline from the frontend
registry and repairs the difference on the way to the screen. That repair was
written for a backlog of already-filed articles; instead it silently corrected
every new one, so a half-finished migration looked complete from the only place
anyone looks.

These tests assert the seam rather than the surnames. ``newsroomRoster.test.tsx``
pins the lighthouse list on the frontend side; if the two rosters must agree,
that pin reaches ``personas.yaml`` too, and neither file can drift alone.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from newsroom.persona_rules import PersonaRegistry

REPO = Path(__file__).resolve().parents[2]
CORRESPONDENTS_TS = REPO / "src" / "newsroom" / "correspondents.ts"
EDITORIAL_TS = REPO / "src" / "newsroom" / "editorial.ts"
AI_USE_POLICY = REPO / "newsroom" / "policy" / "ai-use.md"

EDITOR_ID = "saulkrasti"


def _frontend_roster() -> dict[str, str]:
    """``{id: name}`` as the browser knows it, read out of the TS source."""
    source = CORRESPONDENTS_TS.read_text(encoding="utf-8")
    pairs = re.findall(
        r"id:\s*'([a-z]+)',.*?name:\s*'([^']+)'",
        source,
        flags=re.DOTALL,
    )
    # `id:` also appears in helper maps further down the file; the roster
    # entries are the ones whose id is a persona id, so filter rather than
    # trusting position.
    return dict(pairs)


def _editorial_editor_name() -> str:
    source = EDITORIAL_TS.read_text(encoding="utf-8")
    match = re.search(r"id:\s*'saulkrasti',\s*\n\s*name:\s*'([^']+)'", source)
    assert match is not None, "editorial.ts no longer declares an AI_EDITOR name"
    return match.group(1)


@pytest.fixture(scope="module")
def personas() -> PersonaRegistry:
    return PersonaRegistry.load()


class TestOneRoster:
    def test_the_pipeline_and_the_browser_name_the_same_people(
        self, personas: PersonaRegistry
    ) -> None:
        """The seam that broke: two rosters, one repaired on render."""
        frontend = _frontend_roster()

        drifted = {
            persona_id: (personas.get(persona_id).name, frontend[persona_id])
            for persona_id in personas.ids()
            if persona_id in frontend
            and personas.get(persona_id).name != frontend[persona_id]
        }

        assert not drifted, (
            "personas.yaml and correspondents.ts disagree, so the stored byline "
            f"and the rendered one are different names: {drifted}"
        )

    def test_every_correspondent_reaches_the_browser(
        self, personas: PersonaRegistry
    ) -> None:
        """A persona the frontend has never heard of gets no repair and no page."""
        frontend = _frontend_roster()
        missing = [
            persona_id
            for persona_id in personas.ids()
            if persona_id != EDITOR_ID and persona_id not in frontend
        ]

        assert not missing, f"no correspondent entry in correspondents.ts for {missing}"

    def test_the_editor_has_one_name(self, personas: PersonaRegistry) -> None:
        """personas.yaml, desk.py and editorial.ts, checked together."""
        from newsroom.pipeline.desk import _editor_name

        names = {
            "personas.yaml": personas.get(EDITOR_ID).name,
            "desk.py": _editor_name(),
            "editorial.ts": _editorial_editor_name(),
        }

        assert len(set(names.values())) == 1, (
            f"the editor is signing under more than one name: {names}"
        )

    def test_the_published_policy_names_the_people_it_bylines(
        self, personas: PersonaRegistry
    ) -> None:
        """A reader checking our claims reads this page and then a byline."""
        policy = AI_USE_POLICY.read_text(encoding="utf-8")

        absent = [
            personas.get(persona_id).name
            for persona_id in personas.ids()
            if personas.get(persona_id).name not in policy
        ]

        assert not absent, (
            "ai-use.md names correspondents who do not exist under those names: "
            f"{absent}"
        )

    def test_the_policy_does_not_scope_the_editor_to_syndication(self) -> None:
        """One editor reviews original articles and syndication decisions alike.

        `desk.py` runs on every tier A article we write, so describing the
        editor as the one "for syndicated items" understates the role in the
        direction that matters: it tells a reader nobody reviewed our own
        journalism.
        """
        policy = AI_USE_POLICY.read_text(encoding="utf-8")

        assert "editor for syndicated items" not in policy

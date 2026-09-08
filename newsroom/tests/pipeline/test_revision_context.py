"""A stateless revision must receive the complete draft it is asked to preserve."""

from __future__ import annotations

from copy import deepcopy
import json
import re

import pytest

from newsroom.pipeline.models import Article, Block, Figure
from newsroom.pipeline.write import StubWriter, generate_article
from newsroom.pipeline.write.prompts import build_revision_prompt, build_revision_system_prompt
from newsroom.tests.pipeline.conftest import make_signal
from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD


def draft_in(prompt: str) -> dict:
    match = re.search(
        r"<<<PREVIOUS_DRAFT_([a-f0-9]+)>>>\n(.*?)\n<<</PREVIOUS_DRAFT_\1>>>",
        prompt,
        re.S,
    )
    assert match is not None, "the revision has no complete, nonce-fenced draft"
    return json.loads(match[2])


@pytest.mark.parametrize("location", ["headline", "dek", "body[2]"])
def test_every_failure_location_receives_the_whole_editable_draft(location: str) -> None:
    article = Article(
        id="draft", slug="draft", tier="A", status="rejected", section="labour",
        created_at="2026-09-07T14:00:00Z",
        headline="Unemployment rises in Latvia",
        dek="This increase highlights growing pressure on employers.",
        provenance={"validator": {"passed": False}},
        body=[
            Block(
                "paragraph", text="The unemployment rate is 6.8%.",
                figures=[Figure(6.8, "latest_value", "%", "6.8%")],
            ),
            Block("chart", chart_ref="unemployment"),
            Block("paragraph", text="The increase reflects weaker demand."),
        ],
        tags=["labour", "latvia"],
    )
    prompt = build_revision_prompt(
        "VERIFIED BRIEF", f"no_unsupported_mechanism: {location}: unsupported explanation",
        article,
    )
    draft = draft_in(prompt)
    assert draft == {
        "headline": article.headline,
        "dek": article.dek,
        "blocks": [
            {
                "body_index": 0, "text": article.body[0].text,
                "figures": [article.body[0].figures[0].to_json()],
            },
            {"body_index": 2, "text": article.body[2].text, "figures": []},
        ],
        "tags": article.tags,
    }
    assert "validator" not in draft
    assert "VERIFIED BRIEF" in prompt
    assert location in prompt


def test_each_generation_retry_receives_its_own_previous_draft() -> None:
    first = deepcopy(GOOD_PAYLOAD)
    first["dek"] = "The increase highlights growing pressure on employers."
    second = deepcopy(first)
    second["dek"] = "The rise reflects a weakening labour market."
    writer = StubWriter([first, second, GOOD_PAYLOAD])

    result = generate_article(make_signal(), writer)

    assert result.publishable
    assert len(writer.calls) == 3
    assert writer.calls[0]["system"] != build_revision_system_prompt()
    assert writer.calls[1]["system"] == writer.calls[2]["system"] == build_revision_system_prompt()
    assert draft_in(writer.calls[1]["user"])["dek"] == first["dek"]
    assert draft_in(writer.calls[2]["user"])["dek"] == second["dek"]
    for call in writer.calls[1:]:
        draft = draft_in(call["user"])
        assert draft["headline"] == GOOD_PAYLOAD["headline"]
        assert draft["blocks"][0]["text"] == GOOD_PAYLOAD["blocks"][0]["text"]
        assert draft["blocks"][0]["figures"] == GOOD_PAYLOAD["blocks"][0]["figures"]


def test_revision_without_an_article_does_not_invent_a_previous_draft() -> None:
    prompt = build_revision_prompt("VERIFIED BRIEF", "no_unsupported_mechanism: dek")
    assert "PREVIOUS_DRAFT_" not in prompt
    assert "VERIFIED BRIEF" in prompt

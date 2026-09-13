"""A stateless revision must receive the complete draft it is asked to preserve."""

from __future__ import annotations

from copy import deepcopy
import json
import re

import pytest

from newsroom.pipeline.models import Article, Block, Figure
from newsroom.pipeline.run import RunReport, _revision_for
from newsroom.pipeline.write import StubWriter, generate_article
from newsroom.pipeline.write.generator import GenerationRefused
from newsroom.pipeline.write.prompts import build_revision_prompt, build_revision_system_prompt
from newsroom.tests.pipeline.conftest import make_signal
from newsroom.tests.pipeline.test_generation import GOOD_PAYLOAD


def draft_in(prompt: str) -> dict:
    matches = list(re.finditer(
        r"<<<PREVIOUS_DRAFT_([a-f0-9]+)>>>\n(.*?)\n<<</PREVIOUS_DRAFT_\1>>>",
        prompt,
        re.S,
    ))
    assert len(matches) == 1, "each revision needs exactly one current, nonce-fenced draft"
    return json.loads(matches[0][2])


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


def test_desk_revision_edits_the_article_the_callback_received() -> None:
    generated = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD))
    assert generated.publishable
    reviewed = deepcopy(generated.article)
    reviewed.dek = "The desk reviewed this copy, not the earlier generated draft."
    reviewed.body.insert(0, Block("chart", chart_ref="unemployment_rate"))
    writer = StubWriter(GOOD_PAYLOAD)

    revised = _revision_for(generated, writer, RunReport())(
        reviewed, ["Keep the supported comparison and shorten the standfirst."]
    )

    assert revised is not None
    assert revised.id == reviewed.id
    assert revised.slug == reviewed.slug
    assert writer.calls[0]["system"] == build_revision_system_prompt()
    draft = draft_in(writer.calls[0]["user"])
    assert draft["headline"] == reviewed.headline
    assert draft["dek"] == reviewed.dek
    assert draft["tags"] == reviewed.tags
    assert draft["blocks"] == [
        {
            "body_index": index,
            "text": block.text,
            "figures": [figure.to_json() for figure in block.figures],
        }
        for index, block in enumerate(reviewed.body)
        if block.type == "paragraph"
    ]
    assert "Keep the supported comparison" in writer.calls[0]["user"]
    assert "VERIFIED FIGURES" in writer.calls[0]["user"]
    assert "failed validation" not in writer.calls[0]["user"]
    assert reviewed.provenance == generated.article.provenance


def test_failed_desk_rewrite_retries_its_new_copy_not_the_original() -> None:
    generated = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD))
    assert generated.publishable
    bad = deepcopy(GOOD_PAYLOAD)
    bad["dek"] = "The increase highlights growing pressure on employers."
    writer = StubWriter([bad, GOOD_PAYLOAD])

    revised = _revision_for(generated, writer, RunReport())(
        generated.article, ["Shorten the standfirst."]
    )

    assert revised is not None
    assert len(writer.calls) == 2
    assert draft_in(writer.calls[0]["user"])["dek"] == generated.article.dek
    assert draft_in(writer.calls[1]["user"])["dek"] == bad["dek"]
    assert all(call["system"] == build_revision_system_prompt() for call in writer.calls)
    assert all("Shorten the standfirst." in call["user"] for call in writer.calls)


def test_desk_rewrite_cannot_bypass_validation_or_mutate_the_valid_original() -> None:
    generated = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD))
    assert generated.publishable
    before = generated.article.to_json()
    bad = deepcopy(GOOD_PAYLOAD)
    bad["blocks"][0]["text"] += " There are 99999 people registered."
    writer = StubWriter(bad)

    revised = _revision_for(generated, writer, RunReport())(
        generated.article, ["Expand the comparison."]
    )

    assert revised is None
    assert len(writer.calls) == 3
    assert draft_in(writer.calls[0]["user"])["headline"] == generated.article.headline
    assert generated.article.to_json() == before


def test_desk_notes_without_a_draft_are_refused_before_spending_a_call() -> None:
    writer = StubWriter(GOOD_PAYLOAD)

    with pytest.raises(GenerationRefused, match="complete previous draft"):
        generate_article(make_signal(), writer, editor_notes=["Shorten the standfirst."])

    assert writer.calls == []


def test_a_desk_request_without_specific_notes_still_receives_its_draft() -> None:
    generated = generate_article(make_signal(), StubWriter(GOOD_PAYLOAD))
    assert generated.publishable
    writer = StubWriter(GOOD_PAYLOAD)

    revised = _revision_for(generated, writer, RunReport())(generated.article, [])

    assert revised is not None
    assert draft_in(writer.calls[0]["user"])["dek"] == generated.article.dek
    assert writer.calls[0]["system"] == build_revision_system_prompt()


def test_weekly_desk_revision_receives_the_complete_wrap() -> None:
    from newsroom.pipeline.weekly import _wrap_revision, collect_week, corpus_signal, period_problems
    from newsroom.tests.pipeline.test_weekly import HOUSE, NOW, _wrap_payload, a_week

    corpus = collect_week(a_week(5), now=NOW)
    signal = corpus_signal(corpus)
    payload = _wrap_payload([
        {
            "text": "Latvian house prices stood at 1.0%, against the same quarter a year earlier.",
            "figures": [HOUSE],
        },
        {"text": "The data does not establish a common cause.", "figures": []},
    ])
    generated = generate_article(signal, StubWriter(payload))
    assert generated.publishable
    assert period_problems(generated.article, corpus) == []
    writer = StubWriter(payload)

    revised = _wrap_revision(signal, writer, corpus)(
        generated.article, ["Keep the observations in their stated periods."]
    )

    assert revised is not None
    assert period_problems(revised, corpus) == []
    draft = draft_in(writer.calls[0]["user"])
    assert draft["headline"] == generated.article.headline
    assert draft["blocks"][0]["figures"] == [
        figure.to_json() for figure in generated.article.body[0].figures
    ]
    assert writer.calls[0]["system"] == build_revision_system_prompt()

"""Editor-agent tests for tier B/C decisions.

The editor is a judgement layer, not a validator bypass. These tests are
negative-first where the guard matters: a failing validator verdict must not be
laundered into approval, and an escalation channel that cannot report failure
must stop the stage rather than pretending Sam was notified.
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
import pytest
from openai import BadRequestError

from newsroom.pipeline.editor import (
    EditorAction,
    EditorError,
    TelegramEscalationNotifier,
    edit_syndicated_articles,
    render_escalation_message,
    review_syndicated_article,
)
from newsroom.pipeline.publish import is_servable
from newsroom.pipeline.syndicate import syndicate
from newsroom.pipeline.write import StubWriter
from newsroom.tests.pipeline.test_syndicate import SNIPPET, feed_item


def tier_c_card():
    cards = syndicate([feed_item()], raw_descriptions={"lsm-1": SNIPPET})
    assert len(cards) == 1
    return cards[0]


@dataclass
class RecordingNotifier:
    calls: int = 0

    def notify(self, article, outcome) -> None:
        self.calls += 1


class FailingNotifier:
    def notify(self, article, outcome) -> None:
        raise EditorError("Telegram refused the escalation")


class OneFailureThenApprovalWriter:
    model_name = "mixed-writer"

    def __init__(self) -> None:
        self.calls = 0

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, object]:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("first item cannot be reviewed")
        return {"decision": "approve", "reason": "Second item is relevant."}


class ContentFilterWriter:
    model_name = "gpt-4o-mini"

    def complete_json(self, *, system: str, user: str, max_tokens: int) -> dict[str, object]:
        body = {
            "error": {
                "code": "content_filter",
                "innererror": {
                    "code": "ResponsibleAIPolicyViolation",
                    "content_filter_result": {
                        "jailbreak": {"detected": True, "filtered": True},
                        "violence": {"filtered": False},
                    },
                },
            }
        }
        raise BadRequestError(
            "Error code: 400 - content_filter",
            response=httpx.Response(
                400,
                request=httpx.Request("POST", "https://example.invalid/openai"),
            ),
            body=body,
        )


def test_editor_should_approve_a_valid_routine_link_card_without_rewriting():
    card = tier_c_card()
    original_syndicated = dict(card.syndicated or {})
    writer = StubWriter({"decision": "approve", "reason": "Baltic public-interest item."})

    outcome = review_syndicated_article(card, writer)

    assert outcome.action is EditorAction.APPROVE
    assert card.status == "published"
    # published_at is the OUTLET's date and is left alone; when we approved it
    # is a separate fact and is recorded separately. Overwriting one with the
    # other misdated every link-out to our run time.
    assert card.published_at == "2026-08-24T08:00:00Z"
    assert card.provenance["approved_at"] == outcome.decided_at
    assert card.body == []
    assert card.syndicated == original_syndicated
    assert card.provenance["approved_by"].startswith("Dace Saulkrasti")
    assert card.provenance["editor"]["decision"] == "approve"


def test_editor_should_never_approve_an_article_that_failed_validation():
    card = tier_c_card()
    card.provenance["validator"] = {
        "passed": False,
        "checked_at": "2026-08-24T00:00:00Z",
        "checks": [{"name": "snippet_verbatim", "passed": False}],
    }
    writer = StubWriter({"decision": "approve", "reason": "Looks fine."})

    outcome = review_syndicated_article(card, writer)

    assert outcome.action is EditorAction.REJECT
    assert card.status == "rejected"
    assert "cannot override" in outcome.reason
    assert writer.calls == []


def test_editor_should_reject_when_the_model_is_uncertain_or_invalid():
    card = tier_c_card()
    writer = StubWriter({"decision": "maybe", "reason": "Not sure."})

    outcome = review_syndicated_article(card, writer)

    assert outcome.action is EditorAction.REJECT
    assert card.status == "rejected"
    assert "invalid decision" in outcome.reason


def test_editor_should_escalate_dangerous_content_and_reject_it_after_notification():
    card = tier_c_card()
    notifier = RecordingNotifier()
    writer = StubWriter({"decision": "escalate", "reason": "Contains instructions for harm."})

    outcome = review_syndicated_article(card, writer, notifier=notifier)

    assert notifier.calls == 1
    assert outcome.action is EditorAction.ESCALATE
    assert outcome.notified is True
    assert card.status == "rejected"
    assert card.provenance["editor"]["notified_accountable_editor"] is True


def test_escalation_failure_should_raise_and_leave_the_item_unpublished():
    card = tier_c_card()
    writer = StubWriter({"decision": "escalate", "reason": "Contains graphic harm."})

    with pytest.raises(EditorError, match="Telegram refused"):
        review_syndicated_article(card, writer, notifier=FailingNotifier())

    assert card.status == "pending_approval"
    # "Unpublished" is a fact about status, not about the timestamp. The card
    # carries the outlet's own publication date from the moment it is built, so
    # asserting that were None only ever tested that we had not yet stamped it
    # with our own.
    assert not is_servable(card)
    assert "approved_at" not in card.provenance
    assert "editor" not in card.provenance


def test_content_filter_refusal_should_withhold_without_paging():
    """A refusal to assess is a limit of the tool, not a safety finding.

    This asserted the opposite until a production run settled it: of 129
    editor decisions, 26 were content-filter refusals. Every one would have
    sent Sam a Telegram message, and none of them was a judgement about our
    content — Azure's prompt shield fires routinely on the war coverage a
    Baltic wire carries daily.

    Twenty-six pages in one run is not vigilance. It is how the escalation
    channel stops being read before the day it matters. The item is withheld,
    which is the protection that actually counts, and the reason is recorded
    on the article so the decision is auditable rather than silent.
    """
    card = tier_c_card()
    notifier = RecordingNotifier()

    outcome = review_syndicated_article(card, ContentFilterWriter(), notifier=notifier)

    assert notifier.calls == 0, "an unassessable item must not page the accountable editor"
    assert outcome.action is EditorAction.REJECT
    assert outcome.notified is False
    assert "content filter refused" in outcome.reason
    assert "jailbreak" in outcome.reason, "the triggered category is still recorded"
    assert card.status == "rejected", "it must not publish"
    assert card.provenance["editor"]["decision"] == "reject"


def test_a_model_judgement_of_danger_still_pages():
    """The counterpart. Narrowing the content-filter path must not narrow this.

    Escalation keeps exactly one meaning: the model read the item and judged it
    dangerous, harmful or inappropriate. That is the case Sam asked to see.
    """
    card = tier_c_card()
    notifier = RecordingNotifier()
    writer = StubWriter({"decision": "escalate", "reason": "Contains graphic harm."})

    outcome = review_syndicated_article(card, writer, notifier=notifier)

    assert notifier.calls == 1
    assert outcome.action is EditorAction.ESCALATE
    assert outcome.notified is True


def test_telegram_notifier_should_report_telegram_refusal(monkeypatch):
    card = tier_c_card()
    outcome = review_syndicated_article(
        card,
        StubWriter({"decision": "escalate", "reason": "Contains graphic harm."}),
        notifier=RecordingNotifier(),
    )

    class RefusedResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, object]:
            return {"ok": False, "description": "bot was removed from the chat"}

    def refused_post(*args, **kwargs) -> RefusedResponse:
        return RefusedResponse()

    monkeypatch.setattr("newsroom.pipeline.editor.httpx.post", refused_post)

    with pytest.raises(EditorError, match="bot was removed"):
        TelegramEscalationNotifier(token="token", chat_id="chat").notify(card, outcome)


def test_edit_stage_should_decide_every_pending_syndicated_card():
    card = tier_c_card()
    writer = StubWriter({"decision": "approve", "reason": "Relevant."})

    outcomes = edit_syndicated_articles([card], writer)

    assert [outcome.action for outcome in outcomes] == [EditorAction.APPROVE]
    assert card.status == "published"


def test_edit_stage_should_isolate_one_item_failure_from_the_rest_of_the_batch():
    bad = tier_c_card()
    good = tier_c_card()
    writer = OneFailureThenApprovalWriter()

    outcomes = edit_syndicated_articles([bad, good], writer)

    assert [outcome.action for outcome in outcomes] == [
        EditorAction.REJECT,
        EditorAction.APPROVE,
    ]
    assert "first item cannot be reviewed" in outcomes[0].reason
    assert bad.status == "rejected"
    assert good.status == "published"


def test_edit_stage_should_still_surface_escalation_delivery_failure():
    card = tier_c_card()

    with pytest.raises(EditorError, match="Telegram refused"):
        edit_syndicated_articles(
            [card],
            StubWriter({"decision": "escalate", "reason": "Contains graphic harm."}),
            notifier=FailingNotifier(),
        )

    assert card.status == "pending_approval"


def test_escalation_message_should_escape_untrusted_feed_text():
    card = tier_c_card()
    card.headline = "<script>alert(1)</script>"
    outcome = review_syndicated_article(
        card,
        StubWriter({"decision": "escalate", "reason": "<b>unsafe</b>"}),
        notifier=RecordingNotifier(),
    )

    rendered = render_escalation_message(card, outcome)

    assert "<script>" not in rendered
    assert "&lt;script&gt;" in rendered
    assert "&lt;b&gt;unsafe&lt;/b&gt;" in rendered

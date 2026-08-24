"""Tests for the tier B/C approval flow.

Written negative-first on purpose. The lab has already shipped a green PR whose
test asserted the very bug it was meant to fix, so every guard below has at
least one case that *must* be rejected. If someone deletes a check, a test here
should go red -- passing tests that only exercise the happy path would let the
authorisation check or the status guard be removed silently.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from newsroom.approval import (
    CALLBACK_DATA_MAX_BYTES,
    MESSAGE_MAX_CHARS,
    ApprovalError,
    Decision,
    UnauthorizedDecision,
    apply_decision,
    authorize,
    build_keyboard,
    decode_callback,
    encode_callback,
    outcome_of,
    render_approval_message,
    render_decision_ack,
)

OPS_CHAT = "-1001234567890"
ULID = "01J8ZQ3K7XN4V9WD2C5MPRTB6Y"  # 26 chars, realistic


def pending_tier_c(**overrides):
    article = {
        "id": ULID,
        "slug": "err-riga-story",
        "tier": "C",
        "status": "pending_approval",
        "section": "government",
        "headline": "Estonian parliament debates budget amendment",
        "syndicated": {
            "source_id": "err_en",
            "original_url": "https://news.err.ee/123456/example",
            "attribution": "ERR News",
            "snippet": "The Riigikogu began its first reading on Tuesday.",
            "snippet_is_verbatim": True,
        },
        "provenance": {
            "sources": [{"source_id": "err_en", "retrieved_at": "2026-08-24T06:00:00+00:00"}],
            "generated_at": "2026-08-24T06:01:00+00:00",
            "model": None,
            "validator": {"passed": True, "checked_at": "2026-08-24T06:01:00+00:00", "checks": []},
        },
        "created_at": "2026-08-24T06:01:00+00:00",
    }
    article.update(overrides)
    return article


# ─────────────────────────────────────────────────────────────────────
# Authorisation — the inline keyboard is not a security boundary
# ─────────────────────────────────────────────────────────────────────


def test_decision_from_foreign_chat_is_rejected():
    """A callback query can be delivered from any chat the bot is in."""
    with pytest.raises(UnauthorizedDecision):
        authorize("-1009999999999", OPS_CHAT)


def test_decision_from_ops_chat_is_allowed():
    authorize(OPS_CHAT, OPS_CHAT)


def test_authorize_compares_as_strings_not_identity():
    """Telegram sends chat ids as ints; config carries them as strings."""
    authorize(-1001234567890, "-1001234567890")


# ─────────────────────────────────────────────────────────────────────
# Callback encoding — hostile input, 64-byte budget
# ─────────────────────────────────────────────────────────────────────


def test_callback_roundtrips():
    for decision in (Decision.APPROVE, Decision.REJECT):
        assert decode_callback(encode_callback(decision, ULID)) == (decision, ULID)


def test_callback_fits_telegram_budget():
    data = encode_callback(Decision.APPROVE, ULID)
    assert len(data.encode("utf-8")) <= CALLBACK_DATA_MAX_BYTES


def test_overlong_id_is_refused_rather_than_truncated():
    """Silent truncation would route a decision to the wrong article."""
    with pytest.raises(ApprovalError):
        encode_callback(Decision.APPROVE, "x" * 60)


@pytest.mark.parametrize(
    "hostile",
    [
        "",
        "pb:a",
        "pb:a:b:c",
        "xx:a:" + ULID,
        "pb:z:" + ULID,
        "pb:a:../../etc/passwd",
        "pb:a:id with spaces",
        "pb:a:" + "x" * 200,
    ],
)
def test_malformed_callbacks_are_refused(hostile):
    with pytest.raises(ApprovalError):
        decode_callback(hostile)


def test_injection_chars_cannot_enter_a_callback_token():
    for bad in ["a:b", "a/b", "a b", "a\nb", "'; DROP TABLE"]:
        with pytest.raises(ApprovalError):
            encode_callback(Decision.APPROVE, bad)


# ─────────────────────────────────────────────────────────────────────
# Rendering — untrusted feed text becomes markup
# ─────────────────────────────────────────────────────────────────────


def test_html_in_feed_content_is_escaped():
    """A headline is third-party text rendered into HTML markup."""
    article = pending_tier_c(headline="<script>alert(1)</script> Budget talks")
    rendered = render_approval_message(article)
    assert "<script>" not in rendered
    assert "&lt;script&gt;" in rendered


def test_markdown_metacharacters_survive_unescaped_text():
    """parse_mode=Markdown is banned lab-wide because these break the send."""
    article = pending_tier_c(headline="Latvia_Estonia *trade* deal [signed]")
    rendered = render_approval_message(article)
    assert "Latvia_Estonia *trade* deal [signed]" in rendered


def test_reviewer_sees_the_exact_snippet_that_would_publish():
    """The reviewer's job is to confirm it is the outlet's words, not a rewrite."""
    article = pending_tier_c()
    rendered = render_approval_message(article)
    assert article["syndicated"]["snippet"] in rendered
    assert "ERR News" in rendered


def test_long_content_truncates_body_not_attribution():
    article = pending_tier_c(
        syndicated={
            "source_id": "err_en",
            "original_url": "https://news.err.ee/1/x",
            "attribution": "ERR News",
            "snippet": "word " * 3000,
            "snippet_is_verbatim": True,
        }
    )
    rendered = render_approval_message(article)
    assert len(rendered) <= MESSAGE_MAX_CHARS
    # Attribution appears before the snippet, so truncation must not remove it.
    assert "ERR News" in rendered


def test_keyboard_offers_exactly_approve_and_reject():
    kb = build_keyboard(ULID)
    row = kb["inline_keyboard"][0]
    assert len(row) == 2
    assert decode_callback(row[0]["callback_data"]) == (Decision.APPROVE, ULID)
    assert decode_callback(row[1]["callback_data"]) == (Decision.REJECT, ULID)


# ─────────────────────────────────────────────────────────────────────
# Decisions — state machine
# ─────────────────────────────────────────────────────────────────────


def test_approve_publishes_and_records_who_and_when():
    now = datetime(2026, 8, 24, 9, 30, tzinfo=timezone.utc)
    updated = apply_decision(pending_tier_c(), Decision.APPROVE, "samoletovs", now=now)
    assert updated["status"] == "published"
    assert updated["provenance"]["approved_by"] == "samoletovs"
    assert updated["provenance"]["approved_at"] == now.isoformat()
    assert updated["published_at"] == now.isoformat()


def test_reject_does_not_publish():
    updated = apply_decision(pending_tier_c(), Decision.REJECT, "samoletovs")
    assert updated["status"] == "rejected"
    assert "published_at" not in updated


def test_already_published_article_cannot_be_redecided():
    """A stale button press must not be able to retract live content."""
    live = pending_tier_c(status="published")
    with pytest.raises(ApprovalError):
        apply_decision(live, Decision.REJECT, "samoletovs")


def test_rejected_article_cannot_be_revived_by_a_second_press():
    already = pending_tier_c(status="rejected")
    with pytest.raises(ApprovalError):
        apply_decision(already, Decision.APPROVE, "samoletovs")


def test_apply_decision_does_not_mutate_input():
    original = pending_tier_c()
    apply_decision(original, Decision.APPROVE, "samoletovs")
    assert original["status"] == "pending_approval"
    assert "approved_by" not in original["provenance"]


def test_decision_preserves_provenance_already_recorded():
    """Approval augments the record; it must not erase where the item came from."""
    updated = apply_decision(pending_tier_c(), Decision.APPROVE, "samoletovs")
    assert updated["provenance"]["sources"][0]["source_id"] == "err_en"
    assert updated["syndicated"]["snippet_is_verbatim"] is True


def test_ack_escapes_and_reports_the_outcome():
    updated = apply_decision(pending_tier_c(), Decision.APPROVE, "samoletovs")
    ack = render_decision_ack(outcome_of(updated, Decision.APPROVE), "<b>hi</b> & bye")
    assert "Approved" in ack
    assert "&lt;b&gt;hi&lt;/b&gt;" in ack
    assert "samoletovs" in ack

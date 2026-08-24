"""Telegram approve/reject flow for tier B and tier C items.

Why a human gate exists at all
------------------------------
Tier A (original data journalism from open data) publishes automatically once
the validator passes: we wrote it, every figure is traceable, and the failure
mode is a correction. Tiers B and C are different in kind -- the content
originates with someone else, and the risk is not "wrong number" but
"reproduced material we had no right to reproduce, or framed someone else's
reporting as ours". No validator can settle that; it is a judgment call, so it
goes to a person.

Design constraints that shaped this module
------------------------------------------
1. Telegram caps ``callback_data`` at 64 bytes. Article ids are ULIDs (26
   chars), so the encoding has to stay tight -- there is no room for JSON.
2. Callback queries are attacker-reachable. Anyone who learns the bot's name
   can send one. Authorisation is therefore checked against the configured
   ops chat on every decision, never assumed from the fact that a button
   exists.
3. ``parse_mode=Markdown`` with interpolated text is banned lab-wide (see
   ``.github/scripts/notify-guard.py``): a headline containing ``_`` or ``*``
   silently breaks the send. We use HTML and escape every interpolated value.
4. A send that cannot report its own failure is how a channel dies quietly.
   ``send_for_approval`` raises on failure; it is the caller's job to decide
   whether that should halt a run.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Final, Mapping

# Telegram's hard limits.
CALLBACK_DATA_MAX_BYTES: Final[int] = 64
MESSAGE_MAX_CHARS: Final[int] = 4096

# Reserve room for the "pb:a:" prefix so a long id can never silently overflow.
_CALLBACK_PREFIX: Final[str] = "pb"
_ID_PATTERN: Final[re.Pattern[str]] = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


class Decision(str, Enum):
    """What the reviewer chose."""

    APPROVE = "a"
    REJECT = "r"

    @property
    def label(self) -> str:
        return "Approve" if self is Decision.APPROVE else "Reject"


class ApprovalError(Exception):
    """Raised when an approval action cannot be completed."""


class UnauthorizedDecision(ApprovalError):
    """A callback arrived from a chat or user we do not accept decisions from."""


# ─────────────────────────────────────────────────────────────────────────
# Callback encoding
# ─────────────────────────────────────────────────────────────────────────


def encode_callback(decision: Decision, article_id: str) -> str:
    """Pack a decision into Telegram's 64-byte ``callback_data`` budget.

    Format: ``pb:<a|r>:<article_id>``. Deliberately not JSON -- a JSON envelope
    plus a 26-char ULID would leave almost nothing for anything else, and this
    field is parsed from untrusted input so a small, strict grammar is easier
    to defend than a flexible one.
    """
    if not _ID_PATTERN.match(article_id):
        raise ApprovalError(
            f"article_id {article_id!r} is not a safe callback token "
            "(expected 1-40 chars of [A-Za-z0-9_-])"
        )

    data = f"{_CALLBACK_PREFIX}:{decision.value}:{article_id}"
    encoded_len = len(data.encode("utf-8"))
    if encoded_len > CALLBACK_DATA_MAX_BYTES:
        raise ApprovalError(
            f"callback_data is {encoded_len} bytes, over Telegram's "
            f"{CALLBACK_DATA_MAX_BYTES}-byte limit: {data!r}"
        )
    return data


def decode_callback(data: str) -> tuple[Decision, str]:
    """Parse ``callback_data`` back into a decision and article id.

    Treats the input as hostile: a callback query can be sent by anyone who
    knows the bot, so this validates shape strictly rather than splitting
    optimistically.
    """
    parts = data.split(":")
    if len(parts) != 3:
        raise ApprovalError(f"malformed callback_data: {data!r}")

    prefix, raw_decision, article_id = parts
    if prefix != _CALLBACK_PREFIX:
        raise ApprovalError(f"unexpected callback prefix {prefix!r}")

    try:
        decision = Decision(raw_decision)
    except ValueError as exc:
        raise ApprovalError(f"unknown decision {raw_decision!r}") from exc

    if not _ID_PATTERN.match(article_id):
        raise ApprovalError(f"unsafe article id in callback: {article_id!r}")

    return decision, article_id


# ─────────────────────────────────────────────────────────────────────────
# Message rendering
# ─────────────────────────────────────────────────────────────────────────


def _esc(value: object) -> str:
    """HTML-escape any interpolated value.

    Every reviewer-facing string here originates in a third-party feed, which
    makes it untrusted input rendered into markup. Escaping is not optional.
    """
    return html.escape(str(value), quote=False)


def render_approval_message(article: Mapping[str, Any]) -> str:
    """Build the reviewer-facing message for a pending item.

    The reviewer needs enough to make the call without opening anything: what
    tier it is, who published it, what the licence permits, and -- for tier C
    -- the exact snippet that would appear, so they can see it is the outlet's
    own words rather than a rewrite.
    """
    tier = _esc(article.get("tier", "?"))
    headline = _esc(article.get("headline", "(no headline)"))
    section = _esc(article.get("section", "-"))
    syndicated = article.get("syndicated") or {}
    attribution = _esc(syndicated.get("attribution", "unknown source"))
    url = _esc(syndicated.get("original_url", ""))

    if tier == "B":
        kind = "Official press release — would be reproduced verbatim"
    elif tier == "C":
        kind = "Third-party headline — would appear as a link-out card"
    else:
        kind = "Item"

    lines = [
        f"<b>Tier {tier} approval</b>",
        f"<i>{_esc(kind)}</i>",
        "",
        f"<b>{headline}</b>",
        "",
        f"Source: {attribution}",
        f"Section: {section}",
    ]

    snippet = syndicated.get("snippet")
    if snippet:
        lines += [
            "",
            "Snippet to be shown verbatim:",
            f"<blockquote>{_esc(snippet)}</blockquote>",
        ]

    if url:
        lines += ["", f"Original: {url}"]

    text = "\n".join(lines)
    if len(text) > MESSAGE_MAX_CHARS:
        # Truncate the body, never the decision context. Losing the tail of a
        # snippet is recoverable; losing the attribution is not.
        keep = MESSAGE_MAX_CHARS - len("\n…(truncated)")
        text = text[:keep] + "\n…(truncated)"
    return text


def build_keyboard(article_id: str) -> dict[str, Any]:
    """Inline Approve / Reject keyboard for a pending item."""
    return {
        "inline_keyboard": [
            [
                {
                    "text": f"✅ {Decision.APPROVE.label}",
                    "callback_data": encode_callback(Decision.APPROVE, article_id),
                },
                {
                    "text": f"❌ {Decision.REJECT.label}",
                    "callback_data": encode_callback(Decision.REJECT, article_id),
                },
            ]
        ]
    }


# ─────────────────────────────────────────────────────────────────────────
# Decision handling
# ─────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class DecisionOutcome:
    """The result of applying a reviewer's decision to an article."""

    article_id: str
    decision: Decision
    new_status: str
    approved_by: str
    decided_at: str


def authorize(update_chat_id: object, allowed_chat_id: object) -> None:
    """Reject decisions from anywhere but the configured ops chat.

    The inline keyboard is not an authorisation boundary. A callback query can
    be delivered from any chat the bot is in, so the chat id is checked here on
    every decision rather than trusted because a button was pressed.
    """
    if str(update_chat_id) != str(allowed_chat_id):
        raise UnauthorizedDecision(
            f"decision from chat {update_chat_id!r} rejected; "
            f"only {allowed_chat_id!r} may approve"
        )


def apply_decision(
    article: Mapping[str, Any],
    decision: Decision,
    approved_by: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return a new article dict with the decision recorded.

    Pure and non-mutating so it can be tested without Blob or Telegram.

    Only items actually awaiting review may be decided. Re-deciding a published
    article would let a stale button press retract live content, and two
    reviewers racing on the same message would otherwise both "win".
    """
    status = article.get("status")
    if status != "pending_approval":
        raise ApprovalError(
            f"article {article.get('id')!r} is {status!r}, not pending_approval; "
            "refusing to apply a decision"
        )

    moment = (now or datetime.now(timezone.utc)).isoformat()
    updated = dict(article)
    updated["status"] = "published" if decision is Decision.APPROVE else "rejected"

    provenance = dict(updated.get("provenance") or {})
    provenance["approved_by"] = approved_by
    provenance["approved_at"] = moment
    updated["provenance"] = provenance

    if decision is Decision.APPROVE:
        updated["published_at"] = moment

    return updated


def outcome_of(updated: Mapping[str, Any], decision: Decision) -> DecisionOutcome:
    """Summarise an applied decision, for logging and the reviewer ack."""
    provenance = updated.get("provenance") or {}
    return DecisionOutcome(
        article_id=str(updated.get("id", "")),
        decision=decision,
        new_status=str(updated.get("status", "")),
        approved_by=str(provenance.get("approved_by", "")),
        decided_at=str(provenance.get("approved_at", "")),
    )


def render_decision_ack(outcome: DecisionOutcome, headline: str) -> str:
    """Replacement text for the original message once a decision is recorded.

    Editing the message in place rather than sending a reply matters: it
    removes the buttons, so the chat cannot accumulate stale keyboards that
    invite a second press on an already-decided item.
    """
    verb = "Approved" if outcome.decision is Decision.APPROVE else "Rejected"
    mark = "✅" if outcome.decision is Decision.APPROVE else "❌"
    return (
        f"{mark} <b>{_esc(verb)}</b>\n\n"
        f"<b>{_esc(headline)}</b>\n\n"
        f"by {_esc(outcome.approved_by)} at {_esc(outcome.decided_at)}"
    )

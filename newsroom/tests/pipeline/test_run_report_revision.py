"""Does the run report say which code produced it?

Every published article carries ``provenance.revision``, so the revision behind
a run was nominally recoverable — read ``published_slugs[0]``, fetch it, read
its provenance. Measured against the live document on 2026-08-31, that is what
you had to do, because the report itself carried no such field:

    keys: version finished_at trigger schedule stale_after_hours summary counts
          original_articles liveness sections original_sections causal_panel
          desk published_slugs rejected_slugs rejected_checks rejections errors

**And the recovery only works on runs that published something.** A run whose
every draft was refused has an empty ``published_slugs``, so the revision
becomes unrecoverable exactly when the question is "what was deployed when this
went wrong". The one document written to be read after a bad afternoon was the
one that could not say which code produced it.

The tests below pin three things, and the third is the one that will still be
earning its keep in a year:

* the stamp is present and correct when the setting is set;
* it degrades to ``revision_unavailable`` rather than to a plausible constant,
  so a reader can never mistake a placeholder for an answer;
* the report and the article resolve the revision through **one** function.
  Two readers of one setting drift, and the drift here is silent in the
  direction that reports success — the report could name one revision while
  every article beside it named another, and nothing would disagree.
"""

from __future__ import annotations

import ast
import inspect
import textwrap
from typing import Any, Callable

from newsroom.pipeline import config, runreport
from newsroom.pipeline.runreport import build_run_report
from newsroom.pipeline.write.generator import _revision_record


def _code_of(fn: Callable[..., Any]) -> str:
    """A function's body as code, with the docstring removed.

    `inspect.getsource` returns the prose too, so a check for a name in "the
    implementation" matches the paragraph explaining why the name is absent.
    That is not hypothetical: it is how the first version of this file failed.
    """
    tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
    fn_node = tree.body[0]
    assert isinstance(fn_node, (ast.FunctionDef, ast.AsyncFunctionDef))
    body = fn_node.body
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        body = body[1:]
    return "\n".join(ast.unparse(node) for node in body)


class Run:
    """Enough of ``RunReport`` for :func:`build_run_report`."""

    def __init__(self) -> None:
        self.rejected: list = []
        self.generated: list = []
        self.published: list = []
        self.desk: list = []
        self.errors: list = []
        self.syndicated: list = []
        self.style_notes: list = []
        self.signals: list = []
        self.syndication_skipped = 0

    def summary(self) -> str:
        return "0 published, 0 rejected"


def _report():
    return build_run_report(Run(), trigger="timer")


class TestTheRunSaysWhichCodeProducedIt:
    def test_the_revision_is_stamped_when_it_is_known(self, monkeypatch):
        monkeypatch.setattr(config, "REVISION", "56554c8823d3afd51b44778bc61522a22cedfc48")
        report = _report()

        assert report["revision"] == "56554c8823d3afd51b44778bc61522a22cedfc48"
        # The negative half, on the same object: a known revision must not also
        # carry the excuse, or the two keys stop being mutually exclusive and a
        # consumer cannot use presence to mean anything.
        assert "revision_unavailable" not in report

    def test_an_unknown_revision_says_so_rather_than_guessing(self, monkeypatch):
        monkeypatch.setattr(config, "REVISION", "")
        report = _report()

        assert "revision" not in report
        assert "NEWSROOM_REVISION is not set" in report["revision_unavailable"]

    def test_exactly_one_of_the_two_keys_is_always_present(self, monkeypatch):
        for value in ("abc1234", "", "   "):
            monkeypatch.setattr(config, "REVISION", value)
            report = _report()
            assert ("revision" in report) != ("revision_unavailable" in report), (
                f"REVISION={value!r} produced neither key or both; a reader uses "
                "presence to tell a real stamp from an honest absence"
            )

    def test_whitespace_is_an_absent_revision_not_a_present_one(self, monkeypatch):
        """``"   "`` is truthy in Python and would sail through a bare ``if``."""
        monkeypatch.setattr(config, "REVISION", "   ")
        report = _report()

        assert "revision" not in report
        assert "revision_unavailable" in report


class TestTheReportAndTheArticleCannotDisagree:
    """One setting, one reader.

    A second ``config.REVISION.strip()`` in ``runreport.py`` would pass every
    test above and still be wrong the day one of the two is changed. This is the
    ``statusChecks.js`` rule — a guard that rebuilds the logic it guards is a
    second implementation that can disagree — applied to a provenance stamp.
    """

    def test_both_stamps_come_from_the_same_function(self, monkeypatch):
        monkeypatch.setattr(config, "REVISION", "deadbee")

        assert runreport._revision_stamp() == _revision_record()

        # And structurally, so the equality above cannot be satisfied by two
        # implementations that happen to agree today.
        #
        # Read from the parsed body with the docstring removed, not from
        # `getsource`. The first version searched the raw source and failed on
        # this function's own prose, which explains why it must not read
        # `config.REVISION` -- a lexical check firing on the sentence that
        # describes it. Asking the AST is asking about code.
        source = _code_of(runreport._revision_stamp)
        assert "_revision_record()" in source, (
            "the run report must resolve the revision through the article's "
            "helper, not re-read the setting itself"
        )
        assert "config.REVISION" not in source, (
            "a second reader of NEWSROOM_REVISION has been introduced; it will "
            "drift from the article's, and silently"
        )

    def test_the_control_that_the_check_above_can_fail(self):
        """The assertion `"config.REVISION" not in source` is only meaningful if
        that string would be found were it there. Proven against the function
        that genuinely does read the setting, through the same extractor -- so a
        broken extractor fails here rather than passing there."""
        assert "config.REVISION" in _code_of(_revision_record)

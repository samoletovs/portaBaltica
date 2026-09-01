"""`scripts/apply_corrections.py` — the path that files a notice without an edition.

WHY A SCRIPT NEEDS A TEST AT ALL
--------------------------------
Because the alternative it replaces is an operator editing a blob by hand,
which `newsroom/pipeline/corrections.py` names as the thing its register exists
to avoid: *"unreviewable and unrepeatable"*. A script that is not tested is the
same act with a filename.

WHAT IS TESTED, AND WHAT DELIBERATELY IS NOT
---------------------------------------------
`plan_corrections` is tested here: it decides, per article, whether a declared
correction files, is already there, is refused, or is skipped — and that
decision is the whole of the script's own judgement.

The write is NOT tested here, because the script does not implement one. It
calls `corrections.issue`, the same function `run.py` calls as stage 13, and
that is tested in `test_editorial_corrections.py`. A second write path that
this suite could hold to a different standard is exactly what the script exists
not to be.
"""
from __future__ import annotations

import asyncio
import ast
import copy
import importlib.util
import pathlib
import sys

from newsroom.pipeline.corrections import EditorialCorrection

REPO = pathlib.Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts" / "apply_corrections.py"


def _module():
    """Import the script by path; `scripts/` is not a package."""
    spec = importlib.util.spec_from_file_location("apply_corrections", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("apply_corrections", module)
    spec.loader.exec_module(module)
    return module


mod = _module()


ARTICLE = {
    "slug": "s",
    "status": "published",
    "headline": "Latvia's house prices rise 10.9% year on year in 2026-Q1",
    "dek": "A dek.",
    "published_at": "2026-08-27T07:08:22Z",
    "body": [{"type": "paragraph", "text": "The cumulative change of 5.5%."}],
    "corrections": [],
}

NOTE = EditorialCorrection(slug="s", description="CORRECTED. A note.")


class FakeStore:
    """Only the one method `plan_corrections` uses."""

    def __init__(self, documents: dict[str, dict | None]) -> None:
        self.documents = documents
        self.reads: list[str] = []

    async def read_published(self, slug: str):
        self.reads.append(slug)
        document = self.documents.get(slug)
        return copy.deepcopy(document) if document is not None else None


def plan(documents, pending):
    return asyncio.run(mod.plan_corrections(FakeStore(documents), pending))


class TestItDecidesPerArticle:
    def test_a_new_note_is_filed(self):
        (decision,) = plan({"s": ARTICLE}, [NOTE])
        assert decision.action == "file"
        assert decision.slug == "s"
        assert "0 -> 1" in decision.reason

    def test_a_note_already_present_is_a_noop(self):
        already = {**ARTICLE, "corrections": [
            {"corrected_at": "2026-09-01T00:00:00Z", "description": NOTE.description}
        ]}
        (decision,) = plan({"s": already}, [NOTE])
        assert decision.action == "noop"
        assert "already carries" in decision.reason

    def test_an_unpublished_article_is_skipped_with_its_reason(self):
        (decision,) = plan({"s": {**ARTICLE, "status": "retracted"}}, [NOTE])
        assert decision.action == "skip"
        assert "retracted" in decision.reason

    def test_a_missing_article_is_skipped_with_a_different_reason(self):
        """The two skips must be distinguishable.

        MUTATION THIS CATCHES: collapsing both into a bare absence from the
        result, which is the shape `AGENTS.md` calls two states producing one
        artefact — an operator cannot tell "we never published it" from "we
        withdrew it".
        """
        (decision,) = plan({"s": None}, [NOTE])
        assert decision.action == "skip"
        assert "not published" in decision.reason
        other = plan({"s": {**ARTICLE, "status": "retracted"}}, [NOTE])[0]
        assert decision.reason != other.reason

    def test_it_reads_every_declared_correction(self):
        """The guard must walk the register, not a prefix of it."""
        store = FakeStore({"s": ARTICLE})
        notes = [NOTE, EditorialCorrection(slug="t", description="Another.")]
        decisions = asyncio.run(mod.plan_corrections(store, notes))
        assert [d.slug for d in decisions] == ["s", "t"]
        assert store.reads == ["s", "t"]


class TestItRefusesAnythingThatIsNotAnAppend:
    def test_a_note_that_would_change_the_prose_is_refused(self):
        """`annotate` cannot do this today. The guard is not for `annotate`.

        It is for the next thing that appends a correction, and for a change to
        `annotate` itself — the script writes to production, so it checks the
        property rather than trusting the function that produced it.
        """
        rewriting = EditorialCorrection(slug="s", description="A note.")
        original = mod.plan_corrections

        async def tampered(store, pending):
            import newsroom.pipeline.corrections as corrections

            real = corrections.annotate
            corrections.annotate = lambda doc, c: {
                **dict(doc),
                "body": [{"type": "paragraph", "text": "REWRITTEN"}],
                "corrections": [*(doc.get("corrections") or []), c.to_correction()],
            }
            try:
                return await original(store, pending)
            finally:
                corrections.annotate = real

        decisions = asyncio.run(tampered(FakeStore({"s": ARTICLE}), [rewriting]))
        assert decisions[0].action == "refuse"
        assert "body" in decisions[0].reason
        assert "append-only" in decisions[0].reason

    def test_the_append_only_fields_are_the_ones_named(self):
        """A field dropped from this tuple is a field a notice could silently
        change, so the set is asserted rather than spot-checked."""
        assert set(mod.APPEND_ONLY) == {
            "body", "headline", "dek", "status", "published_at"
        }

    def test_the_real_annotate_changes_none_of_them(self):
        """CONTROL for the refusal above: the shipped `annotate` appends only.

        Without this, `test_a_note_that_would_change_the_prose_is_refused`
        proves a guard fires on a tampered function and says nothing about the
        one that runs.
        """
        (decision,) = plan({"s": ARTICLE}, [NOTE])
        assert decision.action == "file"
        for field in mod.APPEND_ONLY:
            assert decision.after[field] == decision.before[field], field
        assert len(decision.after["corrections"]) == 1


def _code_only(path: pathlib.Path) -> str:
    """The script's source with comments AND docstrings removed.

    `AGENTS.md`: *the better you document a removal, the more present it
    looks* — a content check that reads the prose explaining a thing reports
    the thing as present. This test hit that on its first run. Stripping `#`
    comments was not enough, because the script's module docstring explains at
    length that it does not touch `index.json`, and a naive scan read that
    explanation as evidence of the opposite.

    Docstrings are removed structurally, via the AST, rather than by a regex
    over triple quotes: a regex encodes the quoting styles its author thought
    of, and the AST knows which strings are documentation.
    """
    source = path.read_text(encoding="utf-8")
    lines = source.splitlines()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if not isinstance(node, (ast.Module, ast.FunctionDef,
                                 ast.AsyncFunctionDef, ast.ClassDef)):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) \
                and isinstance(first.value.value, str):
            for i in range(first.lineno - 1, first.end_lineno):
                lines[i] = ""
    return "\n".join(
        line for line in lines if not line.lstrip().startswith("#")
    )


class TestItDoesNotImplementASecondWritePath:
    def test_it_calls_the_pipeline_s_own_issue(self):
        """A second application path could file a notice the edition would not.

        `AGENTS.md`: a guard that reproduces the logic it guards is a second
        implementation that can disagree. The same holds for an applier.
        """
        code = _code_only(SCRIPT)
        assert "from newsroom.pipeline.corrections import PENDING, issue" in code
        assert "await issue(store, PENDING)" in code

    def test_it_does_not_write_the_index(self):
        """`write_index` copies pre-existing entries verbatim and no consumer
        reads a correction field from the index; the feeds join against
        `corrections.json`. Measured 2026-09-01: 0 of 99 index entries carry
        any field mentioning a correction.
        """
        code = _code_only(SCRIPT)
        assert "index.json" not in code
        assert "write_index" not in code
        # CONTROL: the blob it DOES write is named in the same stripped source,
        # so "absent" is a reading rather than a fact about the stripper.
        assert "corrections.json" in code

    def test_the_stripper_removes_documentation_and_keeps_code(self):
        """CONTROL on the instrument, because the instrument was wrong once.

        The script's docstring names `index.json`; its code does not. If the
        stripper stopped working, the assertion above would fail loudly rather
        than pass — but if it over-stripped, that assertion would pass
        vacuously, which is the direction nobody re-checks.
        """
        raw = SCRIPT.read_text(encoding="utf-8")
        code = _code_only(SCRIPT)
        assert "index.json" in raw, "the docstring should mention it"
        assert "CORRECTIONS_BLOB" in code, "the stripper must keep real code"
        assert "DEFAULT_ACCOUNT" in code


class TestTheRehearsalIsTheDefault:
    """The one property that matters on a script holding a write credential.

    THE FIRST VERSION OF THIS CLASS PROTECTED NOTHING, AND WAS PROVED SO
    ---------------------------------------------------------------------
    It had two tests. Both passed with the default inverted:

        parser.add_argument("--apply", action="store_true",  ->  ..., default=True,
        pytest <this file>                                   ->  14 passed
        the script's own parser, argv=[]                     ->  apply = True

    `test_apply_is_opt_in` asserted `'"--apply", action="store_true"' in
    source`. A `default=True` APPENDS to that declaration, so the substring
    survives -- a lexical proxy for a structural property, defeated by an
    addition rather than a change. `AGENTS.md`: *a word list encodes your
    examples; a structure encodes your rule.*

    `test_the_parser_accepts_both_forms` built its own `ArgumentParser` and
    asserted against that. It tested `argparse`, and would have passed had this
    script carried no `--apply` flag at all -- the guard that reproduces the
    logic it guards, which is a second implementation free to disagree.

    So the first line below parses with the SCRIPT'S OWN parser and asserts the
    resulting value. The second is source-level and structural rather than
    lexical, which is what makes it a second line rather than a longer word
    list.
    """

    def test_no_arguments_means_rehearse(self):
        """FIRST LINE. The script's own parser, and the value it produces.

        MUTATION THIS CATCHES, and the only one that matters here: appending
        `default=True` to the declaration. This script holds
        `DefaultAzureCredential` against the articles container, so an inverted
        default turns `python scripts/apply_corrections.py` from a promise to
        rehearse into a production write.
        """
        assert mod.build_parser().parse_args([]).apply is False

    def test_the_flag_turns_writing_on(self):
        """The other half. Without it, the assertion above is satisfied by a
        flag that can never be true -- an option that does nothing."""
        assert mod.build_parser().parse_args(["--apply"]).apply is True

    def test_the_parser_is_the_one_main_uses(self):
        """Otherwise the two tests above interrogate a parser nothing runs.

        `build_parser` was extracted from `main` precisely so it could be
        tested; a `main` that went on building its own would leave that
        extraction decorative and these assertions vacuous.
        """
        code = _code_only(SCRIPT)
        assert "args = build_parser().parse_args(argv)" in code
        assert code.count("argparse.ArgumentParser(") == 1, (
            "only build_parser may construct a parser"
        )

    def test_apply_is_opt_in(self):
        """SECOND LINE, structural. Read the declaration, not the line.

        Kept because a source-level assertion is worth having beside a
        behavioural one -- it names the mechanism rather than the outcome, so a
        failure says which knob moved. Upgraded from a substring test, which
        could not see the keyword that beat it: `default` is invisible to
        `'action="store_true"' in source` and plainly visible to the AST.
        """
        declaration = _apply_declaration()
        assert declaration is not None, "no add_argument('--apply') call found"
        keywords = {kw.arg: kw.value for kw in declaration.keywords}
        assert isinstance(keywords.get("action"), ast.Constant)
        assert keywords["action"].value == "store_true"
        assert "default" not in keywords, (
            "an explicit default on a store_true flag overrides the False that "
            "makes this script rehearse unless told otherwise"
        )

    def test_the_ast_reader_can_see_a_default(self):
        """CONTROL on the second line, because its predecessor could not.

        A structural check that silently failed to find the keyword would be
        the substring test again with more ceremony, so this proves the reader
        does see `default` when it is there.
        """
        tree = ast.parse(
            'p.add_argument("--apply", action="store_true", default=True)'
        )
        call = next(n for n in ast.walk(tree) if isinstance(n, ast.Call))
        keywords = {kw.arg for kw in call.keywords}
        assert "default" in keywords and "action" in keywords


def _apply_declaration() -> ast.Call | None:
    """The `add_argument("--apply", ...)` call in the script, as a node."""
    tree = ast.parse(SCRIPT.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if getattr(node.func, "attr", None) != "add_argument":
            continue
        if node.args and isinstance(node.args[0], ast.Constant) \
                and node.args[0].value == "--apply":
            return node
    return None

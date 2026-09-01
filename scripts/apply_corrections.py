#!/usr/bin/env python3
"""File the newsroom's pending editorial corrections, without an edition.

WHY THIS EXISTS
---------------
`corrections.PENDING` is applied by `run.py` as stage 13 of an edition, which
is the right place for it: idempotent, reviewed, and it leaves a diff. It is
also the *only* place, and that coupling cost three articles most of a day.

Measured on 2026-09-01, the sequence was:

    14:29:57Z   edition finished, revision d82233b
    14:33:31Z   #357 merged -- three notices added to PENDING
    14:35Z      newsroom-ci deployed them to the Function App
    (next scheduled edition: 14:00Z the following day)

So for twenty-three hours the notices existed, were deployed, were correct, and
reached no reader. The published log still read 28 entries -- an artefact
equally consistent with the notices being broken, with no edition having run
since they deployed, and with their having been applied and deduplicated. Only
`runs/latest.json`'s `revision` separated those three, and nothing was watching
it.

The alternative to this script is POSTing `newsroom/run`, which executes a full
edition: 625 seconds against a 1800-second ceiling as of `d82233b`, six model
calls per article, and an unscheduled batch of new journalism published as a
side effect of filing a correction notice. That is a large, irreversible action
in service of a small, reversible one.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
It does not build notices, choose subjects, or write prose. It calls
`corrections.issue` -- the same function stage 13 calls, on the same register --
so this cannot file a notice the edition would not, or word one differently.
A second application path that could disagree with the first would be worse
than the coupling it removes.

It does not touch `index.json`. That is not an omission: `write_index` copies
pre-existing entries verbatim and no consumer reads a correction field from the
index. `api/shared/newsroom.js` documents why -- the feeds and the front page
join against `corrections.json`, which is the file this appends to.

SAFETY
------
`--apply` is required; the default is a rehearsal that writes nothing. Every
blob that could change is copied byte-exact to `--snapshot` first, and the
result is verified by re-reading the blob rather than by trusting the return
value: `issue` never raises, by design, so its return is a claim and the stored
document is the artefact.

USAGE
-----
    az login
    python scripts/apply_corrections.py                 # rehearse
    python scripts/apply_corrections.py --apply         # file them

Authentication is `DefaultAzureCredential` against the storage account, the
same credential the Function App uses. The account sets
`allowSharedKeyAccess: false`, so there is no key path to fall back to and none
is offered.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import pathlib
import sys

log = logging.getLogger("apply_corrections")

DEFAULT_ACCOUNT = "https://stportabalticabpmff5so.blob.core.windows.net"
DEFAULT_CONTAINER = "articles"
CORRECTIONS_BLOB = "corrections.json"


#: Fields a correction may not change. `retract.py` states the rule for the
#: whole apparatus -- "Nothing here rewrites the article's prose. The record is
#: append-only" -- and a notice that moved any of these would be a rewrite
#: wearing a notice's clothes.
APPEND_ONLY: tuple[str, ...] = ("body", "headline", "dek", "status", "published_at")


class Decision:
    """What this would do to one article, and why.

    A class rather than a tuple so the reason travels with the outcome: a slug
    that is skipped because it is unpublished and one skipped because the note
    is already there are the same absence from the result, and the operator
    needs to tell them apart.
    """

    __slots__ = ("slug", "action", "reason", "before", "after")

    def __init__(self, slug: str, action: str, reason: str,
                 before: dict | None = None, after: dict | None = None) -> None:
        self.slug, self.action, self.reason = slug, action, reason
        self.before, self.after = before, after

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return f"<{self.action} {self.slug}: {self.reason}>"


async def plan_corrections(store, pending) -> list[Decision]:
    """Decide, without writing, what each declared correction would do.

    Separated from :func:`main` so it can be tested against a fake store. The
    write path cannot be: it is `corrections.issue`, which belongs to the
    pipeline and is tested there.
    """
    from newsroom.pipeline.corrections import annotate

    decisions: list[Decision] = []
    for correction in pending:
        document = await store.read_published(correction.slug)
        if document is None:
            decisions.append(Decision(correction.slug, "skip", "not published"))
            continue
        if document.get("status") != "published":
            decisions.append(Decision(
                correction.slug, "skip", f"status is {document.get('status')!r}"))
            continue
        annotated = annotate(document, correction)
        if annotated is None:
            decisions.append(Decision(
                correction.slug, "noop", "already carries this note"))
            continue
        changed = [f for f in APPEND_ONLY if annotated.get(f) != document.get(f)]
        if changed:
            decisions.append(Decision(
                correction.slug, "refuse",
                f"would change {', '.join(changed)}, and the record is append-only"))
            continue
        decisions.append(Decision(
            correction.slug, "file",
            f"{len(document.get('corrections') or [])} -> "
            f"{len(annotated['corrections'])} note(s)",
            before=document, after=annotated))
    return decisions


def _container(account_url: str, container: str):
    from azure.identity import DefaultAzureCredential
    from azure.storage.blob import BlobServiceClient

    service = BlobServiceClient(account_url, credential=DefaultAzureCredential())
    return service.get_container_client(container)


def _snapshot(client, names: list[str], into: pathlib.Path) -> dict[str, bytes]:
    """Byte-exact copies, on disk, before anything is written.

    Bytes rather than a re-serialised object: a restore has to be a byte
    comparison, and `json.dumps` of a parsed document is not the document.
    """
    into.mkdir(parents=True, exist_ok=True)
    out: dict[str, bytes] = {}
    for name in names:
        raw = client.download_blob(name).readall()
        out[name] = raw
        (into / name.replace("/", "_")).write_bytes(raw)
        print(f"   snapshot  {name}  {len(raw)} bytes")
    return out


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true",
                        help="write. Without it this only rehearses.")
    parser.add_argument("--account-url", default=DEFAULT_ACCOUNT)
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--snapshot", default=".correction-snapshot",
                        help="where to put the byte-exact copies")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.WARNING, format="%(message)s")

    from newsroom.pipeline.corrections import PENDING, issue
    from newsroom.pipeline.publish import ArticleStore

    store = ArticleStore(account_url=args.account_url, container=args.container)

    print(f"{len(PENDING)} correction(s) declared in corrections.PENDING\n")

    decisions = await plan_corrections(store, PENDING)
    for decision in decisions:
        print(f"[{decision.action:<6}] {decision.slug}\n         {decision.reason}")

    refused = [d for d in decisions if d.action == "refuse"]
    if refused:
        print("\nSTOPPED. A correction may only append; these would not:")
        for d in refused:
            print(f"   {d.slug}: {d.reason}")
        return 1

    plan = [d for d in decisions if d.action == "file"]
    print()
    if not plan:
        print("nothing to file; every declared correction is already on its article")
        return 0

    if not args.apply:
        print(f"REHEARSAL. {len(plan)} correction(s) would be filed. "
              "Pass --apply to write.")
        return 0

    client = _container(args.account_url, args.container)
    names = [f"{d.slug}.json" for d in plan] + [CORRECTIONS_BLOB]
    print(f"snapshotting {len(names)} blob(s):")
    _snapshot(client, names, pathlib.Path(args.snapshot))
    print()

    changed = await issue(store, PENDING)
    print(f"issue() reports {len(changed)} article(s) changed\n")

    # VERIFY AGAINST THE STORED DOCUMENT. `issue` swallows every exception so
    # that one bad correction cannot take an edition down, which means its
    # return value cannot distinguish "written" from "the write failed and was
    # logged". The blob can.
    ok = True
    for decision in plan:
        before = decision.before or {}
        stored = json.loads(
            client.download_blob(f"{decision.slug}.json").readall().decode("utf-8")
        )
        checks = {
            "note appended": len(stored.get("corrections") or [])
            == len(before.get("corrections") or []) + 1,
            **{
                f"{field} unchanged": stored.get(field) == before.get(field)
                for field in APPEND_ONLY
            },
        }
        print(decision.slug)
        for label, passed in checks.items():
            print(f"   {'ok  ' if passed else 'FAIL'}  {label}")
        ok = ok and all(checks.values())

    entries = json.loads(client.download_blob(CORRECTIONS_BLOB).readall().decode("utf-8"))
    print(f"\n{CORRECTIONS_BLOB}: {len(entries)} entries, "
          f"{len({e.get('slug') for e in entries})} distinct slugs")
    if not ok:
        print("\nSOMETHING DID NOT LAND. The snapshot directory holds the "
              "byte-exact originals.")
    return 0 if ok else 1


if __name__ == "__main__":  # pragma: no cover
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    raise SystemExit(asyncio.run(main()))

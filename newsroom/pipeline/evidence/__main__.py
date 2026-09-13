"""Run from the repository root: python -m newsroom.pipeline.evidence --help."""

from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path
from typing import Sequence

from newsroom.pipeline.evidence.codec import json_bytes
from newsroom.pipeline.evidence.store import DEFAULT_DIRECTORY, EvidenceStore, open_store, put_local
from newsroom.pipeline.evidence.workflow import EXPECTED_FAILURES, capture, compare, import_legacy, replay

log = logging.getLogger(__name__)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Baltic evidence archive (no model calls)")
    parser.add_argument("--directory", type=Path, default=DEFAULT_DIRECTORY)
    parser.add_argument("--cloud", action="store_true", help="Use the existing private Blob container; no provisioning")
    commands = parser.add_subparsers(dest="command", required=True)
    collect = commands.add_parser("capture", help="Fetch the pinned series and persist a complete snapshot")
    collect.add_argument("--previous", help="Compare against a verified earlier snapshot")
    restore = commands.add_parser("replay", help="Verify and regenerate a stored snapshot without the source API")
    restore.add_argument("snapshot_id")
    restore.add_argument("--export-directory", type=Path)
    difference = commands.add_parser("compare", help="Compare two verified snapshots in retrieval-time order")
    difference.add_argument("before")
    difference.add_argument("after")
    difference.add_argument("--output", type=Path)
    legacy = commands.add_parser("import-legacy", help="Import audited raw bytes and their original provenance")
    legacy.add_argument("raw_file", type=Path)
    legacy.add_argument("metadata_file", type=Path)
    commands.add_parser("collect-only", help="Run the real unemployment collector and publish its checked evidence")
    commands.add_parser("publish-audited", help="Publish only the approved legacy IDs from --directory")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    for name in ("azure", "httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    try:
        if args.command in ("collect-only", "publish-audited"):
            from contextlib import nullcontext

            from newsroom.pipeline.evidence.operations import collect_only, publish_audited
            from newsroom.pipeline.evidence.production import EvidenceService, open_production

            source = EvidenceStore(args.directory)
            context = open_production(args.directory) if args.cloud else nullcontext(
                EvidenceService(source, EvidenceStore(args.directory / "public")),
            )
            with context as evidence:
                result = asyncio.run(collect_only(evidence)) if args.command == "collect-only" else publish_audited(evidence, source)
            result["storage"] = "azure" if args.cloud else "local_preview"
            log.info("%s", json_bytes(result).decode().rstrip())
            return 1 if result.get("status") == "failed" else 0
        with open_store(args.directory, cloud=args.cloud) as store:
            if args.command == "capture":
                result = asyncio.run(capture(store, previous=args.previous))
            elif args.command == "replay":
                replayed = replay(store, args.snapshot_id, args.export_directory)
                result = {"verified": True, **replayed["manifest"]}
            elif args.command == "compare":
                result = compare(store, args.before, args.after)
                if args.output:
                    put_local(args.output.parent, args.output.name, json_bytes(result))
            else:
                result = asyncio.run(import_legacy(store, args.raw_file, args.metadata_file))
    except EXPECTED_FAILURES as exc:
        log.error("evidence %s failed: %s", args.command, exc)
        return 1
    log.info("%s", json_bytes(result).decode().rstrip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""CLI failures must be visible and must not damage review artifacts."""

from __future__ import annotations

import logging
from pathlib import Path

from newsroom.pipeline import config
from newsroom.pipeline.evidence.__main__ import main


def test_replay_rejects_an_invalid_identifier_with_nonzero_exit(tmp_path: Path, caplog) -> None:
    with caplog.at_level(logging.ERROR):
        result = main(["--directory", str(tmp_path), "replay", "../outside"])

    assert result == 1
    assert "invalid snapshot identifier" in caplog.text
    assert not list(tmp_path.iterdir())


def test_cloud_configuration_failure_cannot_become_a_local_capture(tmp_path: Path, monkeypatch, caplog) -> None:
    monkeypatch.setattr(config, "STORAGE_ACCOUNT_URL", "")

    with caplog.at_level(logging.ERROR):
        result = main(["--directory", str(tmp_path), "--cloud", "capture"])

    assert result == 1
    assert "BLOB_ACCOUNT_URL" in caplog.text
    assert not list(tmp_path.iterdir())


def test_failed_comparison_does_not_replace_an_existing_report(tmp_path: Path, caplog) -> None:
    report = tmp_path / "review.json"
    report.write_bytes(b"previous review evidence\n")

    with caplog.at_level(logging.ERROR):
        result = main([
            "--directory", str(tmp_path), "compare", "a" * 32, "b" * 32,
            "--output", str(report),
        ])

    assert result == 1
    assert "failed" in caplog.text
    assert report.read_bytes() == b"previous review evidence\n"

"""Lossless cell selection and deterministic exports for the pilot contract."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
from itertools import product
from typing import Any

from newsroom.pipeline.evidence.selection import (
    DATASET, DIMENSIONS, GEOGRAPHIES, SERIES_ID, START_PERIOD,
)

MAX_RAW_BYTES = 2 * 1024 * 1024
MAX_CELLS = 20_000
FORMAT_VERSION = 1


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def _categories(dimension: Any, size: int) -> list[str]:
    if not isinstance(dimension, dict) or not isinstance(dimension.get("category"), dict):
        raise ValueError("missing dimension categories")
    index = dimension["category"].get("index")
    if isinstance(index, list):
        codes = index
    elif isinstance(index, dict):
        if any(type(position) is not int for position in index.values()):
            raise ValueError("category positions must be integers")
        if sorted(index.values()) != list(range(size)):
            raise ValueError("category positions must be unique and contiguous")
        codes = sorted(index, key=index.__getitem__)
    else:
        raise ValueError("invalid category index")
    if len(codes) != size or any(not isinstance(code, str) for code in codes) or len(set(codes)) != size:
        raise ValueError("category count or codes do not match the declared dimension")
    return codes


def _cells(value: Any, count: int, *, flags: bool = False) -> dict[int, Any]:
    if flags and isinstance(value, str):
        return dict.fromkeys(range(count), value)
    if isinstance(value, list):
        if len(value) != count:
            raise ValueError("dense cell array has the wrong size")
        return dict(enumerate(value))
    if not isinstance(value, dict):
        raise ValueError("cells must be a sparse object or dense array")
    cells = {}
    for key, cell in value.items():
        if not isinstance(key, str) or not re.fullmatch(r"0|[1-9]\d*", key) or int(key) >= count:
            raise ValueError("cell index is outside the declared cube")
        cells[int(key)] = cell
    return cells


def normalize(body: bytes) -> dict[str, Any]:
    if len(body) > MAX_RAW_BYTES:
        raise ValueError("response exceeds the pilot's 2 MiB bound")
    payload = json.loads(body)
    if not isinstance(payload, dict) or payload.get("class") != "dataset" or payload.get("version") != "2.0":
        raise ValueError("expected a JSON-stat 2.0 dataset")
    ids, sizes = payload.get("id"), payload.get("size")
    required = set(DIMENSIONS) | {"geo", "time"}
    if not isinstance(ids, list) or any(not isinstance(v, str) for v in ids):
        raise ValueError("invalid dimension identifiers")
    if len(ids) != len(required) or set(ids) != required:
        raise ValueError("dataset dimensions changed")
    if not isinstance(sizes, list) or len(sizes) != len(ids) or any(type(v) is not int or v < 1 for v in sizes):
        raise ValueError("invalid cube size")
    count = math.prod(sizes)
    if count > MAX_CELLS:
        raise ValueError("response exceeds the pilot's cell bound")
    dimensions = payload.get("dimension")
    if not isinstance(dimensions, dict) or set(dimensions) != required:
        raise ValueError("missing dimension definitions")
    codes = {name: _categories(dimensions.get(name), size) for name, size in zip(ids, sizes)}
    for dimension in dimensions.values():
        if not isinstance(dimension, dict):
            raise ValueError("invalid dimension metadata")
        labels = dimension.get("category", {}).get("label", {})
        if not isinstance(labels, dict) or any(not isinstance(label, str) for label in labels.values()):
            raise ValueError("invalid dimension labels")
    for name, expected in DIMENSIONS.items():
        if codes[name] != [expected]:
            raise ValueError(f"measurement basis changed: {name}")
    if not set(GEOGRAPHIES).issubset(codes["geo"]):
        raise ValueError("response does not contain all three Baltic countries")
    if any(not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period) for period in codes["time"]):
        raise ValueError("invalid monthly observation period")
    values = _cells(payload.get("value", {}), count)
    flags = _cells(payload.get("status", {}), count, flags=True)
    for value in values.values():
        if value is not None and (type(value) not in (int, float) or not math.isfinite(value)):
            raise ValueError("observation must be a finite number or null")
    for flag in flags.values():
        if flag is not None and (not isinstance(flag, str) or not re.fullmatch(r"[A-Za-z0-9 :;,_-]*", flag)):
            raise ValueError("invalid observation status flag")
    rows = []
    for flat_index, coordinate in enumerate(product(*(codes[name] for name in ids))):
        cell = dict(zip(ids, coordinate))
        if cell["geo"] not in GEOGRAPHIES or cell["time"] < START_PERIOD:
            continue
        value = values.get(flat_index)
        rows.append({
            "geo": cell["geo"], "period": cell["time"], "value": value,
            "status": flags.get(flat_index) or "", "missing": value is None,
        })
    rows.sort(key=lambda row: (row["geo"], row["period"]))
    if not rows:
        raise ValueError("response has no observation coordinates in the selected window")
    return {
        "format_version": FORMAT_VERSION, "series_id": SERIES_ID, "dataset": DATASET,
        "selection": DIMENSIONS, "start_period": START_PERIOD,
        "source_updated_at": payload.get("updated"),
        "dimension_labels": {
            name: {
                "label": dimensions[name].get("label"),
                "categories": {
                    code: label for code, label in dimensions[name]["category"].get("label", {}).items()
                    if code in (GEOGRAPHIES if name == "geo" else (DIMENSIONS[name],))
                },
            }
            for name in ids if name != "time"
        },
        "rows": rows,
    }


def csv_bytes(normalized: dict[str, Any], provenance: dict[str, Any]) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow([
        "series_id", "dataset", *DIMENSIONS, "geo", "period", "value", "status", "missing",
        "observed_at", "source_updated_at", "source_url", "raw_sha256",
    ])
    for row in normalized["rows"]:
        writer.writerow([
            normalized["series_id"], normalized["dataset"],
            *(normalized["selection"][name] for name in DIMENSIONS),
            row["geo"], row["period"], "" if row["missing"] else row["value"],
            row["status"], str(row["missing"]).lower(), provenance["retrieved_at"],
            normalized["source_updated_at"], provenance["request_url"], provenance["sha256"],
        ])
    return output.getvalue().encode("utf-8")


def dictionary_bytes(normalized: dict[str, Any]) -> bytes:
    return json_bytes({
        "format_version": FORMAT_VERSION,
        "series_id": SERIES_ID,
        "columns": {
            "series_id": "Versioned portaBaltica selection, not an official Eurostat series identifier.",
            "dataset": "Eurostat dataset code.",
            **{name: f"Eurostat dimension code, pinned to {value}." for name, value in DIMENSIONS.items()},
            "geo": "Reporting country: EE, LV or LT.",
            "period": "Month being measured (YYYY-MM), not the retrieval month.",
            "value": "Source reading, without rounding; blank when missing. Unit is PC_ACT.",
            "status": "Original observation flags, preserved verbatim; consult Eurostat metadata. Blank does not certify finality.",
            "missing": "true means the response had no numeric reading for this coordinate. It is not zero.",
            "observed_at": "When these response bytes were retrieved. Not the first publication time.",
            "source_updated_at": "Dataset update timestamp reported by the source; not necessarily an update to this cell.",
            "source_url": "Exact original request URL, including measurement selections.",
            "raw_sha256": "Full SHA-256 of the retained raw response; integrity check, not a publisher signature.",
        },
        "dimension_labels": normalized["dimension_labels"],
        "source_metadata": "https://ec.europa.eu/eurostat/cache/metadata/en/une_esms.htm",
        "attribution": "Source: Eurostat",
    })


def compare_rows(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    for field in ("format_version", "series_id", "dataset", "selection", "start_period"):
        if before[field] != after[field]:
            raise ValueError(f"cannot compare different measurement contracts: {field}")
    old = {(row["geo"], row["period"]): row for row in before["rows"]}
    new = {(row["geo"], row["period"]): row for row in after["rows"]}
    changes = []
    for key in sorted(old.keys() | new.keys()):
        left, right = old.get(key), new.get(key)
        if left == right:
            continue
        if left is None:
            kind = "new_period"
        elif right is None:
            kind = "removed_period"
        elif left["value"] != right["value"]:
            kind = "filled_missing" if left["missing"] else "became_missing" if right["missing"] else "value_revision"
        else:
            kind = "status_change"
        changes.append({"geo": key[0], "period": key[1], "kind": kind, "before": left, "after": right})
    metadata_changed = before["dimension_labels"] != after["dimension_labels"]
    return {
        "unchanged": not changes and not metadata_changed,
        "value_revisions": sum(change["kind"] == "value_revision" for change in changes),
        "metadata_changed": metadata_changed,
        "changes": changes,
    }

"""Create-only artifacts; configured Blob storage is authoritative."""

from __future__ import annotations

import os
import hashlib
import time
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Iterator
from uuid import uuid4

from azure.core import MatchConditions
from azure.core.exceptions import ResourceExistsError, ResourceModifiedError, ResourceNotFoundError
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient, ContainerClient, ContentSettings

from newsroom.pipeline import config

BLOB_PREFIX = "evidence/v1/"
DEFAULT_DIRECTORY = config.NEWSROOM_DIR.parent / ".newsroom-evidence"


def _relative(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if not name or "\\" in name or ":" in name or path.is_absolute() or any(p in (".", "..") for p in name.split("/")):
        raise ValueError("artifact path must be relative and confined to the evidence archive")
    return path


def put_local(root: Path, name: str, body: bytes) -> None:
    path = root.joinpath(*_relative(name).parts)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as stream:
            stream.write(body)
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        if path.read_bytes() != body:
            raise FileExistsError(f"refusing to replace existing evidence: {name}") from None


class EvidenceStore:
    def __init__(self, root: Path, container: ContainerClient | None = None) -> None:
        self.root = root
        self.container = container

    def put(self, name: str, body: bytes, *, content_type: str = "application/json") -> None:
        _relative(name)
        if self.container is not None:
            blob_name = BLOB_PREFIX + name
            try:
                self.container.upload_blob(
                    name=blob_name, data=body, overwrite=False,
                    content_settings=ContentSettings(content_type=content_type),
                )
            except ResourceExistsError:
                if self.container.download_blob(blob_name).readall() != body:
                    raise FileExistsError(f"refusing to replace existing evidence: {name}") from None
            return
        put_local(self.root, name, body)

    def read(self, name: str) -> bytes:
        path = _relative(name)
        if self.container is not None:
            return self.container.download_blob(BLOB_PREFIX + name).readall()
        return self.root.joinpath(*path.parts).read_bytes()

    def read_version(self, name: str) -> tuple[bytes | None, str | None]:
        """Read bytes and their concurrency token from the same response."""
        _relative(name)
        try:
            if self.container is not None:
                download = self.container.download_blob(BLOB_PREFIX + name)
                return download.readall(), download.properties.etag
            body = self.read(name)
            return body, hashlib.sha256(body).hexdigest()
        except (FileNotFoundError, ResourceNotFoundError):
            return None, None

    def replace(self, name: str, body: bytes, *, etag: str | None) -> bool:
        """Compare-and-swap a catalogue, never an immutable release."""
        path = _relative(name)
        if name != "index.json" and not (
            len(path.parts) == 2 and path.parts[0] == "months" and path.suffix == ".json"
        ):
            raise ValueError("only evidence catalogues may be replaced")
        if self.container is not None:
            kwargs = {"etag": etag, "match_condition": MatchConditions.IfNotModified} if etag else {}
            try:
                self.container.upload_blob(
                    name=BLOB_PREFIX + name, data=body, overwrite=etag is not None,
                    content_settings=ContentSettings(
                        content_type="application/json", cache_control="public, max-age=60",
                    ), **kwargs,
                )
                return True
            except (ResourceExistsError, ResourceModifiedError, ResourceNotFoundError):
                return False
        target = self.root.joinpath(*path.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        lock = target.with_name(target.name + ".lock")
        for _ in range(100):
            try:
                descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                break
            except FileExistsError:
                time.sleep(0.01)
        else:
            raise OSError("evidence catalogue lock unavailable")
        staging = target.with_name(target.name + "." + uuid4().hex + ".staging")
        try:
            _, current = self.read_version(name)
            if current != etag:
                return False
            with staging.open("xb") as stream:
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(staging, target)
            return True
        finally:
            staging.unlink(missing_ok=True)
            os.close(descriptor)
            lock.unlink()


@contextmanager
def open_store(root: Path, *, cloud: bool = False) -> Iterator[EvidenceStore]:
    if not cloud:
        yield EvidenceStore(root)
        return
    if not config.STORAGE_ACCOUNT_URL:
        raise ValueError("cloud mode requires the existing BLOB_ACCOUNT_URL setting")
    with DefaultAzureCredential(process_timeout=60) as credential:
        with BlobServiceClient(config.STORAGE_ACCOUNT_URL, credential=credential) as service:
            yield EvidenceStore(root, service.get_container_client(config.RAW_CONTAINER))

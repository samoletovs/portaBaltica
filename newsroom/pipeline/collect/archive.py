"""The raw archive.

Every retrieved payload is written here **before** any parser touches it. That
ordering is the whole point: when the validator rejects an article three stages
later, the bytes that produced it are still on disk and in Blob, so the failure
is reproducible rather than a story about what the feed probably said.

Blob access uses ``DefaultAzureCredential`` — managed identity in the Function
App, developer identity locally. There is no connection string anywhere.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from newsroom.pipeline import config
from newsroom.pipeline.models import RawItem

log = logging.getLogger(__name__)


class RawArchive:
    """Writes raw items to a local mirror and, when configured, to Blob.

    The local mirror is unconditional. Reproducibility must not depend on Azure
    being reachable at the moment a collector runs.
    """

    def __init__(
        self,
        *,
        local_dir: Path | None = None,
        account_url: str | None = None,
        container: str | None = None,
    ) -> None:
        self._local_dir = Path(local_dir or config.LOCAL_ARCHIVE_DIR)
        self._account_url = account_url if account_url is not None else config.STORAGE_ACCOUNT_URL
        self._container = container or config.RAW_CONTAINER
        self._blob: Any = None
        self._blob_failed = False

    # -- blob ---------------------------------------------------------------
    def _container_client(self) -> Any:
        if self._blob is not None or self._blob_failed or not self._account_url:
            return self._blob
        try:
            from azure.identity import DefaultAzureCredential
            from azure.storage.blob import BlobServiceClient

            service = BlobServiceClient(self._account_url, credential=DefaultAzureCredential())
            container = service.get_container_client(self._container)
            try:
                container.create_container()
            except Exception:  # noqa: BLE001 - already exists is the normal case
                pass
            self._blob = container
        except Exception as exc:  # noqa: BLE001 - archive degrades, never blocks
            log.warning("blob archive unavailable (%s); local mirror only", exc)
            self._blob_failed = True
        return self._blob

    # -- api ----------------------------------------------------------------
    async def store(self, item: RawItem) -> str:
        """Persist ``item`` and return the archive reference."""
        name = item.archive_name
        await asyncio.to_thread(self._write_local, name, item)
        container = self._container_client()
        if container is not None:
            try:
                await asyncio.to_thread(self._write_blob, container, name, item)
            except Exception as exc:  # noqa: BLE001
                log.warning("blob write failed for %s (%s); local mirror holds it", name, exc)
        return f"{self._container}/{name}"

    def _write_local(self, name: str, item: RawItem) -> None:
        target = self._local_dir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(item.body)

    def _write_blob(self, container: Any, name: str, item: RawItem) -> None:
        container.upload_blob(
            name=name,
            data=item.body,
            overwrite=True,
            metadata={
                "source_id": item.source_id,
                "url": item.url[:1000],
                "retrieved_at": item.retrieved_at,
                "sha256": item.digest,
                "http_status": str(item.http_status),
            },
        )

    def read(self, archive_name: str) -> bytes:
        """Read back an archived payload from the local mirror."""
        return (self._local_dir / archive_name).read_bytes()

"""Expected I/O and validation failures; programming errors remain visible."""

import httpx
from azure.core.exceptions import AzureError

EXPECTED_FAILURES = (OSError, ValueError, httpx.HTTPError, AzureError)

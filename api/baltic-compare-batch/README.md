# Baltic comparison batches

`GET /api/baltic-compare-batch?indicators=gdp,inflation&years=5`

- `indicators`: one to eight unique, comma-separated registry IDs, in response
  order. Invalid syntax, duplicates or oversized lists return HTTP 400 before
  any upstream work. A syntactically valid unknown ID returns an item-level 400;
  its valid siblings still run. URLs and arbitrary cube queries are not accepted.
- `years`: an integer from 1 to 30, default 5.
- `list` is not a batch parameter. Metadata remains available, unchanged, at
  `/api/baltic-compare?list=1`.

A valid request returns HTTP 200 and `{ "results": [...] }`. Each item carries
`indicator`, `years`, and `status`:

- Status 200: `data` is the original single-indicator response, including
  `countries`, `reference`, `assumptions`, `dataset`, and `fetchedAt`. `cache`
  contains `ageSeconds` and `state` (`hit`, `miss`, `stale`, or `revalidating`).
- Status 400, 502, or 503: `error` explains the failure. There is no `data`
  property, fabricated empty series, or successful null placeholder.

The envelope is `no-store`, with zero response-cache TTL and grace. Successful
items share the **same cache entries** as `/api/baltic-compare`, keyed by indicator
and canonical years, with the existing one-hour TTL and six-hour absolute grace
ceiling. In-flight work is shared across both routes. Errors are not cached;
retrying a partial batch only refetches the unsuccessful items.

## Work and request budgets

The existing rate limiter still charges one hit per HTTP request, including
warm responses. One request can now perform up to eight indicator fetches rather
than one. The shared comparison worker limits both routes together to eight
active upstream requests and 64 queued requests per process. Excess work becomes
an item-level 503; queueing spends the same 20-second budget as the HTTP call.
Other endpoints and their rate limits are unchanged. These are per-process
bounds, like the existing cache and rate limiter, not cross-instance quotas.

The browser's existing `fetchBalticCompare` groups cache misses over 20ms, sends
up to eight same-years IDs per batch and at most two HTTP batches concurrently.
Each HTTP batch has a 25-second client deadline so a stalled connection cannot
occupy a concurrency slot indefinitely.
It keeps per-indicator localStorage entries and deducts the reported server age
from their one-hour TTL. Electricity delivery-interval caches are unaffected.
Subscriber cancellation cannot cancel another subscriber or another batch item;
an entirely unobserved batch is aborted. Errors reject only the affected reader,
and a later call can retry. There is no automatic retry or single-route fallback.

A simultaneous 61-indicator cold burst therefore uses eight comparison HTTP
requests, not 61. With the observed 13 other APIs and document that is 22 requests
against the existing 60/minute limit. Separately arriving lazy modules may form
smaller batches; final browser measurement must use the integrated build.

## Local preview

Forward `/api/baltic-compare-batch` to this directory's `index.js`, passing decoded
query parameters as `req.query`, HTTP headers as `req.headers`, and returning
`context.res.status`, `.headers`, and `.body`. Do not forward this route to the
old production backend: before deployment it cannot serve batches.

Targeted regression gate: `npm test -- tests/comparisonBatch.test.ts`.

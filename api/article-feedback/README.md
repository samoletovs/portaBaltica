# Private article feedback

`POST /api/article-feedback` relays a bounded JSON request to the existing
`portabaltica-func` Function App. The SWA has no managed identity, so it must
not write feedback to a local file or hold a storage key.

The Python `article_feedback` function uses managed identity in Azure and
stores immutable records in the private `feedback` container. It verifies the
container's access level and that the target article is reader-facing. Only a
durably acknowledged write, or an existing receipt with the same request hash,
returns `202 { "ok": true, "id": "<uuid>" }`. There is no local fallback.
The browser checks that receipt, retains its draft after an uncertain failure,
and reuses its reference on retry. It never interprets an arbitrary HTTP 200
as confirmation. Different content cannot overwrite an existing reference.

Records contain only reference, article slug, feedback type, message, optional
unverified contact, creation time and expiry time. IP addresses and user agents
are not forwarded to this store. Existing platform operational logs are separate.
Nothing publishes the feedback, invokes a model, sends email or subscribes a
reader to anything. A receipt confirms storage, not that a human has reviewed it.

The proxy retains the site's existing per-client request limit and has a
20-second POST deadline with redirects refused. The Function App additionally
enforces 1,000 validated submission attempts per UTC day across instances, using
conditional blob metadata updates. Retries count as attempts. Message/contact
limits are 2,000/200 characters; invalid requests cannot create feedback records.
The POST relay uses native `fetch` because the shared Eurostat JSON helper is
GET-only and does not expose the response status needed for receipt validation.

## Retention and deployment

The owner approved private storage and deletion after **90 days** on
2026-09-13. `newsroom/feedback-retention.json` is the policy read by the
backend, frontend disclosure and Bicep template. Base blobs, versions and
snapshots in `feedback/` are scheduled for deletion; other containers are not.
Records are never overwritten, so retrying does not restart the retention clock.
Azure's existing **30-day soft-delete recovery window** remains unchanged.
Deletion is asynchronous: this is not a promise of permanent erasure at an
exact instant.

Prepare the container/policy before releasing the code:

```powershell
# First prints the target and preserved rule count without writing.
.\scripts\configure-feedback-storage.ps1
.\scripts\configure-feedback-storage.ps1 -Apply
```

The script reads and preserves every other lifecycle rule, refuses a failed
read or concurrent policy change, verifies privacy and checks the installed
policy. Do **not** redeploy all of `main.bicep` just to add feedback: unrelated
live infrastructure drift, including article-container access, is outside this
change. The same additions are in the template for future complete deployments.

Normal code release remains through the two existing master workflows.
The newsroom workflow deploys the Python route; CI/CD deploys the SWA relay and
form. If one reaches production first, submissions fail visibly until the
service is ready; no temporary-file acknowledgement is substituted.

## Publisher review

There is deliberately no public read/list endpoint. The publisher can use
Azure Storage Browser with their existing authorized account, or Azure CLI
with Entra authentication:

```powershell
az storage blob list --account-name stportabalticabpmff5so `
  --container-name feedback --prefix submissions/ --auth-mode login `
  --query "[].{name:name,modified:properties.lastModified}" -o table

az storage blob download --account-name stportabalticabpmff5so `
  --container-name feedback --name "submissions/<reference>.json" `
  --file "$env:TEMP\feedback-review.json" --auth-mode login
```

Treat submissions as untrusted reader text and contact details as unverified.
Do not put downloaded feedback in git, public article storage or a third-party
service. Delete local review copies when finished. Do not edit stored records:
doing so changes their modification-based retention clock.

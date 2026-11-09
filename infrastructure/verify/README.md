# Identity smoke test

A single-function Azure Functions app whose only job is to prove that the
newsroom Function App's **system-assigned managed identity** can actually do
the two things `infrastructure/main.bicep` grants it:

1. call `gpt-6-luna` on the shared `foundrylab-aiservices` account, and
2. read and write blobs on its own storage account.

It exists because a role assignment that is present in a template but never
exercised is indistinguishable from one that does not work. `az deployment
group what-if` proves the *shape*; this proves the *behaviour*.

There is no API key, connection string or secret anywhere in it. Every call
uses `DefaultAzureCredential`, which on the deployed app resolves to the
Function App's system-assigned identity. If a grant is missing, the probe
returns HTTP 500 with the underlying `AuthorizationPermissionMismatch` or
`PermissionDenied` — a failure, not a silent pass.

The probe requires `AZURE_OPENAI_DEPLOYMENT=gpt-6-luna`, sends
`max_completion_tokens=80`, retains `temperature=0`, and sets
`reasoning_effort=none`. Other deployment names are rejected before authentication.
The endpoint, API version and Entra ID authentication are unchanged.

## Run it

Publishing this standalone app replaces the production newsroom package.
Do not publish it just to check model compatibility. For a local, model-only
smoke, import `_check_foundry` and use the existing endpoint/deployment/API-version
settings with a developer Entra ID credential. Do not call `_check_blob` for
a read-only model check. A local call proves developer access, not the deployed
managed identity's grants.

```powershell
# Deploy (remote build; Flex Consumption, Python 3.12)
cd infrastructure/verify
func azure functionapp publish portabaltica-func

# Invoke
$key = az functionapp keys list -n portabaltica-func -g portabaltica-rg `
  --query "functionKeys.default" -o tsv
irm "https://portabaltica-func.azurewebsites.net/api/identity-check?code=$key" | ConvertTo-Json -Depth 6
```

A pass looks like `"overall": "PASS"` with a real model completion in
`checks.foundry_openai.completion` and a blob round-trip in
`checks.blob_storage`.

## This is not the pipeline

The newsroom pipeline (collect → detect → rank → write → validate → publish)
already occupies this Function App and is deployed by `newsroom-ci.yml`.
The standalone probe is not part of that workflow. Its deployment commands
above are for explicit identity maintenance, not routine model verification;
restore the pipeline package afterwards.

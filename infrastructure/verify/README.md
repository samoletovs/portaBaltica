# Identity smoke test

A single-function Azure Functions app whose only job is to prove that the
newsroom Function App's **system-assigned managed identity** can actually do
the two things `infrastructure/main.bicep` grants it:

1. call `gpt-4o-mini` on the shared `foundrylab-aiservices` account, and
2. read and write blobs on its own storage account.

It exists because a role assignment that is present in a template but never
exercised is indistinguishable from one that does not work. `az deployment
group what-if` proves the *shape*; this proves the *behaviour*.

There is no API key, connection string or secret anywhere in it. Every call
uses `DefaultAzureCredential`, which on the deployed app resolves to the
Function App's system-assigned identity. If a grant is missing, the probe
returns HTTP 500 with the underlying `AuthorizationPermissionMismatch` or
`PermissionDenied` — a failure, not a silent pass.

## Run it

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
is built in the `feat/newsroom-pipeline` workstream and will replace the
contents of this Function App. Redeploy this probe any time the identity or
the role assignments change, and delete it once the pipeline ships its own
health check.

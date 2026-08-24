// ──────────────────────────────────────────────────────────────────────
// portaBaltica — Infrastructure
//
// Resources owned by this template (resource group: portabaltica-rg):
//   - Log Analytics + Application Insights (0.1 GB/day cap)
//   - Storage account + blob containers: articles, raw-feeds, approvals
//   - Azure Functions on Flex Consumption (Python) — the newsroom pipeline
//   - System-assigned managed identity on the Function App
//   - RBAC: Blob/Queue/Table Data Contributor on its own storage
//   - RBAC: Cognitive Services OpenAI User on the SHARED foundryLab account
//           (cross-resource-group — see modules/foundry-role-assignment.bicep)
//
// NOT owned by this template:
//   - The Static Web App. It is live in `era-rg` (West Europe) serving
//     portabaltica.naurolabs.com. See "Static Web App" below and the
//     deviation note in AGENTS.md.
//
// Auth model: managed identity only. There is no key, connection string or
// @secure() parameter anywhere in this file, and there must never be one.
// `foundrylab-aiservices` has disableLocalAuth=true, so an API key would not
// work even if someone added it. Storage sets allowSharedKeyAccess=false for
// the same reason.
//
// Create the resource group once (Bicep here is resourceGroup-scoped):
//   az group create -n portabaltica-rg -l northeurope
//
// Deploy:
//   az deployment group create \
//     --resource-group portabaltica-rg \
//     --template-file infrastructure/main.bicep
// ──────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

@description('Azure region for resources owned by this template.')
param location string = 'northeurope'

@description('Environment name.')
param environment string = 'production'

@description('Suffix for globally unique resource names. Deterministic per resource group.')
param uniqueSuffix string = uniqueString(resourceGroup().id)

// ── Shared foundryLab AI account (no new AI resource is ever created here) ──

@description('Existing shared AI Services account. Reused, never re-created.')
param foundryAccountName string = 'foundrylab-aiservices'

@description('Resource group holding the shared AI Services account.')
param foundryResourceGroup string = 'foundrylab-rg'

@description('Model deployment used by the newsroom writer step.')
param openAiDeployment string = 'gpt-4o-mini'

@description('Azure OpenAI data-plane API version.')
param openAiApiVersion string = '2024-10-21'

@description('Set false to skip the cross-RG role assignment when the deploying principal cannot write role assignments in foundryResourceGroup.')
param grantFoundryAccess bool = true

// ── Static Web App ──────────────────────────────────────────────────────

@description('Whether this template owns the Static Web App. Default false: the live SWA is in era-rg and moving it risks the custom domain. See AGENTS.md.')
param manageStaticWebApp bool = false

@description('Resource group that currently holds portabaltica-swa.')
param staticWebAppResourceGroup string = 'era-rg'

// ── Pipeline ────────────────────────────────────────────────────────────

@description('NCRONTAB schedule for the newsroom timer trigger. Three runs a day; the pipeline emits fewer articles on a quiet day rather than padding.')
param newsroomSchedule string = '0 0 5,11,17 * * *'

@description('Python version for the Flex Consumption Function App.')
@allowed(['3.11', '3.12'])
param pythonVersion string = '3.12'

// ── Naming and tags ─────────────────────────────────────────────────────

var projectName = 'portabaltica'

var tags = {
  project: projectName
  environment: environment
  managedBy: 'bicep'
  costCenter: 'naurolabs-research'
}

var storageAccountName = 'st${projectName}${take(uniqueSuffix, 8)}'
var functionAppName = '${projectName}-func'
var functionPlanName = '${projectName}-plan'
var staticWebAppName = '${projectName}-swa'

// Blob containers the newsroom pipeline reads and writes.
//   raw-feeds — every ingested item is archived here BEFORE anything parses it,
//               so a validator failure is always reproducible from the bytes we
//               actually received (newsroom/README.md, step 1).
//   articles  — validated article JSON; the SWA serves these statically.
//   approvals — pending tier B/C items awaiting a human Telegram decision.
var newsroomContainers = ['articles', 'raw-feeds', 'approvals']

// Flex Consumption deploys the function package from a blob container using the
// app's own identity, so it needs a container of its own.
var deploymentContainerName = 'deployment'

var azureOpenAiEndpoint = 'https://${foundryAccountName}.openai.azure.com/'

// Built-in role definition GUIDs, read from Azure with
// `az role definition list --name "<role>" --query "[0].name"` rather than
// copied from memory — a wrong GUID fails the deployment with the unhelpful
// "RoleDefinitionDoesNotExist".
var roleStorageBlobDataContributor = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var roleStorageQueueDataContributor = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var roleStorageTableDataContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var roleCognitiveServicesOpenAiUser = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

// ── Static Web App ────────────────────────────────────────────────
// Deliberately not created by default. `portabaltica-swa` is live in era-rg,
// bound to portabaltica.naurolabs.com with status Ready. ARM's
// validateMoveResources says the move to portabaltica-rg is permitted, but the
// custom-domain rebind is the risk and the only gain is tidiness, so the move
// is deferred rather than bundled into a feature PR. Setting this to true
// while the era-rg copy still exists would create a SECOND Static Web App.
//
// The SWA stays Free. It never holds a managed identity — it does not need one,
// because the newsroom generates articles on a timer and the browser only ever
// reads finished static JSON.
resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = if (manageStaticWebApp) {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

// ── Monitoring ────────────────────────────────────────────────────
// Reused by the Function App rather than given a second workspace. The
// 0.1 GB/day cap is what keeps observability at ~€0 and is not negotiable.
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${projectName}-law'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${projectName}-ai'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ── Storage ───────────────────────────────────────────────────────
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // Shared-key auth off: the only way in is the Function App's managed
    // identity. This is what makes "no API keys anywhere" enforceable rather
    // than aspirational.
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 30
    }
  }
}

resource newsroomBlobContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = [
  for containerName in newsroomContainers: {
    parent: blobService
    name: containerName
    properties: {
      publicAccess: 'None'
    }
  }
]

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: {
    publicAccess: 'None'
  }
}

// raw-feeds is an append-only archive that is written every run and read almost
// never — exactly the shape cool tier is priced for. Kept, not deleted: it is
// the evidence that a validator failure is reproducible.
resource storageLifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'raw-feeds-tier-down'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['raw-feeds']
            }
            actions: {
              baseBlob: {
                tierToCool: { daysAfterModificationGreaterThan: 30 }
                tierToArchive: { daysAfterModificationGreaterThan: 180 }
              }
            }
          }
        }
      ]
    }
  }
}

// Write/delete audit for the archive. Read logs are deliberately excluded:
// they are the chatty category and would eat the 0.1 GB/day cap.
resource storageDiagnostics 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: blobService
  name: '${projectName}-blob-diagnostics'
  properties: {
    workspaceId: logAnalytics.id
    logs: [
      { category: 'StorageWrite', enabled: true }
      { category: 'StorageDelete', enabled: true }
    ]
  }
}

// ── Function App (Flex Consumption, Python) ───────────────────────
// This is the only component in portaBaltica that holds an identity, and that
// is the whole design: batch generation on a timer means the SWA stays Free
// and the browser never sees a credential.
resource functionPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: functionPlanName
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionPlan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      runtime: {
        name: 'python'
        version: pythonVersion
      }
      scaleAndConcurrency: {
        // No always-ready instances: a timer-triggered batch job has no cold
        // start worth hiding, and always-ready is what turns Flex Consumption
        // from ~€0 into a standing monthly charge.
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
    }
    siteConfig: {
      appSettings: [
        // Identity-based host storage. No AzureWebJobsStorage connection string.
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'AZURE_OPENAI_ENDPOINT', value: azureOpenAiEndpoint }
        { name: 'AZURE_OPENAI_DEPLOYMENT', value: openAiDeployment }
        { name: 'AZURE_OPENAI_API_VERSION', value: openAiApiVersion }
        { name: 'BLOB_ACCOUNT_URL', value: storage.properties.primaryEndpoints.blob }
        { name: 'NEWSROOM_CONTAINER_ARTICLES', value: 'articles' }
        { name: 'NEWSROOM_CONTAINER_RAW_FEEDS', value: 'raw-feeds' }
        { name: 'NEWSROOM_CONTAINER_APPROVALS', value: 'approvals' }
        { name: 'NEWSROOM_SCHEDULE', value: newsroomSchedule }
      ]
    }
  }
}

// ── RBAC on the Function App's own storage ────────────────────────
// Blob Data Contributor is the grant the newsroom pipeline needs: it reads and
// writes articles/raw-feeds/approvals and creates the host's own containers.
// Queue and Table Data Contributor are required by the Functions host itself
// once AzureWebJobsStorage is identity-based — without them the host cannot
// take timer singleton locks and the app starts but never fires.
resource blobDataContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, functionApp.id, roleStorageBlobDataContributor)
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      roleStorageBlobDataContributor
    )
  }
}

resource queueDataContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, functionApp.id, roleStorageQueueDataContributor)
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      roleStorageQueueDataContributor
    )
  }
}

resource tableDataContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, functionApp.id, roleStorageTableDataContributor)
  properties: {
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      roleStorageTableDataContributor
    )
  }
}

// ── RBAC on the shared foundryLab AI account (cross-resource-group) ──
// portaBaltica is listed in .github/wiki/insights/foundrylab-shared-account.md
// as a project that had NOT adopted the shared account. This is the line that
// changes that, and it lives in the template precisely because the wiki records
// the manual version of this step as "easy to forget".
module foundryAccess 'modules/foundry-role-assignment.bicep' = if (grantFoundryAccess) {
  name: '${projectName}-foundry-openai-user'
  scope: resourceGroup(foundryResourceGroup)
  params: {
    aiAccountName: foundryAccountName
    principalId: functionApp.identity.principalId
    roleDefinitionId: roleCognitiveServicesOpenAiUser
    assignmentSuffix: '${projectName}-newsroom-openai-user'
  }
}

// ── Outputs ───────────────────────────────────────────────────────
output functionAppName string = functionApp.name
output functionAppHostname string = functionApp.properties.defaultHostName

@description('Principal id of the Function App MI. Needed for any out-of-band role assignment.')
output functionAppPrincipalId string = functionApp.identity.principalId

output storageAccountName string = storage.name
output blobAccountUrl string = storage.properties.primaryEndpoints.blob
output newsroomContainerNames array = newsroomContainers

output azureOpenAiEndpoint string = azureOpenAiEndpoint
output azureOpenAiDeployment string = openAiDeployment

output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceId string = logAnalytics.id

@description('Resource id of the Static Web App, wherever it currently lives.')
output staticWebAppResourceId string = manageStaticWebApp
  ? resourceId('Microsoft.Web/staticSites', staticWebAppName)
  : resourceId(
      subscription().subscriptionId,
      staticWebAppResourceGroup,
      'Microsoft.Web/staticSites',
      staticWebAppName
    )

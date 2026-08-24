// ──────────────────────────────────────────────────────────────────────
// portaBaltica — cross-resource-group role assignment on the shared
// foundryLab AI account.
//
// This module exists for one reason: the grant is CROSS-RESOURCE-GROUP.
// The Function App lives in `portabaltica-rg`; the AI account lives in
// `foundrylab-rg`. A role assignment must be authored at the scope of the
// resource being granted, so it cannot be written inline in main.bicep.
//
// `.github/wiki/insights/foundrylab-shared-account.md` records this exact
// step as "easy to forget". Making it a module means it is deployed with
// the rest of the infrastructure rather than remembered afterwards.
//
// If the deploying principal lacks `Microsoft.Authorization/roleAssignments/write`
// on foundrylab-rg, this module fails and the grant must be made out of band —
// see the command in AGENTS.md § "Granting Foundry access out of band".
// ──────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

@description('Name of the existing shared AI Services / Azure OpenAI account.')
param aiAccountName string

@description('Principal id of the identity being granted access (Function App system-assigned MI).')
param principalId string

@description('Built-in role definition GUID. Defaults to Cognitive Services OpenAI User.')
param roleDefinitionId string = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

@description('Stable suffix so repeat deployments produce the same assignment GUID.')
param assignmentSuffix string

resource aiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: aiAccountName
}

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: aiAccount
  name: guid(aiAccount.id, principalId, assignmentSuffix)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
  }
}

@description('Resource id of the AI account the grant was made against.')
output aiAccountId string = aiAccount.id

@description('Resource id of the created role assignment.')
output roleAssignmentId string = roleAssignment.id

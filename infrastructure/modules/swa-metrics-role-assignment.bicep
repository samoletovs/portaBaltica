// ──────────────────────────────────────────────────────────────────────
// portaBaltica — cross-resource-group role assignment letting CI read the
// Static Web App's traffic metrics.
//
// This module exists for the same reason as `foundry-role-assignment.bicep`:
// the grant is CROSS-RESOURCE-GROUP. `main.bicep` is scoped to
// `portabaltica-rg`, the Static Web App lives in `era-rg`, and a role
// assignment has to be authored at the scope of the resource being granted.
//
// WHAT IT IS FOR. `.github/workflows/visit-stats.yml` reads the `SiteHits`
// metric hourly and publishes the counts the status panel shows. The site
// cannot count its own traffic — the SWA is Free tier and has no managed
// identity, and its storage account disables shared keys — so the reading is
// done from CI with the repository's existing federated identity rather than
// by instrumenting anything.
//
// WHY IT IS DECLARED HERE. The grant was first made by hand with
// `az role assignment create`. That works and is invisible: a permission that
// exists only in somebody's shell history is the same undeclared drift as the
// `articles` container being public while the template says otherwise. If it is
// load-bearing it belongs in the template.
//
// SCOPE. `Monitoring Reader` on the single Static Web App resource — not the
// resource group, not the subscription. The role is `*/read` plus Log Analytics
// search, so at this scope it can read that one resource and its metrics and
// nothing else. It cannot deploy, restart or reconfigure the site.
//
// The assignment is opt-in because the principal is not created by this
// template: it is the GitHub OIDC service principal, so its object id has to be
// supplied. Deploy without `ciPrincipalId` and nothing is granted.
//
// If the deploying principal lacks `Microsoft.Authorization/roleAssignments/write`
// on era-rg, this module fails and the grant must be made out of band — see the
// command in AGENTS.md § "Counting traffic, and why there is no counter".
// ──────────────────────────────────────────────────────────────────────

targetScope = 'resourceGroup'

@description('Name of the existing Static Web App whose metrics CI reads.')
param staticWebAppName string

@description('Object id of the GitHub OIDC service principal that runs the visit-stats workflow.')
param principalId string

@description('Built-in role definition GUID. Defaults to Monitoring Reader.')
param roleDefinitionId string = '43d0d8ad-25c7-4714-9337-8ba259a9fe05'

@description('Stable suffix so repeat deployments produce the same assignment GUID.')
param assignmentSuffix string

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' existing = {
  name: staticWebAppName
}

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: staticWebApp
  name: guid(staticWebApp.id, principalId, assignmentSuffix)
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleDefinitionId)
  }
}

@description('Resource id of the Static Web App the grant was made against.')
output staticWebAppId string = staticWebApp.id

@description('Resource id of the created role assignment.')
output roleAssignmentId string = roleAssignment.id

[CmdletBinding()]
param(
    [string] $AccountName = 'stportabalticabpmff5so',
    [string] $ResourceGroup = 'portabaltica-rg',
    [string] $Subscription,
    [switch] $Apply
)

$ErrorActionPreference = 'Stop'
$rulePath = Join-Path $PSScriptRoot '..\newsroom\feedback-retention.json'
$rule = Get-Content -Raw -LiteralPath $rulePath | ConvertFrom-Json
$days = $rule.definition.actions.baseBlob.delete.daysAfterModificationGreaterThan
if ($rule.name -ne 'feedback-expiry' -or
    @($rule.definition.filters.prefixMatch).Count -ne 1 -or
    $rule.definition.filters.prefixMatch[0] -cne 'feedback/' -or
    $days -ne 90 -or
    $rule.definition.actions.snapshot.delete.daysAfterCreationGreaterThan -ne $days -or
    $rule.definition.actions.version.delete.daysAfterCreationGreaterThan -ne $days) {
    throw 'The approved feedback-only 90-day policy does not match the file.'
}

$subscriptionArgs = if ($Subscription) { @('--subscription', $Subscription) } else { @() }
function Read-Policy {
    $text = & az storage account management-policy show --account-name $AccountName `
        --resource-group $ResourceGroup @subscriptionArgs --output json
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the existing lifecycle policy; refusing to replace it.' }
    return ($text | ConvertFrom-Json).policy
}
function Policy-Json($value) { return ConvertTo-Json -InputObject $value -Depth 30 -Compress }

$before = Read-Policy
$untouched = @($before.rules | Where-Object { $_.name -cne $rule.name })
$planned = [ordered]@{ rules = @($untouched) + @($rule) }
Write-Output "Target: $ResourceGroup/$AccountName; private container feedback; deletion after $days days."
Write-Output "Preserving $($untouched.Count) other lifecycle rule(s). Blob recovery settings are unchanged."
if (-not $Apply) {
    Write-Output 'Dry run only. Pass -Apply to create the container and apply this policy.'
    return
}

$latest = Read-Policy
if ((Policy-Json $latest) -cne (Policy-Json $before)) {
    throw 'The lifecycle policy changed during preparation; nothing was written.'
}
$file = [IO.Path]::GetTempFileName()
try {
    Policy-Json $planned | Set-Content -LiteralPath $file -Encoding utf8
    & az storage container create --account-name $AccountName --name feedback --auth-mode login `
        --public-access off @subscriptionArgs --only-show-errors --output none
    if ($LASTEXITCODE -ne 0) { throw 'Private feedback container creation failed.' }
    $container = & az storage container show --account-name $AccountName --name feedback `
        --auth-mode login @subscriptionArgs --output json | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Could not verify the feedback container.' }
    if ($null -eq $container.properties -or $null -eq $container.properties.PSObject.Properties['publicAccess']) {
        throw 'Container response did not report its access level.'
    }
    if ($null -ne $container.properties.publicAccess) { throw 'Feedback container is not private.' }

    & az storage account management-policy create --account-name $AccountName --resource-group $ResourceGroup `
        --policy "@$file" @subscriptionArgs --output none
    if ($LASTEXITCODE -ne 0) { throw 'Feedback retention policy update failed.' }
    $after = Read-Policy
    $otherRules = @($after.rules | Where-Object { $_.name -cne $rule.name })
    if ((Policy-Json $otherRules) -cne (Policy-Json $untouched)) {
        throw 'An unrelated lifecycle rule changed; inspect the policy before deploying.'
    }
    $installed = @($after.rules | Where-Object { $_.name -ceq $rule.name })
    if ($installed.Count -ne 1 -or
        @($installed[0].definition.filters.prefixMatch).Count -ne 1 -or
        $installed[0].definition.filters.prefixMatch[0] -cne 'feedback/' -or
        @($installed[0].definition.filters.blobTypes).Count -ne 1 -or
        $installed[0].definition.filters.blobTypes[0] -cne 'blockBlob' -or
        $installed[0].definition.actions.baseBlob.delete.daysAfterModificationGreaterThan -ne $days -or
        $installed[0].definition.actions.snapshot.delete.daysAfterCreationGreaterThan -ne $days -or
        $installed[0].definition.actions.version.delete.daysAfterCreationGreaterThan -ne $days) {
        throw 'The installed feedback retention rule did not match.'
    }
    Write-Output 'Verified private feedback storage, 90-day retention, and unchanged unrelated rules.'
} finally {
    Remove-Item -LiteralPath $file
}

# Mutation check for the figure reconciler.
#
# Reconciliation is the one place in the pipeline that ADDS a traceability
# record rather than checking one, so it is the one place where a bug would
# manufacture provenance instead of refusing. Every mutation below makes it
# declare something it should not, and each must turn a test red.
#
# Usage: pwsh -File scripts/mutate-reconcile.ps1

$ErrorActionPreference = 'Stop'
$target = Join-Path $PSScriptRoot '..\newsroom\pipeline\write\reconcile.py'
$target = (Resolve-Path $target).Path
$suite = 'newsroom/tests/pipeline/test_reconcile.py', 'newsroom/tests/pipeline/test_generation.py'
$original = Get-Content -Raw -LiteralPath $target

$mutations = @(
    @{
        Name = 'ambiguity guard removed (declares the first of several matches)'
        From = '        if len(matches) != 1:'
        To   = '        if len(matches) < 1:'
    },
    @{
        Name = 'unverified numbers declared from the prose itself'
        From = @'
        name, value = matches[0]
'@
        To   = @'
        name, value = matches[0] if matches else ("latest_value", token.value)
'@
    },
    @{
        Name = 'value coerced to the prose token instead of the verified field'
        From = '                value=value,'
        To   = '                value=token.value,'
    },
    @{
        Name = 'already-declared check disabled (duplicate figures)'
        From = '        if _already_declared(token, block.figures):'
        To   = '        if False:'
    }
)

$results = @()
try {
    foreach ($m in $mutations) {
        if (-not $original.Contains($m.From)) {
            throw "mutation target not found, script is stale: $($m.Name)"
        }
        $mutated = $original.Replace($m.From, $m.To)
        Set-Content -LiteralPath $target -Value $mutated -NoNewline

        # The second mutation needs the guard above it to let zero matches through.
        if ($m.Name -like 'unverified numbers*') {
            $mutated = $mutated.Replace('        if len(matches) != 1:', '        if len(matches) > 1:')
            Set-Content -LiteralPath $target -Value $mutated -NoNewline
        }

        & python -m pytest @suite -q 2>&1 | Out-Null
        $caught = $LASTEXITCODE -ne 0
        $results += [pscustomobject]@{
            Mutation = $m.Name
            Result   = if ($caught) { 'CAUGHT' } else { 'SURVIVED' }
        }
        Set-Content -LiteralPath $target -Value $original -NoNewline
    }
}
finally {
    Set-Content -LiteralPath $target -Value $original -NoNewline
}

$results | Format-Table -AutoSize
if ($results.Result -contains 'SURVIVED') {
    Write-Error 'A mutation survived. The reconciler is not adequately tested.'
    exit 1
}
Write-Host 'All mutations caught.' -ForegroundColor Green

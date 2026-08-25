# Mutation check for the "elsewhere" rail.
#
# The rail shows other outlets' work. Adding a view control to it is exactly
# the kind of change that can quietly turn a narrowed list into "our" feed, or
# make an outbound link stop being outbound. Each mutation below breaks one of
# those properties and must turn a test red.
#
# Usage: pwsh -File scripts/mutate-rail.ps1

$ErrorActionPreference = 'Stop'
$target = (Resolve-Path (Join-Path $PSScriptRoot '..\src\components\news\ElsewhereRail.tsx')).Path
$suite = 'tests/elsewhereRail.test.tsx'
$original = Get-Content -Raw -LiteralPath $target

$mutations = @(
    @{
        Name = 'rail renders our own prose next to the link-out card'
        From = '<LinkOutCardFromSummary key={summary.id ?? summary.slug} summary={summary} />'
        To   = '<div key={summary.id ?? summary.slug}><p>{summary.dek}</p><LinkOutCardFromSummary summary={summary} /></div>'
    },
    @{
        Name = 'outlet filter silently does nothing'
        From = '() => (outlet === ALL ? items : items.filter((item) => outletOf(item) === outlet)),'
        To   = '() => items,'
    },
    @{
        Name = 'cap removed, rail can outrun our own reporting'
        From = '  const visible = showAll ? shown.length : CAP;'
        To   = '  const visible = shown.length;'
    },
    @{
        Name = 'aria-pressed dropped, active outlet invisible to assistive tech'
        From = '              aria-pressed={outlet === name}'
        To   = '              data-pressed={outlet === name}'
    },
    @{
        Name = 'filter control rendered even for a single outlet'
        From = '      {outlets.length > 1 && ('
        To   = '      {outlets.length > 0 && ('
    }
)

$results = @()
try {
    foreach ($m in $mutations) {
        if (-not $original.Contains($m.From)) { throw "mutation target not found, script is stale: $($m.Name)" }
        Set-Content -LiteralPath $target -Value $original.Replace($m.From, $m.To) -NoNewline
        & npx vitest run $suite --maxWorkers=1 2>&1 | Out-Null
        $results += [pscustomobject]@{
            Mutation = $m.Name
            Result   = if ($LASTEXITCODE -ne 0) { 'CAUGHT' } else { 'SURVIVED' }
        }
        Set-Content -LiteralPath $target -Value $original -NoNewline
    }
}
finally {
    Set-Content -LiteralPath $target -Value $original -NoNewline
}

$results | Format-Table -AutoSize
if ($results.Result -contains 'SURVIVED') {
    Write-Error 'A mutation survived. The rail is not adequately tested.'
    exit 1
}
Write-Host 'All mutations caught.' -ForegroundColor Green

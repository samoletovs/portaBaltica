<#
.SYNOPSIS
  Mutation-checks the newsroom's editorial guards.

.DESCRIPTION
  A passing test suite proves nothing on its own. This script breaks each guard
  deliberately, runs the tests that are supposed to be watching it, and reports
  whether they went red. A mutation that survives means the test is decorative:
  it would let someone delete the guard and still ship green.

  The guards checked here are the ones the published policy in
  newsroom/policy/ai-use.md commits us to in public, plus the fail-closed
  render gate from newsroom/README.md.

  Each mutation is verified to have actually been applied before the tests run.
  A find-string that no longer matches is reported as ERROR, not as CAUGHT —
  otherwise a refactor would silently turn this whole script into a rubber stamp.

.EXAMPLE
  pwsh scripts/mutation-check.ps1
#>

$ErrorActionPreference = 'Stop'

$mutations = @(
  @{
    Name  = 'isServable() always returns true'
    File  = 'src/news-types.ts'
    Find  = "return article.status === 'published' && article.provenance?.validator?.passed === true;"
    Repl  = 'return true;'
    Tests = @('tests/isServable.test.ts', 'tests/articleView.test.tsx', 'tests/newsApi.test.ts')
  },
  @{
    Name  = 'Render gate removed from ArticleView'
    File  = 'src/components/news/ArticleView.tsx'
    Find  = 'if (!isServable(article)) return <NotServable />;'
    Repl  = ''
    Tests = @('tests/articleView.test.tsx')
  },
  @{
    Name  = 'Fail-closed check removed from the article loader'
    File  = 'src/news-api.ts'
    Find  = "if (!isServable(article)) return { state: 'not-servable' };"
    Repl  = ''
    Tests = @('tests/newsApi.test.ts')
  },
  @{
    Name  = 'AI disclosure dropped from the byline'
    File  = 'src/newsroom/correspondents.ts'
    Find  = 'return beat ? `${persona.name} · ${BYLINE_SUFFIX}, ${beat}` : `${persona.name} · ${BYLINE_SUFFIX}`;'
    Repl  = 'return persona.name;'
    Tests = @('tests/policyCommitments.test.tsx', 'tests/correspondents.test.tsx', 'tests/articleView.test.tsx', 'tests/linkOutCard.test.tsx')
  },
  @{
    Name  = 'Stored byline trusted verbatim, disclosure not rebuilt'
    File  = 'src/newsroom/correspondents.ts'
    Find  = 'if (stored && stored.includes(BYLINE_SUFFIX)) return stored;'
    Repl  = 'if (stored) return stored;'
    Tests = @('tests/policyCommitments.test.tsx', 'tests/correspondents.test.tsx', 'tests/articleView.test.tsx')
  },
  @{
    Name  = 'Tier C rendered as one of our own article cards'
    File  = 'src/components/news/NewsCard.tsx'
    Find  = "if (summary.tier === 'C') return <LinkOutCardFromSummary summary={summary} />;"
    Repl  = ''
    Tests = @('tests/linkOutCard.test.tsx', 'tests/newsFeed.test.tsx')
  },
  @{
    Name  = 'Tier C article page renders its body prose'
    File  = 'src/components/news/ArticleView.tsx'
    Find  = "if (article.tier === 'C') {"
    Repl  = 'if (false) {'
    Tests = @('tests/articleView.test.tsx')
  },
  @{
    Name  = 'Provenance panel not rendered'
    File  = 'src/components/news/ArticleView.tsx'
    Find  = '<ProvenanceBlock provenance={article.provenance} />'
    Repl  = ''
    Tests = @('tests/articleView.test.tsx')
  },
  @{
    Name  = 'Correspondent avatar becomes a photographic portrait'
    File  = 'src/components/news/CorrespondentAvatar.tsx'
    Find  = '<rect width="64" height="64" rx="14" fill="#0b1220" />'
    Repl  = '<image href="https://example.com/synthetic-face.jpg" width="64" height="64" />'
    Tests = @('tests/policyCommitments.test.tsx', 'tests/correspondents.test.tsx')
  },
  @{
    Name  = 'Markdown rendered as raw HTML instead of React nodes'
    File  = 'src/newsroom/markdown.tsx'
    Find  = 'return <span key={key}>{part}</span>;'
    Repl  = 'return <span key={key} dangerouslySetInnerHTML={{ __html: part }} />;'
    Tests = @('tests/markdown.test.tsx')
  },
  @{
    Name  = 'Index no longer drops structurally incoherent feed items'
    File  = 'src/news-api.ts'
    Find  = 'const articles = raw.articles.filter(isRenderableSummary);'
    Repl  = 'const articles = raw.articles;'
    Tests = @('tests/newsApi.test.ts')
  }
)

function Invoke-Tests {
  param([string[]] $Tests)
  # Two attempts: this machine intermittently fails to start vitest workers
  # under load, and a startup timeout must not be mistaken for a caught mutation.
  foreach ($attempt in 1..2) {
    $output = & npx vitest run @Tests 2>&1 | Out-String
    if ($output -notmatch 'Failed to start .* worker') {
      return @{ Failed = ($LASTEXITCODE -ne 0); Output = $output }
    }
  }
  return @{ Failed = $false; Output = $output; Infra = $true }
}

$results = @()
# Only unstaged edits to tracked files matter: the script restores each file
# from the copy it read, so a dirty tree would make "restored" ambiguous.
$dirty = (git diff --name-only) -join ''
if ($dirty) { throw 'Tracked files have unstaged edits. Commit or stash before mutation-checking.' }

foreach ($m in $mutations) {
  Write-Host "`n=== $($m.Name) ===" -ForegroundColor Cyan
  $path = $m.File
  $original = Get-Content -Raw -LiteralPath $path

  if (-not $original.Contains($m.Find)) {
    Write-Host '  ERROR: mutation target not found — the guard moved or was renamed.' -ForegroundColor Red
    $results += [pscustomobject]@{ Mutation = $m.Name; Result = 'ERROR (target not found)' }
    continue
  }

  try {
    $mutated = $original.Replace($m.Find, $m.Repl)
    Set-Content -LiteralPath $path -Value $mutated -NoNewline
    $run = Invoke-Tests -Tests $m.Tests
    if ($run.Infra) {
      $verdict = 'INCONCLUSIVE (worker start failed)'
    } elseif ($run.Failed) {
      $verdict = 'CAUGHT'
    } else {
      $verdict = 'SURVIVED'
    }
  } finally {
    Set-Content -LiteralPath $path -Value $original -NoNewline
  }

  $colour = if ($verdict -eq 'CAUGHT') { 'Green' } else { 'Red' }
  Write-Host "  $verdict" -ForegroundColor $colour
  $results += [pscustomobject]@{ Mutation = $m.Name; Result = $verdict }
}

Write-Host "`n`n| Mutation | Result |"
Write-Host '|---|---|'
foreach ($r in $results) { Write-Host "| $($r.Mutation) | $($r.Result) |" }

$survived = @($results | Where-Object { $_.Result -ne 'CAUGHT' })
if ($survived.Count -gt 0) {
  Write-Host "`n$($survived.Count) mutation(s) not caught." -ForegroundColor Red
  exit 1
}
Write-Host "`nAll $($results.Count) mutations caught." -ForegroundColor Green

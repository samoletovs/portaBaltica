<#
.SYNOPSIS
  Verifies a pull request the way this programme has learned it must be verified.

.DESCRIPTION
  Merging on a green CI tick has let real defects through here, at a rate of
  roughly one PR in ten. This script performs the checks that caught them, in a
  fixed order, so they are not retyped ad hoc for each review -- which is both
  slow and how several probe errors got in.

  It answers four questions:

    1. Does the PR record point at the branch tip?
       `gh pr merge` merges the SHA the PR *record* holds. After a force-push,
       or while GitHub's ref sync lags, that is not always where the branch
       points. PR #146 was merged at a stale SHA and silently dropped two
       commits, one of them a truth fault in the newsroom. Nothing anywhere
       said a commit had been skipped.

    2. Does it still merge cleanly onto current master?
       Checked by actually merging, in a throwaway worktree, not by reading
       GitHub's mergeable flag -- which is computed against whatever master was
       when it was last refreshed.

    3. Do the suites pass on the MERGED tree?
       Not on the branch. CI tests the branch; what lands is the merge. Those
       are different trees and only the second one matters.

    4. Did the diff touch anything outside the file set it was given?
       Concurrent sessions are kept apart by exclusive file ownership, and a
       stray edit is how that arrangement fails.

  Three deliberate choices, each from a measured failure:

  * `npm run build` is used for typechecking, never `npx tsc --noEmit`. On this
    project-references setup `tsc --noEmit` exits 0 WITHOUT CHECKING ANYTHING.
  * No step's output is discarded. `| Out-Null` on a failing build and on a
    failing `git checkout` both produced confidently wrong conclusions here.
  * Every reading is printed with the SHA it was taken from. A branch name is a
    moving reference; a SHA is a claim that stays true.

.PARAMETER Number
  The pull request number.

.PARAMETER OwnedPaths
  Optional. Regexes for the paths this PR was given exclusive ownership of.
  Any changed file matching none of them is reported as an ownership breach.

.PARAMETER SkipTests
  Resolve and merge only. Use when you want the SHA and conflict answer fast;
  it does not tell you whether the merged tree is green, so do not merge on it.

.EXAMPLE
  pwsh scripts/verify-pr.ps1 -Number 187

.EXAMPLE
  pwsh scripts/verify-pr.ps1 -Number 187 -OwnedPaths '^src/utils/exportSeries\.ts$','^tests/'
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int] $Number,
  [string[]] $OwnedPaths,
  [switch] $SkipTests
)

$ErrorActionPreference = 'Stop'
$repoRoot = (git rev-parse --show-toplevel)
if ($LASTEXITCODE -ne 0) { throw 'Not inside a git repository.' }

$findings = [System.Collections.Generic.List[object]]::new()
function Add-Finding {
  param([string] $Check, [string] $Verdict, [string] $Detail)
  $findings.Add([pscustomobject]@{ Check = $Check; Verdict = $Verdict; Detail = $Detail })
  $colour = switch ($Verdict) { 'PASS' { 'Green' } 'FAIL' { 'Red' } default { 'Yellow' } }
  Write-Host ("  {0,-6} {1}" -f $Verdict, $Detail) -ForegroundColor $colour
}

# ── 1. resolve the pull request ───────────────────────────────────────────────
Write-Host "`n=== PR #$Number ===" -ForegroundColor Cyan
$pr = gh pr view $Number --json number,title,state,isDraft,headRefName,headRefOid,baseRefName,mergeable,url |
  ConvertFrom-Json
Write-Host "  $($pr.title)"
Write-Host "  $($pr.url)"

if ($pr.isDraft) { Add-Finding 'draft' 'FAIL' 'PR is a draft; this programme does not merge drafts.' }
if ($pr.state -ne 'OPEN') { Add-Finding 'state' 'WARN' "PR state is $($pr.state), not OPEN." }

# ── 2. the stale-head check ───────────────────────────────────────────────────
# `git ls-remote` is the branch's real position. A `git rev-parse` of a ref that
# does not exist locally returns the literal string back -- non-empty and truthy,
# so a `if (-not $x)` guard on it never fires. Hence ls-remote, and hence the
# explicit 40-hex-digit test rather than a truthiness test.
Write-Host "`n--- head SHA ---" -ForegroundColor Cyan
# The @() and the explicit Count test are load-bearing, and BOTH earlier
# attempts at this line were defeated by the same thing they guard against.
#
#   v1  $x = (git ls-remote ...) -split '\s+' | Select-Object -First 1
#       A deleted branch makes git write nothing, so $x is an empty COLLECTION,
#       and `@() -notmatch 'p'` returns `@()` -- which PowerShell treats as
#       $false. The guard against a missing branch was skipped BY the missing
#       branch, and the next clause dereferenced null.
#
#   v2  $x = ([string](...pipeline...)).Trim()
#       A pipeline that emits nothing evaluates to AutomationNull, and casting
#       THAT to [string] yields $null rather than ''. So .Trim() threw, one line
#       earlier than before.
#
# Absence resolved to success twice, in the guard written to stop it. @()
# guarantees an array with a real Count, which is the one form that cannot lie.
$lsOut = @(git ls-remote origin ("refs/heads/" + $pr.headRefName))
$lsRemote = if ($lsOut.Count -gt 0) { ($lsOut[0] -split '\s+')[0].Trim() } else { '' }
$recorded = if ($null -ne $pr.headRefOid) { [string] $pr.headRefOid } else { '' }

if ($lsRemote -notmatch '^[0-9a-f]{40}$') {
  Add-Finding 'head-sha' 'FAIL' "git ls-remote returned '$lsRemote' for refs/heads/$($pr.headRefName) -- not a SHA. The branch may have been deleted."
} elseif ($lsRemote -ne $recorded) {
  Add-Finding 'head-sha' 'FAIL' "PR record holds $($recorded.Substring(0,8)) but the branch is at $($lsRemote.Substring(0,8)). Merging now would land the OLDER tree and say nothing about it. Push an empty commit or retarget until they agree."
} else {
  Add-Finding 'head-sha' 'PASS' "PR record and branch agree at $($recorded.Substring(0,8))."
}

$headSha = if ($lsRemote -match '^[0-9a-f]{40}$') { $lsRemote } else { $recorded }
if ($headSha -notmatch '^[0-9a-f]{40}$') {
  Add-Finding 'head-sha' 'FAIL' 'Neither the branch nor the PR record yields a usable head SHA; nothing can be verified.'
  Write-Host "`n| Check | Verdict | Detail |"; Write-Host '|---|---|---|'
  foreach ($f in $findings) { Write-Host "| $($f.Check) | $($f.Verdict) | $($f.Detail) |" }
  exit 1
}

# ── 3. merge onto current master, in a throwaway worktree ─────────────────────
Write-Host "`n--- merge onto master ---" -ForegroundColor Cyan
git fetch origin master --quiet
# Fetch the head by SHA rather than by branch name: the name may be gone (a
# merged PR whose branch was deleted), and a failed fetch here would otherwise
# abort the run with a message about refs rather than about the PR.
git fetch origin $headSha --quiet 2>&1 | Out-Host
$baseSha = (git rev-parse origin/master)
Write-Host "  base  origin/master $($baseSha.Substring(0,8))"
Write-Host "  head  $($pr.headRefName) $($headSha.Substring(0,8))"

$wt = Join-Path ([System.IO.Path]::GetTempPath()) "pb-verify-$Number-$(Get-Random)"
$merged = $false
$linkedModules = $null
try {
  git worktree add --detach $wt $baseSha
  if ($LASTEXITCODE -ne 0) { throw "could not create worktree at $wt" }

  Push-Location $wt
  try {
    git -c user.name=verify -c user.email=verify@local merge --no-ff --no-edit $headSha
    if ($LASTEXITCODE -ne 0) {
      $conflicts = (git diff --name-only --diff-filter=U) -join ', '
      Add-Finding 'merge' 'FAIL' "Merge conflicts against master $($baseSha.Substring(0,8)): $conflicts"
    } else {
      $merged = $true
      $mergeSha = (git rev-parse HEAD)
      Add-Finding 'merge' 'PASS' "Merges cleanly; merged tree is $($mergeSha.Substring(0,8))."

      # ── 4. what did it change? ────────────────────────────────────────────
      $changed = @(git diff --name-only "$baseSha...$headSha")
      Write-Host "`n--- $($changed.Count) changed file(s) ---" -ForegroundColor Cyan
      $changed | ForEach-Object { Write-Host "  $_" }

      if ($OwnedPaths) {
        $stray = @($changed | Where-Object {
          $f = $_; -not ($OwnedPaths | Where-Object { $f -match $_ })
        })
        if ($stray.Count -gt 0) {
          Add-Finding 'ownership' 'FAIL' "Touched $($stray.Count) file(s) outside its owned set: $($stray -join ', ')"
        } else {
          Add-Finding 'ownership' 'PASS' "All $($changed.Count) changed file(s) are within the owned set."
        }
      }

      $codeChanged = @($changed | Where-Object { $_ -notmatch '\.md$' })
      if ($codeChanged.Count -eq 0) {
        Add-Finding 'behaviour' 'WARN' 'Markdown-only PR: it changes no behaviour. Check it is not a no-op restatement of an issue.'
      }

      # ── 5. the suites, on the MERGED tree ─────────────────────────────────
      if (-not $SkipTests) {
        # A fresh worktree has no node_modules. Reuse the repo's rather than
        # reinstalling: this is the same commit range and the same lockfile.
        #
        # The junction MUST be torn down before `git worktree remove --force`,
        # and this is not a tidiness point -- it is the difference between a
        # link and its target. Measured directly rather than assumed, because
        # the first hypothesis was wrong:
        #
        #   Remove-Item -Recurse -Force over a dir holding a junction
        #                                       -> target SURVIVED (3 of 3 files)
        #   git worktree remove --force         -> target DESTROYED (0 of 3)
        #
        # So it is git that walks through the reparse point, not PowerShell.
        # This script did exactly that to this repository: after a verification
        # run the repo's own node_modules held one entry, no .bin, no
        # typescript and no vitest, and `npm run build` then failed with
        # "'tsc' is not recognized" -- which reads as a broken toolchain rather
        # than as something the tool had just done to itself.
        # `cmd /c rmdir` removes the reparse point only and never follows it.
        $srcModules = Join-Path $repoRoot 'node_modules'
        $linkPath = Join-Path $wt 'node_modules'
        if (Test-Path $srcModules) {
          cmd /c mklink /J "$linkPath" "$srcModules" | Out-Host
          $linkedModules = $linkPath
        } else {
          Write-Host '  no node_modules to reuse; installing' -ForegroundColor Yellow
          npm ci
        }

        foreach ($step in @(
          @{ Name = 'build'; Cmd = { npm run build } },
          @{ Name = 'test';  Cmd = { npm run test } },
          @{ Name = 'lint';  Cmd = { npm run lint } }
        )) {
          Write-Host "`n--- npm run $($step.Name) (on the merged tree) ---" -ForegroundColor Cyan
          # Output is deliberately NOT suppressed: a failure you cannot read is
          # a failure you will explain away.
          & $step.Cmd
          if ($LASTEXITCODE -eq 0) {
            Add-Finding $step.Name 'PASS' "npm run $($step.Name) exited 0 on merged tree."
          } else {
            Add-Finding $step.Name 'FAIL' "npm run $($step.Name) exited $LASTEXITCODE on merged tree."
          }
        }
      } else {
        Add-Finding 'suites' 'WARN' '-SkipTests was passed; the merged tree is unverified. Do not merge on this run.'
      }
    }
  } finally {
    Pop-Location
  }
} finally {
  # Order matters and is load-bearing: drop the junction FIRST, then remove the
  # worktree. Reversed, `git worktree remove --force` walks through the link
  # and empties the repository's real node_modules -- measured, 3 files to 0.
  # See the comment where the junction is created.
  if ($linkedModules -and (Test-Path $linkedModules)) {
    cmd /c rmdir "$linkedModules" | Out-Host
    if (Test-Path (Join-Path $linkedModules 'vitest')) {
      Write-Host "  WARNING: $linkedModules still resolves; not removing the worktree." -ForegroundColor Red
      Write-Host '  Delete it by hand rather than risk the repository node_modules.' -ForegroundColor Red
      exit 1
    }
  }
  git worktree remove --force $wt 2>&1 | Out-Host
}

# ── verdict ───────────────────────────────────────────────────────────────────
Write-Host "`n`n| Check | Verdict | Detail |"
Write-Host '|---|---|---|'
foreach ($f in $findings) { Write-Host "| $($f.Check) | $($f.Verdict) | $($f.Detail) |" }

Write-Host "`nmeasured against master $($baseSha.Substring(0,8)) and head $($headSha.Substring(0,8)) at $((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mmZ'))"

$failed = @($findings | Where-Object { $_.Verdict -eq 'FAIL' })
if ($failed.Count -gt 0) {
  Write-Host "$($failed.Count) check(s) failed. Do not merge." -ForegroundColor Red
  exit 1
}
if (-not $merged) { exit 1 }
Write-Host 'All checks passed.' -ForegroundColor Green

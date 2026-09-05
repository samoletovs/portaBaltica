// @vitest-environment node
/**
 * Guards deploy concurrency and the uploaded-versus-live-verified contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * The `push` run is the only thing that deploys production. Merging a PR fires
 * a `push` to master and a `pull_request: closed` in the same second, and while
 * the concurrency group was keyed on the ref alone those two runs evicted each
 * other. On 2026-08-24 the push run lost twice, cancelled 2 and 3 seconds after
 * creation, before a single job started:
 *
 *   7b180bd (#18)  created 13:36:11  cancelled 13:36:13
 *   e5aae8f (#22)  created 13:58:32  cancelled 13:58:35
 *
 * Both merges looked completely green — PR merged, checks passed, commit on
 * master — while production kept serving the previous build. A cancelled run is
 * not a failed one, so nothing turned red. That is the whole danger: the
 * pipeline dropped a deploy and reported success.
 *
 * These tests do not check that deploys work. They check that the two
 * properties which make a dropped deploy impossible are still in place, because
 * both are one careless edit away from being reverted to a setting that looks
 * tidier and silently loses releases.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

const WORKFLOW = resolve(__dirname, '..', '.github', 'workflows', 'deploy.yml');
const workflow = readFileSync(WORKFLOW, 'utf-8');

/** The top-level `concurrency:` block, excluding any nested job-level one. */
function concurrencyBlock(): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => /^concurrency:/.test(line));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.trim() !== '' && !/^\s/.test(line));
  return rest.slice(0, end === -1 ? rest.length : end).join('\n');
}

/** The lines of one `- name: <step>` step, up to the next step at its indent. */
function stepBlock(name: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) return '';
  const indent = lines[start].search(/\S/);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(
    (line) => line.trim() !== '' && line.search(/\S/) <= indent,
  );
  return [lines[start], ...rest.slice(0, end === -1 ? rest.length : end)].join('\n');
}

type Outcome = 'success' | 'failure' | 'skipped' | 'cancelled';

interface DeploymentContext {
  event?: string;
  deploy: Outcome;
  smoke: Outcome;
  failed?: boolean;
}

/** These workflow conditions use only the shared JS/Actions boolean subset. */
function conditionMatches(name: string, {
  event = 'push', deploy, smoke, failed = false,
}: DeploymentContext): boolean {
  const condition = /^\s*if:\s*(.+)$/m.exec(stepBlock(name))?.[1]?.trim();
  if (!condition) throw new Error(`Missing condition for ${name}`);
  // Actions implicitly adds success() unless a status function is present.
  if (failed && !/\b(always|success|failure|cancelled)\s*\(/.test(condition)) return false;
  const result: unknown = runInNewContext(condition, {
    github: { event_name: event },
    steps: { deploy: { outcome: deploy }, smoke: { outcome: smoke } },
    always: () => true,
    success: () => !failed,
    failure: () => failed,
  });
  return result === true;
}

function runStep(name: string, env: Record<string, string> = {}) {
  const script = /\brun:\s*\|\r?\n([\s\S]*)/.exec(stepBlock(name))?.[1];
  if (!script) throw new Error(`Missing shell block for ${name}`);
  const bash = process.platform === 'win32'
    ? resolve(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe')
    : 'bash';
  // Exercise the actual workflow shell; curl captures arguments, never sends.
  const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c',
    `curl() { printf '%s\\n' "$@"; }\n${script.replace(/\$\{\{[^}]+}}/g, 'test-context')}`,
  ], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      NAURO_BOT_TOKEN: 'test-token',
      NAURO_CHAT_ID: 'test-chat',
      COMMIT_MESSAGE: 'test change',
      RUN_URL: 'https://github.com/example/repo/actions/runs/123',
      ...env,
    },
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe('deploy workflow concurrency', () => {
  it('declares a top-level concurrency block', () => {
    // Without one, simultaneous deploys race into Azure SWA and it rejects the
    // loser with "Deployment Canceled".
    expect(concurrencyBlock()).not.toBe('');
  });

  it('never cancels an in-progress push run', () => {
    // `cancel-in-progress: true` applied to pushes is what discarded #18 and
    // #22. Pushes must queue instead, so every merged commit reaches
    // production. Cancelling pull request runs is still fine and is where the
    // Actions minutes are actually saved.
    const cancel = /cancel-in-progress:\s*(.+)/.exec(concurrencyBlock())?.[1]?.trim();
    expect(cancel, 'deploy.yml has no cancel-in-progress setting').toBeDefined();
    expect(
      cancel,
      'cancel-in-progress must exclude pushes, or a merge can silently skip its production deploy',
    ).not.toBe('true');
    expect(cancel).toContain("github.event_name != 'push'");
  });

  it('separates push and pull_request runs into different concurrency groups', () => {
    // Merging fires both events at once. Keyed on the ref alone they contend
    // for one group, and the push run — the deploying one — can lose.
    const group = /group:\s*(.+)/.exec(concurrencyBlock())?.[1]?.trim();
    expect(group, 'deploy.yml has no concurrency group').toBeDefined();
    expect(
      group,
      'the group must include github.event_name so a merge cannot evict its own deploy',
    ).toContain('github.event_name');
  });
});

describe('deploy workflow deploy path', () => {
  it('still deploys only on push, not on pull_request', () => {
    // The guarantee above is only worth anything if push remains the event
    // that ships production.
    expect(workflow).toContain("if: github.event_name == 'push'");
  });

  it('keeps the production deploy gated on the quality job', () => {
    // Documented here because it has a sharp edge: `needs: quality` means one
    // lint error blocks every deploy, not just its own run. That is the right
    // trade, but it is why a red master must be treated as an outage.
    expect(workflow).toMatch(/needs:\s*quality/);
  });

  it('never uploads to Azure SWA on a pull_request', () => {
    // An upload on a pull_request does not touch production: Azure creates a
    // staging environment per PR, and the Free tier allows three. Once three
    // were live every further PR run failed with "This Static Web App already
    // has the maximum number of staging environments", which no change under
    // review can fix. The step must stay push-only.
    const step = stepBlock('Deploy to Azure SWA');
    expect(step, 'deploy.yml has no "Deploy to Azure SWA" step').not.toBe('');
    const condition = /^\s*if:\s*(.+)$/m.exec(step)?.[1]?.trim();
    expect(
      condition,
      'the SWA upload step must be push-gated, or open PRs exhaust the Free tier staging quota',
    ).toBe("github.event_name == 'push'");
  });
});

describe('the live smoke step', () => {
  /**
   * A live check that cannot run must not report a pass.
   *
   * `reducedMotionLayout.live.test.ts` has existed since #109 and had **never
   * executed on a runner**: playwright is a devDependency but the browser
   * binary is not, no workflow installed it, and the test's own
   * `catch { console.warn(...); return; }` turned that into a pass. Measured by
   * pointing `PLAYWRIGHT_BROWSERS_PATH` at an empty directory — the two
   * browser-based live files report `Tests 2 passed` in **1.4 seconds**,
   * against **188 seconds** when a browser is actually there.
   *
   * So it reported a pass on every deploy while a 196px sideways scroll sat on
   * production at every phone width — the exact defect it was written to
   * catch.
   *
   * `tests/liveBrowser.ts` now throws instead of skipping whenever `CI` is
   * set. This asserts the other half: that the runner is given a browser, so
   * the new failure is a real signal rather than a permanent red.
   */
  it('installs a browser before running the live suite', () => {
    const install = workflow.indexOf('playwright install');
    const smoke = workflow.indexOf('npm run test:live');

    expect(install, 'no step installs a browser, so the browser-based live checks cannot run').toBeGreaterThan(-1);
    expect(smoke, 'no step runs the live suite').toBeGreaterThan(-1);
    expect(install, 'the browser must be installed before the suite runs, not after').toBeLessThan(smoke);
  });

  describe('uploaded versus live-verified deployment', () => {
    const gate = 'Fail unverified deployment';
    const receipt = 'Notify Telegram (success)';
    const failure = 'Notify Telegram (failure)';

    it('preserves the existing jobs and cadence', () => {
      const jobs = workflow.slice(workflow.indexOf('\njobs:'));
      expect([...jobs.matchAll(/^ {2}(\w+):\s*$/gm)].map((match) => match[1]))
        .toEqual(['quality', 'build_and_deploy', 'close_pull_request']);
      expect(workflow).not.toMatch(/^\s+schedule:/m);
    });

    it('defers smoke failure only until reporting, then enforces it last', () => {
      expect(stepBlock('Deploy to Azure SWA')).toMatch(/^\s+id: deploy$/m);
      expect(stepBlock('Live smoke tests')).toMatch(/^\s+id: smoke$/m);
      expect(stepBlock('Live smoke tests')).toMatch(/^\s+continue-on-error: true$/m);
      expect(stepBlock(gate)).not.toMatch(/continue-on-error:/);
      const deployJob = workflow.slice(workflow.indexOf('\n  build_and_deploy:'), workflow.indexOf('\n  close_pull_request:'));
      const names = [...deployJob.matchAll(/^ {6}- name: (.+)$/gm)].map((match) => match[1]);
      expect(names.at(-1)).toBe(gate);
      for (const name of ['Live smoke tests', 'Report smoke result', receipt, failure]) {
        expect(names.indexOf(name)).toBeGreaterThan(-1);
        expect(names.indexOf(name)).toBeLessThan(names.indexOf(gate));
      }
    });

    it.each([
      ['success', 'success', false, false],
      ['success', 'failure', false, true], // continue-on-error keeps success() true.
      ['success', 'failure', true, true],
      ['success', 'skipped', true, true], // e.g. browser installation failed.
      ['success', 'skipped', false, true],
      ['success', 'cancelled', true, true],
      ['failure', 'skipped', true, false],
      ['skipped', 'skipped', true, false],
      ['skipped', 'skipped', false, false],
      ['cancelled', 'skipped', false, false],
    ] as const)('upload=%s, smoke=%s, prior failure=%s => verification failure=%s',
      (deploy, smoke, failed, mustFail) => {
        const context = { deploy, smoke, failed };
        expect(conditionMatches(gate, context)).toBe(mustFail);
        expect(conditionMatches('Report smoke result', context)).toBe(deploy === 'success');
        expect(conditionMatches(receipt, context)).toBe(deploy === 'success');
        expect(conditionMatches(failure, context)).toBe(failed && deploy !== 'success');
      });

    it.each(['pull_request', 'workflow_run', 'workflow_dispatch'])(
      'does not report or fail a non-push event (%s)', (event) => {
        for (const name of [gate, 'Report smoke result', receipt, failure]) {
          expect(conditionMatches(name, { event, deploy: 'success', smoke: 'failure', failed: true })).toBe(false);
        }
      });

    it('exits nonzero after notification even when continue-on-error masked the failed suite', () => {
      const context = { deploy: 'success', smoke: 'failure', failed: false } as const;
      expect(conditionMatches(receipt, context)).toBe(true);
      expect(conditionMatches(failure, context)).toBe(false);
      expect(conditionMatches(gate, context)).toBe(true);
      const result = runStep(gate);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('::error::Live verification failed; inspect failed assertions');
      expect(result.stdout).toContain('no rollback was performed');
    });

    it.each(['success', 'failure', 'skipped'])('reports the actual %s smoke outcome in the uploaded receipt', (outcome) => {
      const result = runStep(receipt, { SMOKE_OUTCOME: outcome });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('disable_web_page_preview=true');
      if (outcome === 'success') {
        expect(result.stdout).toContain('✅ <b>portaBaltica</b> deployed');
        expect(result.stdout).not.toContain('LIVE CHECKS FAILED');
      } else {
        expect(result.stdout).toContain('⚠️ <b>portaBaltica</b> deployed — LIVE CHECKS FAILED');
        expect(result.stdout).toContain('Live verification failed; inspect failed assertions');
        expect(result.stdout).toContain('Run: https://github.com/example/repo/actions/runs/123');
        expect(result.stdout).not.toContain('deploy FAILED');
      }
      expect(result.stdout).not.toContain('something it depends on');
    });

    it('keeps the upload-failure receipt distinct and disables its link preview too', () => {
      const result = runStep(failure);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('❌ <b>portaBaltica</b> deploy FAILED');
      expect(result.stdout).toContain('disable_web_page_preview=true');
    });

    it('does not misdiagnose UI assertion failures as dependency outages in the summary', () => {
      expect(stepBlock('Report smoke result')).toContain('Live verification failed; inspect failed assertions');
      expect(workflow).not.toMatch(/something it depends on/i);
    });
  });

  it('installs the same browser the checks ask for', () => {
    // `playwright install` with no browser named downloads all three, which is
    // slow and still leaves the wrong one if a check later asks for firefox.
    expect(workflow).toMatch(/playwright install[^\n]*\bchromium\b/);
  });
});

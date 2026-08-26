/**
 * Guards the deploy workflow's concurrency settings.
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
import { resolve } from 'node:path';

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

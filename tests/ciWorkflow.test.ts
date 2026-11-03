// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflow = readFileSync(resolve(__dirname, '../.github/workflows/ci.yml'), 'utf8');
const code = workflow.replace(/^\s*#.*$/gm, '');

describe('CI workflow', () => {
  it('validates every push and pull request without branch or path filters', () => {
    expect(code).toMatch(/^on: \[push, pull_request\]$/m);
    expect(code).not.toMatch(/^\s*(?:if|branches|branches-ignore|paths|paths-ignore):/m);
  });

  it('installs locked dependencies before testing and building', () => {
    const commands = [...code.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1]);
    expect(commands).toEqual(['npm ci', 'npm test', 'npm run build']);
    expect(code).toMatch(/uses: actions\/checkout@/);
    expect(code).toMatch(/uses: actions\/setup-node@/);
    expect(code).toMatch(/node-version: '22'/);
  });

  it('needs no write permissions, secrets, or deployment action', () => {
    expect(code).toMatch(/^permissions:\s*\n\s+contents: read$/m);
    expect(code).not.toMatch(/secrets\.|static-web-apps-deploy|pull_request_target|write/);
  });
});

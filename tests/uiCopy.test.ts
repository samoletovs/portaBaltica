import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EM_DASH, GENERATED_TELLS, checkUiCopy, visibleStrings } from '../src/newsroom/ui-copy';

/**
 * House style applies to the site's own words too.
 *
 * We enforce sentence case, en dashes and a plain register on every article,
 * and then wrote the pages around them in exactly the register we reject:
 * em dashes in almost every paragraph, and the same construction three times
 * on one screen. A reader does not know which words came from the pipeline and
 * which from a component, and should not have to.
 *
 * This test reads the shipped components and fails on the tells. It is
 * deliberately not a lint rule about code — it looks at strings a reader can
 * actually see, and ignores comments, class names and identifiers.
 */

const NEWS_DIR = join(process.cwd(), 'src', 'components', 'news');

function componentFiles(): string[] {
  return readdirSync(NEWS_DIR).filter((name) => name.endsWith('.tsx'));
}

describe('the site writes the way it asks articles to write', () => {
  it('has components to check', () => {
    // Guard the guard: an empty list would make everything below pass.
    expect(componentFiles().length).toBeGreaterThan(10);
  });

  it.each(componentFiles())('%s uses no em dashes in reader-visible copy', (file) => {
    const source = readFileSync(join(NEWS_DIR, file), 'utf8');

    const offenders = visibleStrings(source).filter((text) => text.includes(EM_DASH));

    expect(offenders, `${file} has em dashes a reader can see`).toEqual([]);
  });

  it.each(componentFiles())('%s avoids the generated register', (file) => {
    const source = readFileSync(join(NEWS_DIR, file), 'utf8');

    const problems = checkUiCopy(visibleStrings(source));

    expect(problems, `${file}: ${problems.join('; ')}`).toEqual([]);
  });
});

describe('visibleStrings', () => {
  it('ignores comments, which are not reader-visible', () => {
    const source = `
      // a comment with an em dash \u2014 here
      /* a block comment \u2014 here */
      export function X() { return <p>clean copy</p>; }
    `;

    expect(visibleStrings(source).join(' ')).not.toContain(EM_DASH);
  });

  it('finds text inside JSX', () => {
    const source = 'export function X() { return <p>Their reporting, not ours.</p>; }';

    expect(visibleStrings(source).join(' ')).toContain('Their reporting, not ours.');
  });

  it('finds text inside quoted strings', () => {
    const source = `const title = 'Corrections | portaBaltica';`;

    expect(visibleStrings(source).join(' ')).toContain('Corrections | portaBaltica');
  });

  it('ignores class names and import paths, which are not prose', () => {
    const source = `
      import { X } from '../../newsroom/thing';
      const c = "news-border news-panel mt-4 rounded-lg";
    `;
    const visible = visibleStrings(source).join(' ');

    expect(visible).not.toContain('newsroom/thing');
    expect(visible).not.toContain('rounded-lg');
  });
});

describe('checkUiCopy', () => {
  it('catches the register we reject in articles', () => {
    for (const tell of GENERATED_TELLS.slice(0, 4)) {
      expect(checkUiCopy([`Something ${tell} something.`]).length).toBeGreaterThan(0);
    }
  });

  it('passes plain copy', () => {
    expect(
      checkUiCopy([
        'Their reporting, not ours. We would rather you read it on their site.',
        'Five AI correspondents, one AI editor, and one accountable human.',
      ]),
    ).toEqual([]);
  });
});

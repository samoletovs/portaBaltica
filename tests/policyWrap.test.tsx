import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Markdown } from '../src/newsroom/markdown';
import { parseMarkdown } from '../src/newsroom/markdown-parse';

/**
 * ─── A rigid token in a policy document must be able to break ───
 *
 * `/corrections` scrolled 42px sideways at 320px. `corrections.md` line 51
 * links with the label `github.com/samoletovs/portaBaltica/issues` — 41
 * characters, and a URL offers a line break nowhere — inside a `LINK_CLASS`
 * that did not permit breaking. It pushed the sentence after it past the
 * viewport, on the one page a reader reaches when they already think we have
 * got something wrong.
 *
 * Third instance of one mechanism: #151's chart legend, #166's `/api-docs`
 * query strings, and now a repository URL. Each was fixed where it was found.
 *
 * **So this tests the property, not the instance.** Shortening that one label
 * would take the symptom away and leave the defect: the next long path someone
 * writes into a policy is the same bug again. What is asserted is that the
 * elements carrying author-supplied text can give way, and that no rigid token
 * in either published document sits somewhere that cannot.
 *
 * jsdom does not lay out, so it cannot measure the overflow — the live check in
 * `reducedMotionLayout.live.test.ts` does that. This holds the structure that
 * makes the overflow impossible, which is the half that can be tested here and
 * the half that survives a copy edit.
 */

const BREAKS = /break-words|break-all/;

/** Every published policy document, read from the authoritative source. */
const POLICIES = ['ai-use.md', 'corrections.md'].map((name) => ({
  name,
  source: readFileSync(resolve('newsroom/policy', name), 'utf8'),
}));

function renderMarkdown(source: string) {
  return render(
    <MemoryRouter>
      <Markdown source={source} />
    </MemoryRouter>,
  );
}

/**
 * The element that actually owns a token: the deepest one containing it, since
 * every ancestor contains it too and only the innermost carries the class that
 * decides whether it breaks.
 */
function ownerOf(container: HTMLElement, token: string): Element | null {
  const holders = [...container.querySelectorAll('*')].filter((el) =>
    (el.textContent ?? '').includes(token),
  );
  return holders.length === 0 ? null : holders[holders.length - 1];
}

/** True if the token can break here or at any ancestor up to the container. */
function canBreak(container: HTMLElement, token: string): boolean {
  let el = ownerOf(container, token);
  while (el && el !== container) {
    if (BREAKS.test(el.className)) return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Every run of text as the reader meets it, one text node at a time.
 *
 * Not `container.textContent`: that concatenates across element boundaries with
 * no separator, so the end of one paragraph and the start of the next read as a
 * single word. The first run of this scan reported
 * `corrected.ClarificationThe` — three fragments from three separate blocks,
 * a 26-character token that appears nowhere on screen and could not overflow
 * anything. A line break is a property of one run of text, so the scan has to
 * look at one run of text.
 */
function textRuns(container: HTMLElement): { text: string; element: Element }[] {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const runs: { text: string; element: Element }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (element && node.nodeValue) runs.push({ text: node.nodeValue, element });
  }
  return runs;
}

/** True if this element or an ancestor up to the container permits breaking. */
function breaksAt(container: HTMLElement, start: Element): boolean {
  let el: Element | null = start;
  while (el && el !== container) {
    if (BREAKS.test(el.className)) return true;
    el = el.parentElement;
  }
  return false;
}

describe('the renderer lets author-supplied text give way', () => {
  /**
   * A positive control, and the reason this suite cannot go vacuous.
   *
   * The scan below only checks tokens the documents happen to contain today. If
   * someone shortens the offending label the scan finds nothing and passes
   * whether or not the renderer was reverted. These two hold regardless of what
   * the policies say, so the guard survives a copy edit.
   */
  it('lets a link label that is one long token break', () => {
    const { container } = renderMarkdown(
      'Open an issue at [github.com/samoletovs/portaBaltica/issues](https://example.org/issues).',
    );

    expect(
      canBreak(container, 'github.com/samoletovs/portaBaltica/issues'),
      'a 41-character link label with no break opportunity cannot give way',
    ).toBe(true);
  });

  it('lets inline code that is one long path break', () => {
    // 21 characters today in `ai-use.md`, which fits. One edit from being the
    // next offender, and it is the same defect with a different element.
    const { container } = renderMarkdown('Sources are declared in `newsroom/sources.yaml`.');

    expect(
      canBreak(container, 'newsroom/sources.yaml'),
      'a long path in inline code cannot give way',
    ).toBe(true);
  });

  it('does not chop ordinary prose mid-word', () => {
    // `break-words` rather than `break-all`: it breaks a word only when the word
    // cannot fit, so running prose still breaks at spaces. `break-all` is right
    // for the mono query strings of #166 and wrong for a sentence.
    const { container } = renderMarkdown('Corrections are published in a log.');

    const paragraph = container.querySelector('p');
    expect(paragraph, 'expected a paragraph').not.toBeNull();
    expect(paragraph!.className, 'prose must not be set to break-all').not.toMatch(/break-all/);
  });
});

describe('no rigid token in a published policy sits where it cannot break', () => {
  /**
   * A token with no space and no hyphen offers a line break nowhere, so its
   * width is a floor on the line it sits in.
   *
   * 24 characters is below the only measured offender (41, which overflowed a
   * 320px viewport by 42px, so that line fits roughly 32) and above every
   * incidental prose token in either document — the longest being
   * `**Clarification**` at 17. A token between the two is a near miss worth
   * hearing about before it is a defect.
   */
  const RIGID = /[^\s\-\u2013\u2014]{24,}/g;

  it.each(POLICIES)('$name parses, so the scan below is looking at something', ({ source }) => {
    // Without this the scan is indistinguishable from a parser that returned
    // nothing: an assertion that no token is misplaced needs a companion
    // proving tokens could have been found.
    expect(parseMarkdown(source).length, 'the document parsed to no blocks').toBeGreaterThan(0);
  });

  it.each(POLICIES)('$name puts every rigid token somewhere it can break', ({ source }) => {
    const { container } = renderMarkdown(source);

    // Read the tokens off each rendered run of text rather than the markdown,
    // so the syntax around a link or emphasis is not mistaken for part of a
    // word, and rather than off the whole container, so two adjacent blocks are
    // not mistaken for one.
    const trapped = textRuns(container)
      .flatMap(({ text, element }) => (text.match(RIGID) ?? []).map((token) => ({ token, element })))
      .filter(({ element }) => !breaksAt(container, element))
      .map(({ token }) => token);

    expect([...new Set(trapped)], 'these cannot break and will push the page sideways').toEqual([]);
  });
});

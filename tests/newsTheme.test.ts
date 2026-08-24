import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/index.css'), 'utf8');

function tokenBlock(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Theme block ${selector} was not found`);

  return Object.fromEntries(
    [...match[1].matchAll(/(--(?:bg-page|news-[\w-]+)):\s*(#[0-9a-f]{6})/gi)].map(
      ([, name, value]) => [name, value],
    ),
  );
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g);
  if (!channels) throw new Error(`Invalid colour ${hex}`);

  const [r, g, b] = channels.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const bodyPairings = [
  ['--news-fg', '--bg-page'],
  ['--news-muted', '--bg-page'],
  ['--news-subtle', '--bg-page'],
  ['--news-accent', '--bg-page'],
  ['--news-fg', '--news-panel'],
  ['--news-muted', '--news-panel'],
  ['--news-subtle', '--news-panel'],
  ['--news-accent', '--news-panel'],
  ['--news-accent', '--news-panel-muted'],
  ['--news-fg', '--news-panel-muted'],
  ['--news-muted', '--news-panel-muted'],
  ['--news-fg', '--news-accent-panel'],
  ['--news-muted', '--news-accent-panel'],
  ['--news-subtle', '--news-accent-panel'],
  ['--news-accent', '--news-accent-panel'],
  ['--news-warning', '--news-warning-panel'],
  ['--news-warning', '--bg-page'],
  ['--news-accent', '--news-warning-panel'],
  ['--news-positive', '--news-panel'],
  ['--news-negative', '--news-panel'],
] as const;

describe('editorial theme contrast', () => {
  it.each([
    ['dark', ':root'],
    ['light', '[data-theme="light"]'],
  ])('%s theme meets WCAG AA for every editorial body-text pairing', (_theme, selector) => {
    const tokens = tokenBlock(selector);

    for (const [foreground, background] of bodyPairings) {
      expect(
        contrast(tokens[foreground], tokens[background]),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps raw palette utilities out of editorial surfaces', () => {
    const newsDirectory = resolve('src/components/news');
    const sources = readdirSync(newsDirectory)
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => readFileSync(join(newsDirectory, file), 'utf8'))
      .concat(readFileSync(resolve('src/newsroom/markdown.tsx'), 'utf8'));

    expect(sources.join('\n')).not.toMatch(
      /(?:text|bg|border|decoration|outline)-(?:slate|white|ocean|amber|emerald|red)-/,
    );
  });
});

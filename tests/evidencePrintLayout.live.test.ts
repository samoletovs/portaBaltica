import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';
import { EVIDENCE_SELECTION, EVIDENCE_SERIES } from '../src/evidence-types';

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';
const SNAPSHOT = '1234567890abcdef1234567890abcdef';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const normalized = JSON.stringify({
  format_version: 1,
  series_id: EVIDENCE_SERIES,
  dataset: 'une_rt_m',
  selection: EVIDENCE_SELECTION,
  start_period: '2020-01',
  source_updated_at: '2026-01-20T12:00:00Z',
  rows: ['EE', 'LV', 'LT'].flatMap(geo =>
    Array.from({ length: 24 }, (_, month) => ({
      geo, period: `${2024 + Math.floor(month / 12)}-${String(month % 12 + 1).padStart(2, '0')}`,
      value: 6.123456789, status: 'p', missing: false,
    })),
  ),
});
const manifest = {
  format_version: 1,
  series_id: EVIDENCE_SERIES,
  snapshot_id: SNAPSHOT,
  status: 'complete',
  created_at: '2026-01-21T12:00:00Z',
  provenance: {
    request_url: 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?freq=M&s_adj=SA&age=TOTAL&sex=T&unit=PC_ACT&geo=EE&geo=LV&geo=LT',
    retrieved_at: '2026-01-21T12:00:00Z',
    sha256: digest('{}'),
    http_status: 200,
  },
  artifacts: {
    'normalized.json': { sha256: digest(normalized) },
    'observations.csv': { sha256: digest('') },
    'dictionary.json': { sha256: digest('{}') },
  },
  row_count: 72,
  missing_count: 0,
  flagged_count: 72,
  attribution: 'Eurostat. Synthetic layout fixture, not a published source capture.',
  modifications: 'Twenty-four monthly coordinates per country for print layout checks.',
  disclaimer: 'These synthetic observations are not reporting evidence.',
};

describe('frozen evidence prints as a readable document', () => {
  it.each(['light', 'dark'])('%s screen preference does not clip or obscure printed evidence', async theme => {
    const browser = await launchForLiveCheck();
    if (!browser) return;
    try {
      const page = await browser.newPage({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce' });
      await page.addInitScript(value => localStorage.setItem('pb-theme', value), theme);
      await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Print fixture' } }));
      await page.route('**/articles/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith(`/snapshots/${SNAPSHOT}/manifest.json`)) return route.fulfill({ json: manifest });
        if (path.endsWith(`/snapshots/${SNAPSHOT}/normalized.json`)) {
          return route.fulfill({ contentType: 'application/json', body: normalized });
        }
        return route.fulfill({ status: 404 });
      });
      const response = await page.goto(`${BASE}/evidence/${SNAPSHOT}`);
      expect(response?.status()).toBe(200);
      await page.locator('.evidence-table tbody tr').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.locator('.evidence-table tbody tr').count()).toBe(12);
      const originalDisclosures = await page.locator('.evidence-page details').evaluateAll(nodes =>
        nodes.map(node => (node as HTMLDetailsElement).open),
      );
      expect(originalDisclosures.some(open => !open)).toBe(true);
      const screenColour = await page.locator('.evidence-table').first().evaluate(node => getComputedStyle(node).color);

      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      await page.emulateMedia({ media: 'print' });
      await expect.poll(() => page.locator('.evidence-table').first().evaluate(table => ({
        print: matchMedia('print').matches,
        colour: getComputedStyle(table).color,
        background: getComputedStyle(document.body).backgroundColor,
      }))).toEqual({ print: true, colour: 'rgb(23, 45, 50)', background: 'rgb(255, 255, 255)' });
      const printed = await page.locator('.evidence-table').first().evaluate(table => {
        const wrapper = table.closest('.evidence-scroll')!;
        const sheet = table.closest('.evidence-page')!;
        const css = getComputedStyle(table);
        return {
          colour: css.color,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          overflow: getComputedStyle(wrapper).overflowX,
          tableLayout: css.tableLayout,
          sheetPadding: getComputedStyle(sheet).padding,
          headerDisplay: getComputedStyle(table.querySelector('thead')!).display,
          rowBreak: getComputedStyle(table.querySelector('tbody tr')!).breakInside,
          clipped: table.getBoundingClientRect().right > wrapper.getBoundingClientRect().right + 1,
          pageOverflow: document.documentElement.scrollWidth > innerWidth,
          cellMinimums: Array.from(table.querySelectorAll('th, td')).map(cell => getComputedStyle(cell).minWidth),
        };
      });
      expect(printed.colour).toBe('rgb(23, 45, 50)');
      expect(printed.bodyBackground).toBe('rgb(255, 255, 255)');
      expect(printed.overflow).toBe('visible');
      expect(printed.tableLayout).toBe('fixed');
      expect(printed.sheetPadding).toBe('0px');
      expect(printed.headerDisplay).toBe('table-header-group');
      expect(printed.rowBreak).toBe('avoid');
      expect(printed.clipped).toBe(false);
      expect(printed.pageOverflow).toBe(false);
      expect(printed.cellMinimums.length).toBeGreaterThan(0);
      expect(printed.cellMinimums.every(value => value === '0px')).toBe(true);
      expect(await page.locator('.desk-masthead').isVisible()).toBe(false);
      expect(await page.locator('.evidence-table tbody tr').count()).toBe(24);
      expect(await page.locator('.evidence-page details').evaluateAll(nodes =>
        nodes.every(node => (node as HTMLDetailsElement).open),
      )).toBe(true);
      const screenControls = await page.locator('.evidence-screen-only').evaluateAll(nodes =>
        nodes.map(node => getComputedStyle(node).display),
      );
      expect(screenControls.length).toBeGreaterThan(0);
      expect(screenControls.every(display => display === 'none')).toBe(true);
      const printedLinks = await page.locator('.evidence-page a.site-action').evaluateAll(nodes =>
        nodes.filter(node => getComputedStyle(node).display !== 'none').map(node => ({
          colour: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor,
        })),
      );
      expect(printedLinks.length).toBeGreaterThan(0);
      expect(printedLinks.every(link => link.colour === 'rgb(23, 45, 50)' && link.background === 'rgb(255, 255, 255)')).toBe(true);
      expect(await page.locator('.evidence-page button').evaluateAll(nodes =>
        nodes.every(node => getComputedStyle(node).display === 'none'),
      )).toBe(true);

      await page.emulateMedia({ media: 'screen' });
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await expect.poll(() => page.locator('.evidence-table').first().evaluate(node => getComputedStyle(node).color)).toBe(screenColour);
      expect(await page.locator('.desk-masthead').isVisible()).toBe(true);
      expect(await page.locator('.evidence-table tbody tr').count()).toBe(12);
      expect(await page.locator('.evidence-page details').evaluateAll(nodes =>
        nodes.map(node => (node as HTMLDetailsElement).open),
      )).toEqual(originalDisclosures);
    } finally {
      await browser.close();
    }
  });
});

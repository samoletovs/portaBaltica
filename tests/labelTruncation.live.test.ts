import { describe, expect, it } from 'vitest';
import { launchForLiveCheck } from './liveBrowser';

/**
 * Does the dashboard's key-indicator table still say what it is measuring at
 * 320px?
 *
 * ─── The defect this guards ───
 *
 * The row is a grid, and the title cell held two flex items: the indicator
 * name and its unit. The unit carried `shrink-0`, so it took its full width
 * and the name absorbed the entire shortfall. Measured in Chromium against a
 * production build at 320px, on master `ebf7c4f`:
 *
 *     GDP Growth Rate         108px needed,  52px given  ->  "GDP G…"
 *     Hourly labour cost      114px needed,  39px given  ->  "Hou…"
 *     HICP Inflation           85px needed,  58px given  ->  "HICP In…"
 *     Unemployment Rate       127px needed,  80px given  ->  "Unemploy…"
 *     House Price Change      124px needed,  58px given  ->  "House …"
 *     Retail sales growth     115px needed,  58px given  ->  "Retail s…"
 *     Industrial production   129px needed,  48px given  ->  "Indus…"
 *     Population               66px needed,  48px given  ->  "Popul…"
 *
 * Eight of eight, the worst showing a third of its name — on the table the
 * component's own comment calls the most prominent on the site.
 *
 * ─── Why nothing caught it ───
 *
 * Two reasons, and both generalise.
 *
 * The document does not scroll: measured at 320px across seven dashboard
 * routes, `maxScrollLeft` is 0 everywhere. The cut is absorbed by
 * `overflow-hidden` on the cell, so `reducedMotionLayout.live.test.ts` — which
 * measures the document, and per-element only where `overflow-x` is
 * `auto|scroll` — is right to pass it. An element wider than its container and
 * a document that scrolls sideways are different defects, and this repo only
 * measured the second.
 *
 * And the cut is *announced*: `truncate` renders an ellipsis, so it looks like
 * a treatment. DESIGN.md §4.7 has the prior question — what is on the other
 * side of the cut? Here it removed the name of the indicator and kept a unit
 * the value column two cells away mostly repeats (`EUR/hour` renders as
 * `€16.3/h`). That is the `/follow` case again: no treatment of the edge helps
 * when the hidden part is the informative part.
 *
 * The component had already been measured at 320px once, and the comment
 * recording that sizes the *column* to 98px. It never reached the span inside
 * it — so a reader who goes to check finds a correct 320px measurement and
 * stops looking. AGENTS.md calls that the correct sibling that conceals the
 * broken one.
 *
 * ─── What this measures ───
 *
 * Three ways the name can fail to be readable, kept apart because they have
 * different causes and different fixes:
 *
 *   ellipsised  `scrollWidth > clientWidth` — the truncate case
 *   spilling    a rendered line reaches past the cell's content box
 *   clipped     the cell scrolls vertically, or a line sits below its floor
 *
 * Neither signal is sufficient alone, and that is not defensive. Once the
 * title wraps it is an inline box, and an inline box reports `scrollWidth` and
 * `clientWidth` both **zero** — so the ellipsis check becomes a check that
 * cannot fail, in exactly the state the fix produces. Geometry answers the
 * wrapped case; `scrollWidth` answers the truncated one. Written with either
 * alone this file would report a pass for one of the two layouts without ever
 * looking at it.
 *
 * The vertical check is not decoration either: the cell keeps
 * `overflow-hidden`, so a title that wrapped taller than its row would be cut
 * on the other axis, which would be a worse defect than the one being fixed.
 */

const BASE = process.env.PB_BASE_URL ?? 'https://portabaltica.naurolabs.com';

/** The narrowest device, and the width at which every title was cut. */
const NARROW = 320;

describe('the key indicator table at 320px', () => {
  it('renders every indicator name in full', async () => {
    // Skips locally without a browser; throws in CI, where a skip would be the
    // runner reporting a pass for a check it never ran. See `liveBrowser.ts`.
    const browser = await launchForLiveCheck();
    if (!browser) return;

    try {
      const context = await browser.newContext({
        viewport: { width: NARROW, height: 900 },
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        // Without this the onboarding overlay is up on a first visit, and the
        // check measures a page behind a modal rather than the dashboard.
        localStorage.setItem('pb-onboarding-complete', 'true');
      });
      await page.goto(BASE + '/data', { waitUntil: 'domcontentloaded', timeout: 30_000 });
      // Headless overlay scrollbars otherwise give the label more room than a
      // normal browser window. Include the scrollbar gutter in this 320px check.
      await page.addStyleTag({ content: 'html { scrollbar-gutter: stable; }' });
      // The table renders from a fetch; an empty table cannot have a cut label,
      // so measuring too early would pass for the wrong reason. The row count
      // is asserted below, which is what makes that a failure rather than a
      // silent pass.
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll('h3')].some((h) =>
            (h.textContent ?? '').trim().endsWith('key indicators'),
          ) && document.querySelectorAll('button[aria-label^="View "]').length > 0,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(900);

      const measured = await page.evaluate(() => {
        // Scoped to the key-indicator table, which is the surface that was
        // measured and fixed. A bare `button[aria-label^="View "]` matches 34
        // controls across several components — the cards use the same
        // accessible-name pattern — so it would be a guard walking a wider
        // population than its own claim, with a control landing on whichever
        // component happened to render first.
        const panel = [...document.querySelectorAll<HTMLElement>('h3')]
          .find((h) => (h.textContent ?? '').trim().endsWith('key indicators'))
          ?.closest('div.dash-card') as HTMLElement | undefined;

        // Addressed through the accessible name, not through a class list. The
        // row announces `View <title> details`, so the expected text comes from
        // the page itself — a probe keyed on `span.truncate` would report zero
        // rows the moment the truncation is removed, which is the reading it is
        // least able to interpret.
        const rows = panel
          ? [...panel.querySelectorAll<HTMLElement>('button[aria-label^="View "]')].filter((b) =>
              (b.getAttribute('aria-label') ?? '').endsWith(' details'),
            )
          : [];

        /** The deepest element holding exactly this text — every ancestor holds it too. */
        const owner = (row: HTMLElement, title: string) => {
          const holders = [...row.querySelectorAll<HTMLElement>('*')].filter(
            (el) => (el.textContent ?? '').trim() === title,
          );
          return holders.length ? holders[holders.length - 1] : null;
        };

        /** How far past its containing box any rendered line of this element reaches. */
        const reach = (el: HTMLElement, box: HTMLElement) => {
          const rect = box.getBoundingClientRect();
          const cs = getComputedStyle(box);
          const right = rect.right - parseFloat(cs.paddingRight || '0');
          const bottom = rect.bottom - parseFloat(cs.paddingBottom || '0');
          const range = document.createRange();
          range.selectNodeContents(el);
          let overRight = 0;
          let overBottom = 0;
          let lines = 0;
          for (const r of range.getClientRects()) {
            if (r.width === 0) continue;
            lines++;
            overRight = Math.max(overRight, r.right - right);
            overBottom = Math.max(overBottom, r.bottom - bottom);
          }
          return { overRight: Math.round(overRight), overBottom: Math.round(overBottom), lines };
        };

        // The box that has to contain the name is its own parent — the title
        // cell. Resolved from the element rather than as "the row's first
        // child", which is only true of this one layout.
        const verdict = (el: HTMLElement) => {
          const box = el.parentElement as HTMLElement;
          const { overRight, overBottom, lines } = reach(el, box);
          return {
            ellipsised: el.scrollWidth > el.clientWidth + 1,
            spilling: overRight > 1,
            clipped: box.scrollHeight > box.clientHeight + 1 || overBottom > 1,
            lines,
            overRight,
          };
        };

        const cut: string[] = [];
        const seen: string[] = [];
        for (const row of rows) {
          const label = row.getAttribute('aria-label') ?? '';
          const title = label.slice('View '.length, -' details'.length);
          const el = owner(row, title);
          if (!el) {
            cut.push(`${title}: no element renders this name`);
            continue;
          }
          seen.push(title);
          const v = verdict(el);
          if (v.ellipsised || v.spilling || v.clipped) {
            cut.push(
              `${title}: ${[
                v.ellipsised ? `ellipsised (${el.scrollWidth}/${el.clientWidth})` : '',
                v.spilling ? `spills ${v.overRight}px past its cell` : '',
                v.clipped ? 'clipped vertically' : '',
              ]
                .filter(Boolean)
                .join(', ')}`,
            );
          }
        }

        // ─── Controls, on the object under test ───
        //
        // "No name is cut" is an absence, and an absence is a claim about the
        // instrument before it is a claim about the page. Three parts:
        //
        //   positive   squeeze the real title into 24px — the probe must say cut
        //   negative   a clone of it, given room — the probe must say clean
        //   restore    the verdict returns to what it was before the squeeze
        //
        // The negative half is a clone rather than the element itself, and that
        // is not fastidiousness: in the *defective* layout the real element is
        // genuinely cut, so "it reads clean once I put the style back" can never
        // hold there. A control that only passes when the page is already
        // correct would turn every real finding into a broken-probe report.
        let controlDetected: boolean | null = null;
        let controlCleanWhenRoomy: boolean | null = null;
        let controlRestored: boolean | null = null;
        const firstLabel = rows[0]?.getAttribute('aria-label') ?? '';
        const first = rows[0]
          ? owner(rows[0], firstLabel.slice('View '.length, -' details'.length))
          : null;
        if (first) {
          const pristine = JSON.stringify(verdict(first));

          const before = first.getAttribute('style');
          first.setAttribute(
            'style',
            'display:block;width:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
          );
          const squeezed = verdict(first);
          controlDetected = squeezed.ellipsised || squeezed.spilling;
          if (before === null) first.removeAttribute('style');
          else first.setAttribute('style', before);
          controlRestored = JSON.stringify(verdict(first)) === pristine;

          const host = document.createElement('div');
          host.style.cssText = 'width:600px';
          const clone = first.cloneNode(true) as HTMLElement;
          host.appendChild(clone);
          document.body.appendChild(host);
          const roomy = verdict(clone);
          controlCleanWhenRoomy = !(roomy.ellipsised || roomy.spilling || roomy.clipped);
          host.remove();
        }

        return {
          cut,
          seen,
          rowCount: rows.length,
          foundPanel: Boolean(panel),
          controlDetected,
          controlCleanWhenRoomy,
          controlRestored,
        };
      });

      await context.close();

      // An empty table cannot have a cut label. Without these the whole check
      // passes when the API is down or the panel is renamed, which is the state
      // it is least able to report on.
      expect(measured.foundPanel, 'no "key indicators" panel on /data — the probe found nothing to measure').toBe(true);
      expect(
        measured.rowCount,
        'no indicator rows rendered, so "no name is cut" is a claim about the fetch',
      ).toBeGreaterThan(0);
      expect(measured.seen.length, 'a row rendered whose name no element carries').toBe(
        measured.rowCount,
      );

      expect(
        measured.controlDetected,
        'the probe did not report a name squeezed into 24px — it would not have seen a real cut either',
      ).toBe(true);
      expect(
        measured.controlCleanWhenRoomy,
        'the probe reports a cut on a copy of the same name given 600px, so it cannot say no',
      ).toBe(true);
      expect(
        measured.controlRestored,
        'the squeeze was not undone before the page was measured',
      ).toBe(true);

      expect(
        measured.cut,
        'an indicator name is cut at 320px. The name is what the number is *of*, and ' +
          'the unit beside it is mostly repeated by the value column — so this is the ' +
          'informative half being removed to keep the redundant one (DESIGN.md §4.7).',
      ).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 120_000);
});

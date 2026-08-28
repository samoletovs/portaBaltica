import { useState } from 'react';
import {
  exportFilename,
  toCsv,
  toJson,
  type SeriesExport,
} from '../utils/exportSeries';

/**
 * The download control, on an open-data portal that had none.
 *
 * **Two buttons rather than a popup menu**, despite the file name. A menu of
 * two items costs a roving tabindex, an Escape handler, an outside-click
 * listener and focus return to the trigger — four places to be subtly
 * inaccessible in exchange for hiding one word. Two buttons are keyboard
 * operable with no code at all, land on the site's global `:focus-visible`
 * ring, and reach the file in one keystroke instead of two. Nothing about the
 * feature wanted a menu; the menu was just the first shape that came to mind.
 *
 * It is deliberately quiet. This is a utility beside a chart, not a call to
 * action: caption type, the control surface every other dashboard button uses,
 * and no accent colour — the accent is reserved for links and the primary
 * action (DESIGN.md §1.5), and a download is neither.
 *
 * Focus is not styled here. `:focus-visible` is applied once, globally, and a
 * per-component opt-in is exactly how the dashboard previously ended up with no
 * focus indicator at all.
 */

/** `text/csv` per RFC 4180 §3; `charset` because a unit may carry a €. */
const CSV_TYPE = 'text/csv;charset=utf-8';
const JSON_TYPE = 'application/json;charset=utf-8';

/**
 * The byte order mark, added to the CSV here and never in `toCsv`.
 *
 * Excel on Windows reads a UTF-8 CSV as the system code page unless the file
 * opens with a BOM, so `°C` arrives as `Â°C` and a euro sign as `â‚¬`. The mark
 * is not part of RFC 4180 and would make `toCsv` return something a strict
 * parser sees a stray character in, so it belongs to the act of writing a file
 * rather than to the act of formatting one.
 */
const BOM = '\uFEFF';

/**
 * Hand a string to the browser as a file.
 *
 * Returns whether it managed it. `URL.createObjectURL` is absent in jsdom and
 * in any environment without a Blob URL store, and a control that throws on
 * click is worse than one that reports it could not.
 *
 * Not exported: a file that exports both a component and a helper breaks React
 * Fast Refresh, and eslint's `react-refresh/only-export-components` says so.
 * It is reached through the component in `tests/downloadMenu.test.tsx`, which
 * is the only way it is reached in production either.
 */
function downloadText(filename: string, type: string, text: string): boolean {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;

  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    // Not appended to the document: a detached anchor still activates, and
    // appending one briefly puts an element in the page that a screen reader
    // may announce and a layout may reflow around.
    anchor.click();
    return true;
  } finally {
    // Revoked on the next frame rather than immediately. Safari has been
    // observed to cancel the download when the URL is released inside the same
    // task as the click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

interface DownloadMenuProps {
  /**
   * What to write out, already assembled. `null` while the series is loading,
   * which renders nothing rather than a control that would produce an empty
   * file.
   */
  data: SeriesExport | null;
  /** Placement only. The control's own styling is not the caller's business. */
  className?: string;
}

export function DownloadMenu({ data, className = '' }: DownloadMenuProps) {
  /**
   * What to announce, and nothing else about the control's state.
   *
   * This used to be a `failed` boolean that mounted a `<span role="status">`
   * at the moment it had something to say. That is the arrangement a live
   * region is least likely to be announced in: assistive technology watches a
   * region for *changes*, and a region inserted together with its text is
   * frequently missed because there was nothing there to change.
   *
   * Measured on `/indicator/gdp`: pressing Enter on the CSV button downloads
   * the file, changes no visible content, leaves focus on the button, and left
   * `[role="status"]` **absent from the group entirely** — so a screen-reader
   * user pressing the control heard nothing at all, success or failure. WCAG
   * 2.2 SC 4.1.3 (AA) exists for exactly this: a status message has to be
   * programmatically determinable without taking focus.
   *
   * So the region is now permanent and only its text changes.
   */
  const [status, setStatus] = useState<{ text: string; failed: boolean } | null>(null);

  const observations = data?.series.reduce((total, one) => total + one.observations.length, 0) ?? 0;
  if (!data || observations === 0) return null;

  const write = (extension: 'csv' | 'json') => {
    const text =
      extension === 'csv' ? BOM + toCsv(data) : toJson(data);
    const type = extension === 'csv' ? CSV_TYPE : JSON_TYPE;
    const ok = downloadText(exportFilename(data, extension), type, text);
    setStatus(
      ok
        ? { text: `${data.title} downloaded as ${extension.toUpperCase()}.`, failed: false }
        : { text: 'Download is not available in this browser.', failed: true },
    );
  };

  return (
    <div
      className={`inline-flex flex-wrap items-center gap-1 ${className}`.trim()}
      role="group"
      aria-label={`Download ${data.title}`}
    >
      <span className="text-caption dash-subtle" aria-hidden="true">
        Download
      </span>
      {(['csv', 'json'] as const).map((extension) => (
        <button
          key={extension}
          type="button"
          onClick={() => write(extension)}
          // The visible label is the format alone, which is all the row has
          // room for. The accessible name names the series as well, because a
          // screen reader user arriving at "CSV" by tabbing has no way to tell
          // which of the four charts on this page it belongs to.
          aria-label={`Download ${data.title} as ${extension.toUpperCase()}`}
          className="dash-btn dash-body border dash-edge rounded-lg px-2 text-caption transition-colors"
        >
          {extension.toUpperCase()}
        </button>
      ))}
      {/* Always mounted, so there is a region to change. Success is announced
          without being shown — the file arriving is its own visible feedback
          for a sighted reader, and a permanent confirmation line in a dense
          control row would be noise. A failure is shown as well as announced,
          because nothing else on screen reports it. */}
      <span
        role="status"
        className={
          status?.failed ? 'text-caption dash-warning' : 'sr-only'
        }
      >
        {status?.text ?? ''}
      </span>
    </div>
  );
}

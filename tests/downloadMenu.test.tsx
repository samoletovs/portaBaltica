import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DownloadMenu } from '../src/components/DownloadMenu';
import { toCsv, type SeriesExport } from '../src/utils/exportSeries';

/**
 * The download control.
 *
 * Two things are being checked and they are different questions. One is that
 * the control produces the right file. The other is that a reader who does not
 * use a mouse can reach it at all — which on this site is not a hypothetical:
 * `design-system.test.ts` records that sixteen newsroom components carried a
 * focus class and no dashboard component had any, so every indicator card was
 * a `<button>` nobody could see the focus on.
 *
 * The keyboard assertion is deliberately structural as well as behavioural.
 * `fireEvent.click` passes just as happily on a `<div onClick>`, which is the
 * shape that is *not* keyboard operable, so a test that only clicks cannot tell
 * the two apart.
 */

function example(overrides: Partial<SeriesExport> = {}): SeriesExport {
  return {
    indicator: 'gdp',
    title: 'GDP growth rate',
    unit: '% change',
    source: 'Eurostat (namq_10_gdp)',
    dataset: 'namq_10_gdp',
    retrievedAt: '2026-08-28T11:59:00.000Z',
    exportedAt: '2026-08-28T12:00:00.000Z',
    series: [
      {
        label: 'Latvia',
        observations: [
          { period: '2025-Q1', value: 1.4 },
          { period: '2025-Q2', value: null },
        ],
      },
    ],
    ...overrides,
  };
}

/** Everything the component handed to the browser, in order. */
interface Written {
  blob: Blob;
  filename: string;
}

let written: Written[] = [];
let clickSpy: ReturnType<typeof vi.spyOn>;
let revoked: string[] = [];

beforeEach(() => {
  written = [];
  revoked = [];
  let next = 0;

  const blobs = new Map<string, Blob>();
  // jsdom implements neither of these, so a control that calls them without a
  // guard throws on click. Stubbed rather than shimmed globally, so the guard
  // in `downloadText` is still reachable by the test below that removes them.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:test/${(next += 1)}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  });

  clickSpy = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      const blob = blobs.get(this.getAttribute('href') ?? '');
      if (blob) written.push({ blob, filename: this.download });
    });
});

afterEach(() => {
  clickSpy.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function textOf(blob: Blob): Promise<string> {
  return await blob.text();
}

/**
 * The blob's raw bytes.
 *
 * `Blob.text()` runs UTF-8 *decode*, which by the Encoding Standard sniffs and
 * removes a leading byte order mark — so it reports a BOM-prefixed file and a
 * bare one identically, and the first version of the assertion below read a
 * correctly written BOM as absent. The bytes are the only place the question
 * can actually be asked.
 */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('the accessible name', () => {
  it('names the series as well as the format', () => {
    // A screen reader user arriving at "CSV" by tabbing has no way to tell
    // which of the charts on the page it belongs to. The visible label is the
    // format alone because that is all the row has room for.
    render(<DownloadMenu data={example()} />);

    expect(screen.getByRole('button', { name: 'Download GDP growth rate as CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download GDP growth rate as JSON' })).toBeTruthy();
  });

  it('groups the two formats under one name', () => {
    render(<DownloadMenu data={example()} />);

    const group = screen.getByRole('group', { name: 'Download GDP growth rate' });
    expect(group.querySelectorAll('button')).toHaveLength(2);
  });

  it('does not read the decorative label out a second time', () => {
    // "Download" is already in every accessible name in the group, so the
    // visible word beside them is duplication to a screen reader.
    render(<DownloadMenu data={example()} />);

    const label = screen.getByText('Download');
    expect(label.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('keyboard operation', () => {
  it('offers native buttons, which is what makes Enter and Space work', () => {
    // The structural half. `fireEvent.click` below would pass on a
    // `<div onClick>` too, and that shape is the one a keyboard cannot reach.
    render(<DownloadMenu data={example()} />);

    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
      // Without `type="button"` a control inside a form submits it instead.
      expect(button.getAttribute('type')).toBe('button');
      // Nothing may take it out of the tab order.
      expect(button.getAttribute('tabindex')).toBeNull();
      expect(button.hasAttribute('disabled')).toBe(false);
    }
  });

  it('writes the file when the focused button is activated', () => {
    render(<DownloadMenu data={example()} />);

    const csv = screen.getByRole('button', { name: 'Download GDP growth rate as CSV' });
    csv.focus();
    expect(document.activeElement).toBe(csv);

    // What a browser synthesises from Enter or Space on a focused button.
    fireEvent.click(csv);

    expect(written).toHaveLength(1);
  });

  it('styles no focus ring of its own', () => {
    // Focus is applied once, globally, by `:focus-visible`. A per-component
    // opt-in is how the dashboard ended up with no focus indicator at all, and
    // `design-system.test.ts` fails on the class this used to be.
    render(<DownloadMenu data={example()} />);

    for (const button of screen.getAllByRole('button')) {
      expect(button.className).not.toMatch(/news-focus|outline-none/);
    }
  });
});

describe('what it writes', () => {
  it('hands over the CSV the formatter produced, under a name that identifies it', async () => {
    render(<DownloadMenu data={example()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as CSV' }));

    expect(written).toHaveLength(1);
    expect(written[0].filename).toBe('portabaltica-gdp-2026-08-28.csv');
    expect(written[0].blob.type).toBe('text/csv;charset=utf-8');

    const text = await textOf(written[0].blob);
    // The byte order mark is added here and never in `toCsv`: Excel on Windows
    // needs it to read UTF-8, and a strict parser does not want it. Asserted on
    // the bytes, because `Blob.text()` strips it during UTF-8 decode.
    expect([...(await bytesOf(written[0].blob)).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toBe(toCsv(example()));
    expect(text).toContain('Source: Eurostat (namq_10_gdp)');
    // The absent reading survives the round trip as an empty field.
    expect(text).toContain('2025-Q2,\r\n');
  });

  it('writes no byte order mark on the JSON, where it would break a parser', async () => {
    // The companion to the assertion above: without it, that one passes on an
    // implementation that prefixes every file, and `JSON.parse` rejects a
    // leading BOM in Node.
    render(<DownloadMenu data={example()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as JSON' }));

    expect([...(await bytesOf(written[0].blob)).slice(0, 1)]).toEqual([0x7b]);
  });

  it('hands over JSON carrying the unit and the source', async () => {
    render(<DownloadMenu data={example()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as JSON' }));

    expect(written[0].filename).toBe('portabaltica-gdp-2026-08-28.json');
    expect(written[0].blob.type).toBe('application/json;charset=utf-8');

    const parsed = JSON.parse(await textOf(written[0].blob));
    expect(parsed.unit).toBe('% change');
    expect(parsed.source).toBe('Eurostat (namq_10_gdp)');
    expect(parsed.series[0].observations[1].value).toBeNull();
  });

  it('releases the object URL once the click has been handled', () => {
    vi.useFakeTimers();
    render(<DownloadMenu data={example()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as CSV' }));
    expect(revoked, 'released too early, which cancels the download in Safari').toEqual([]);

    vi.runAllTimers();
    expect(revoked).toHaveLength(1);
  });
});

describe('when there is nothing to write', () => {
  it('renders no control while the series is still loading', () => {
    const { container } = render(<DownloadMenu data={null} />);

    expect(container.innerHTML).toBe('');
  });

  it('renders no control for a series with no observations', () => {
    // A button that produces a file with a header and no rows is worse than an
    // absent button: the reader believes they have the data.
    const { container } = render(
      <DownloadMenu data={example({ series: [{ label: 'Latvia', observations: [] }] })} />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders the control when there is a single observation', () => {
    // The companion assertion: without it, the two above pass on a component
    // that renders nothing at all.
    render(
      <DownloadMenu
        data={example({ series: [{ label: 'Latvia', observations: [{ period: '2025-Q1', value: 1 }] }] })}
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});

describe('when the browser cannot save a file', () => {
  it('says so rather than appearing to have worked', () => {
    // `URL.createObjectURL` is absent in some embedded webviews. A control that
    // silently does nothing is indistinguishable from a slow one.
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined });

    render(<DownloadMenu data={example()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as CSV' }));

    expect(screen.getByRole('status').textContent).toMatch(/not available/i);
  });

  it('does not claim a failure on a browser that can', () => {
    render(<DownloadMenu data={example()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as CSV' }));

    expect(screen.getByRole('status').textContent).not.toMatch(/not available/i);
  });
});

describe('what a screen reader hears', () => {
  // Measured on `/indicator/gdp` in Chromium before this existed: pressing
  // Enter on the CSV button downloaded the file, changed no visible content,
  // left focus on the button, and left `[role="status"]` absent from the group
  // entirely — so the control reported nothing at all, success or failure.
  // WCAG 2.2 SC 4.1.3 (AA) is exactly this case.

  it('keeps the live region mounted before it has anything to say', () => {
    // The previous version rendered the region *with* its message. Assistive
    // technology watches a live region for changes, and a region inserted
    // together with its text is frequently missed, because there was nothing
    // there to change. So the region has to exist from the first render — and
    // that is the assertion, not the message.
    render(<DownloadMenu data={example()} />);

    expect(screen.getByRole('status')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('announces the download, naming the series and the format', () => {
    render(<DownloadMenu data={example()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as JSON' }));

    // Named rather than "Downloaded.", because a page carrying four charts
    // gives four identical confirmations otherwise.
    expect(screen.getByRole('status').textContent).toBe('GDP growth rate downloaded as JSON.');
  });

  it('announces success without showing it', () => {
    // The file arriving is its own feedback for a sighted reader, and a
    // permanent confirmation line in a dense control row is noise. A failure
    // is shown as well as announced, because nothing else on screen reports
    // one — so the two states must not share a presentation.
    render(<DownloadMenu data={example()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as CSV' }));
    const onSuccess = screen.getByRole('status').className;

    cleanup();
    vi.stubGlobal('URL', { ...URL, createObjectURL: undefined });
    render(<DownloadMenu data={example()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download GDP growth rate as CSV' }));
    const onFailure = screen.getByRole('status').className;

    expect(onSuccess).toContain('sr-only');
    expect(onFailure).not.toContain('sr-only');
  });
});

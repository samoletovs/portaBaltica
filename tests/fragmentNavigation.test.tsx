import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ScrollToTop } from '../src/components/ScrollToTop';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('cross-route evidence links', () => {
  it('waits for an asynchronous anchor, then focuses before measuring its scroll position', async () => {
    const scroll = vi.fn();
    const focus = vi.fn();
    const { rerender } = render(<MemoryRouter initialEntries={['/article/a#article-evidence']}><ScrollToTop /></MemoryRouter>);
    await act(async () => {
      rerender(<MemoryRouter initialEntries={['/article/a#article-evidence']}><ScrollToTop />
        <div id="article-evidence" tabIndex={-1} ref={el => { if (el) { el.scrollIntoView = scroll; el.focus = focus; } }} />
      </MemoryRouter>);
    });
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(scroll.mock.invocationCallOrder[0]);
  });

  it('disconnects an unfinished jump when the route helper unmounts', async () => {
    const scroll = vi.fn();
    const view = render(<MemoryRouter initialEntries={['/article/a#article-evidence']}><ScrollToTop /></MemoryRouter>);
    view.unmount();
    await act(async () => {
      render(<div id="article-evidence" ref={el => { if (el) el.scrollIntoView = scroll; }} />);
    });
    expect(scroll).not.toHaveBeenCalled();
  });
});

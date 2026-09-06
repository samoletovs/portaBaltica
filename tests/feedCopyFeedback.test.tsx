import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FollowPage from '../src/components/news/FollowPage';

vi.mock('../src/news-api', () => ({
  fetchArticleIndex: async () => ({ articles: [] }),
}));

async function mount(clipboard?: { writeText: (value: string) => Promise<void> }) {
  vi.stubGlobal('navigator', { clipboard });
  render(<MemoryRouter><FollowPage /></MemoryRouter>);
  await act(async () => {});
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('feed copying feedback', () => {
  it.each([
    ['RSS', '/rss.xml', 0],
    ['JSON Feed', '/feed.json', 1],
  ] as const)('names the %s control and announces the exact feed copied', async (name, path, index) => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();
    await mount({ writeText });
    const status = screen.getAllByRole('status')[index];
    expect(status.textContent).toBe('');
    const button = screen.getByRole('button', { name: `Copy ${name} URL` });
    await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${path}`);
    expect(status.textContent).toBe(`${name} URL copied.`);
    expect(screen.getAllByRole('status')[index]).toBe(status);
    expect(button.textContent).toBe('Copied');
    expect(screen.getAllByRole('status')[1 - index].textContent).toBe('');
  });

  it('explains clipboard denial beside the URL and permits retry', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce();
    await mount({ writeText });
    const status = screen.getAllByRole('status')[0];
    const button = screen.getByRole('button', { name: 'Copy RSS URL' });
    await act(async () => { fireEvent.click(button); });
    expect(status.textContent).toContain('Select the RSS URL above and copy it manually.');
    expect(status.classList.contains('sr-only')).toBe(false);
    expect(screen.getByText(`${window.location.origin}/rss.xml`).getAttribute('href')).toBe('/rss.xml');
    expect(button.hasAttribute('disabled')).toBe(false);

    await act(async () => { fireEvent.click(button); });
    expect(status.textContent).toBe('RSS URL copied.');
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('keeps manual-copy instructions and selectable URLs when the API is unavailable', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: /Copy .* URL/ })).toBeNull();
    const statuses = screen.getAllByRole('status');
    expect(statuses[0].textContent).toContain('Select the RSS URL above');
    expect(statuses[1].textContent).toContain('Select the JSON Feed URL above');
    for (const path of ['/rss.xml', '/feed.json']) {
      expect(screen.getByText(`${window.location.origin}${path}`).getAttribute('href')).toBe(path);
    }
  });

  it('handles synchronous clipboard exceptions without losing manual-copy guidance', async () => {
    await mount({ writeText: () => { throw new Error('Clipboard unavailable'); } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy JSON Feed URL' }));
    });
    expect(screen.getAllByRole('status')[1].textContent).toContain('Select the JSON Feed URL above');
    expect(screen.getAllByRole('status')[1].classList.contains('sr-only')).toBe(false);
  });

  it('disables another copy while the clipboard permission request is pending', async () => {
    let resolve!: () => void;
    const writeText = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    await mount({ writeText });
    const button = screen.getByRole('button', { name: 'Copy RSS URL' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByRole('status')[0].textContent).toBe('Copying RSS URL…');
    expect(writeText).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(); });
    expect(button.hasAttribute('disabled')).toBe(false);
  });
});

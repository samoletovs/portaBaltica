import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FeedbackForm } from '../src/components/FeedbackForm';

const fetcher = vi.fn<typeof fetch>();
const id = '485b4dad-b281-4a69-aab5-612ef5ab76ad';

beforeEach(() => {
  fetcher.mockReset().mockImplementation(async (_url, options) => {
    const body = JSON.parse(String(options?.body)) as { id: string };
    return Response.json({ ok: true, id: body.id }, { status: 202 });
  });
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fill() {
  fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'Very useful breakdown.' } });
}
async function send() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send feedback' })); });
}

describe('private article feedback', () => {
  it('announces only a matching saved receipt and states retention before submission', async () => {
    render(<FeedbackForm slug="test-article" />);
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.getByText(/scheduled for deletion after 90 days/)).toBeTruthy();
    fill();
    fireEvent.change(screen.getByLabelText('Contact (optional)'), { target: { value: 'reader@example.test' } });
    await send();
    expect(screen.getByRole('status').textContent).toContain(`feedback was saved. Reference: ${id}`);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe('/api/article-feedback');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      id, slug: 'test-article', kind: 'comment', message: 'Very useful breakdown.', contact: 'reader@example.test',
    });
    expect((screen.getByLabelText('Your feedback') as HTMLTextAreaElement).value).toBe('');
  });

  it.each([200, 400, 429, 503])('keeps text and never reports success for HTTP %i', async status => {
    fetcher.mockResolvedValue(Response.json({ ok: true, id }, { status }));
    render(<FeedbackForm slug="test-article" />);
    fill();
    await send();
    expect(screen.getByRole('alert').textContent).toContain('Could not confirm');
    expect((screen.getByLabelText('Your feedback') as HTMLTextAreaElement).value).toBe('Very useful breakdown.');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('rejects a 202 receipt belonging to another submission', async () => {
    fetcher.mockResolvedValue(Response.json({ ok: true, id: 'another' }, { status: 202 }));
    render(<FeedbackForm slug="test-article" />);
    fill();
    await send();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('reuses the same reference after an uncertain failure', async () => {
    fetcher.mockRejectedValueOnce(new Error('connection lost'));
    render(<FeedbackForm slug="test-article" />);
    fill();
    await send();
    await send();
    expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).id)).toEqual([id, id]);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it('prevents editing a draft while it is being sent', async () => {
    let finish!: (response: Response) => void;
    fetcher.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(<FeedbackForm slug="test-article" />);
    fill();
    await send();
    expect(screen.getByLabelText('Your feedback').closest('fieldset')?.disabled).toBe(true);
    await act(async () => { finish(Response.json({ ok: true, id }, { status: 202 })); });
    expect(screen.getByLabelText('Your feedback').closest('fieldset')?.disabled).toBe(false);
  });

  it('uses a new reference when the reader changes a failed submission', async () => {
    const nextId = 'f7aee7a3-c245-4cde-88c1-d7a8fe353bdb';
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(id).mockReturnValueOnce(nextId);
    fetcher.mockRejectedValueOnce(new Error('connection lost'));
    render(<FeedbackForm slug="test-article" />);
    fill();
    await send();
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'A different question.' } });
    await send();
    expect(fetcher.mock.calls.map(([, options]) => JSON.parse(String(options?.body)).id)).toEqual([id, nextId]);
    expect(screen.getByRole('status').textContent).toContain(nextId);
  });

  it('does not carry a draft or response into a different article', async () => {
    const view = render(<FeedbackForm slug="first-article" />);
    fill();
    view.rerender(<FeedbackForm slug="second-article" />);
    expect((screen.getByLabelText('Your feedback') as HTMLTextAreaElement).value).toBe('');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('ignores a late receipt after navigating to another article', async () => {
    let finish!: (response: Response) => void;
    fetcher.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<FeedbackForm slug="first-article" />);
    fill();
    await send();
    view.rerender(<FeedbackForm slug="second-article" />);
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'Keep this new draft.' } });
    await act(async () => { finish(Response.json({ ok: true, id }, { status: 202 })); });
    expect((screen.getByLabelText('Your feedback') as HTMLTextAreaElement).value).toBe('Keep this new draft.');
    expect(screen.getByRole('status').textContent).toBe('');
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});

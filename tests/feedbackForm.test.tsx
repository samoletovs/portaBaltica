import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FeedbackForm } from '../src/components/FeedbackForm';

describe('FeedbackForm', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('submits comment feedback to the API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackForm slug="latvian-wage-growth-outpaces-inflation" />);

    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'Very useful breakdown.' } });
    fireEvent.change(screen.getByLabelText('Contact (optional)'), { target: { value: 'reader@example.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
      await Promise.resolve();
    });
    expect(screen.getByText(/Thanks — your feedback was received for review\./)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/article-feedback');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(options.body).toBe(
      JSON.stringify({
        slug: 'latvian-wage-growth-outpaces-inflation',
        kind: 'comment',
        message: 'Very useful breakdown.',
        contact: 'reader@example.com',
      }),
    );
  });

  it('shows an error when API submission fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    render(<FeedbackForm slug="latvian-wage-growth-outpaces-inflation" />);
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'This chart legend is unclear.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
      await Promise.resolve();
    });
    expect(screen.getByText(/Could not send feedback right now/)).toBeTruthy();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BriefingsPage from '../src/components/news/BriefingsPage';

function renderPage(open = '') {
  vi.stubEnv('VITE_BRIEFING_ENQUIRIES_OPEN', open);
  return render(<MemoryRouter><BriefingsPage /></MemoryRouter>);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('business briefing discovery pilot', () => {
  it.each(['', 'false', '1', 'TRUE'])('does not collect enquiries unless explicitly enabled (%s)', (flag) => {
    const { container } = renderPage(flag);
    expect(screen.getByText('Pilot enquiries are not open yet')).toBeTruthy();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Use the free dashboard' }).getAttribute('href')).toBe('/data');
  });

  it('distinguishes the free automated review from a proposed human-reviewed deliverable', () => {
    renderPage();
    expect(screen.getByText(/research preview, not an established paid service/)).toBeTruthy();
    expect(screen.getByText(/not a sample of a human-reviewed client deliverable/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /latest public weekly review/ }).getAttribute('href')).toBe('/weekly');
  });

  it('prepares an editable-mail enquiry without sending or storing customer data', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderPage('true');
    fireEvent.change(screen.getByLabelText('Country coverage'), { target: { value: 'Estonia' } });
    fireEvent.change(screen.getByLabelText('Focus', { exact: true }), { target: { value: 'Demand and trade' } });
    const question = 'Compare demand & costs for a Baltic expansion? #planning';
    fireEvent.change(screen.getByLabelText(/What business decision/), { target: { value: question } });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare enquiry' }));

    expect(screen.getByRole('status').textContent).toBe('Draft ready. Nothing has been sent.');
    const href = screen.getByRole('link', { name: 'Open email draft' }).getAttribute('href')!;
    expect(href.startsWith('mailto:portabaltica@naurolabs.com?')).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(params.get('subject')).toBe('Business briefing pilot enquiry');
    expect(params.get('body')).toContain('Country coverage: Estonia');
    expect(params.get('body')).toContain('Focus: Demand and trade');
    expect(params.get('body')).toContain(question);
    expect(params.get('body')).toContain('not an order or a newsletter subscription');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('does not keep an outdated draft after the reader changes the question', () => {
    renderPage('true');
    fireEvent.change(screen.getByLabelText(/What business decision/), { target: { value: 'Compare the costs of hiring.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare enquiry' }));
    fireEvent.change(screen.getByLabelText('Country coverage'), { target: { value: 'Latvia' } });
    expect(screen.queryByRole('link', { name: 'Open email draft' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare enquiry' }));
    fireEvent.change(screen.getByLabelText(/What business decision/), { target: { value: 'A different business question.' } });
    expect(screen.queryByRole('link', { name: 'Open email draft' })).toBeNull();
  });

  it('rejects whitespace-only questions instead of preparing empty enquiries', () => {
    const { container } = renderPage('true');
    fireEvent.change(screen.getByLabelText(/What business decision/), { target: { value: '             ' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(screen.getByRole('alert').textContent).toMatch(/10 to 600 characters/);
    expect(screen.queryByRole('link', { name: 'Open email draft' })).toBeNull();
  });
});

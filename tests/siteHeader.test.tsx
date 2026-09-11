import { lazy, type ComponentType } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { ThemeProvider } from '../src/ThemeContext';
import { SiteLayout } from '../src/components/SiteLayout';

function Content() {
  const location = useLocation();
  return <main id="main" data-query={location.search}>{location.pathname}</main>;
}

function renderSite(path: string) {
  return render(
    <ThemeProvider><CountryProvider><FilterProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route element={<SiteLayout />}><Route path="*" element={<Content />} /></Route></Routes>
      </MemoryRouter>
    </FilterProvider></CountryProvider></ThemeProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe('coherent site navigation', () => {
  it('uses the two-tone wordmark in the masthead and footer', () => {
    renderSite('/');
    const brand = screen.getByRole('link', { name: 'portaBaltica home' });
    expect(brand.textContent).toBe('portaBaltica');
    expect(brand.querySelector('.news-accent')?.textContent).toBe('Baltica');
    expect(screen.getByRole('contentinfo').querySelector('.news-accent')?.textContent).toBe('Baltica');
  });

  it('offers four peer destinations and one shared publication footer', () => {
    renderSite('/article/example');
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')]))
      .toEqual([['The journal', '/'], ['Dashboard', '/data'], ['Data explorer', '/explore'], ['Business briefings', '/briefings']]);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    const footer = screen.getByRole('navigation', { name: 'Publication' });
    expect(within(footer).getAllByRole('link').map(link => link.getAttribute('href')))
      .toEqual(['/follow', '/newsroom', '/corrections', '/about/ai', '/api-docs']);
    expect(screen.queryByRole('navigation', { name: 'Site sections' })).toBeNull();
  });

  it('keeps navigation and a real skip target available while a page is loading', () => {
    const Pending = lazy(() => new Promise<{ default: ComponentType }>(() => {}));
    render(<MemoryRouter><Routes><Route element={<SiteLayout />}><Route path="/" element={<Pending />} /></Route></Routes></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Skip to content' }).getAttribute('href')).toBe('#main');
    expect(screen.getByRole('main').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('link', { name: 'portaBaltica home' })).toBeTruthy();
  });

  it('does not put data controls above a news article', () => {
    renderSite('/article/example');
    expect(screen.queryByLabelText('Country')).toBeNull();
    expect(screen.queryByLabelText('Date range filter')).toBeNull();
  });

  it('keeps primary navigation available without an open or close control', () => {
    renderSite('/');
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(screen.queryByRole('button', { name: /menu/i })).toBeNull();
    expect(primary.hasAttribute('hidden')).toBe(false);
    fireEvent.click(within(primary).getByRole('link', { name: 'Data explorer' }));
    expect(screen.getByRole('main').textContent).toBe('/explore');
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(1);
    fireEvent.keyDown(primary, { key: 'Escape' });
    expect(within(primary).getAllByRole('link')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /menu/i })).toBeNull();
  });

  it('honours and persists the alternative theme without changing destinations', () => {
    const first = renderSite('/');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(localStorage.getItem('pb-theme')).toBe('dark');
    first.unmount();
    renderSite('/explore');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeTruthy();
  });
});

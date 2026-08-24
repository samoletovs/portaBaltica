import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CountryProvider } from '../src/CountryContext';
import { FilterProvider } from '../src/FilterContext';
import { ThemeProvider } from '../src/ThemeContext';
import { Header } from '../src/components/Header';

function renderHeader(path: string) {
  return render(
    <ThemeProvider>
      <CountryProvider>
        <FilterProvider>
          <MemoryRouter initialEntries={[path]}>
            <Header />
          </MemoryRouter>
        </FilterProvider>
      </CountryProvider>
    </ThemeProvider>,
  );
}

describe('unified site header', () => {
  it('shows News beside the dashboard sections on article routes', () => {
    renderHeader('/article/example');

    expect(screen.getByRole('link', { name: 'News' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/data');
    expect(screen.getByLabelText(/Switch to .* theme/)).toBeTruthy();
    expect(screen.getByLabelText('Date range filter')).toBeTruthy();
  });

  it('keeps dashboard section URLs and active state', () => {
    renderHeader('/data/economy');

    expect(screen.getByRole('link', { name: 'Economy' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'News' }).getAttribute('href')).toBe('/');
  });
});

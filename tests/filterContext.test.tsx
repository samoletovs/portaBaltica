import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FilterProvider, useFilter, YEAR_OPTIONS } from '../src/FilterContext';

function FilterConsumer() {
  const { years, setYears } = useFilter();
  return (
    <div>
      <span data-testid="years">{years}</span>
      <button onClick={() => setYears(10)}>set10</button>
      <button onClick={() => setYears(1)}>set1</button>
    </div>
  );
}

describe('FilterContext', () => {
  it('provides default years of 5', () => {
    render(
      <FilterProvider>
        <FilterConsumer />
      </FilterProvider>,
    );
    expect(screen.getByTestId('years').textContent).toBe('5');
  });

  it('updates years when setYears is called', () => {
    render(
      <FilterProvider>
        <FilterConsumer />
      </FilterProvider>,
    );
    fireEvent.click(screen.getByText('set10'));
    expect(screen.getByTestId('years').textContent).toBe('10');
  });

  it('can set years to 1', () => {
    render(
      <FilterProvider>
        <FilterConsumer />
      </FilterProvider>,
    );
    fireEvent.click(screen.getByText('set1'));
    expect(screen.getByTestId('years').textContent).toBe('1');
  });

  it('YEAR_OPTIONS contains expected values', () => {
    expect(YEAR_OPTIONS).toEqual([1, 3, 5, 10]);
  });
});

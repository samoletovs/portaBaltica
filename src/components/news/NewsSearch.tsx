import { useRef } from 'react';

interface NewsSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function NewsSearch({ value, onChange }: NewsSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="relative min-w-0 flex-1 basis-80">
      <label htmlFor="news-search" className="sr-only">
        Search headlines and summaries
      </label>
      <svg
        aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round"
        className="news-subtle pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        ref={inputRef}
        id="news-search"
        type="search"
        maxLength={200}
        value={value}
        placeholder="Search our reporting"
        aria-describedby="news-search-scope"
        aria-controls="news-results"
        className="news-border news-panel news-fg w-full rounded-lg border py-2 pl-12 pr-12 text-ui [&::-webkit-search-cancel-button]:hidden"
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          className="news-muted news-hover absolute inset-y-0 right-0 flex items-center justify-center rounded-lg"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" className="h-4 w-4">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      )}
      <p id="news-search-scope" className="sr-only">
        Searches headlines and summaries in the current published index, not article bodies or other outlets.
      </p>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { SECTION_LABELS } from '../../newsroom/sections';

interface NewsToolsProps {
  sections: string[];
  filter: string;
  search: string;
  shown: number;
  total: number;
  loading?: boolean;
  failed?: boolean;
  onFilter: (value: string) => void;
  onSearch: (value: string) => void;
}

export function NewsTools({ sections, filter, search, shown, total, loading, failed, onFilter, onSearch }: NewsToolsProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
      event.preventDefault();
      input.current?.focus();
    }
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  return (
    <section aria-label="News tools" className="mb-6">
      <div className="flex items-center gap-3">
        <label htmlFor="news-topic" className="sr-only">News topic</label>
        <select id="news-topic" value={filter} disabled={loading || failed}
          className="news-border news-panel news-fg min-w-0 max-w-40 rounded-lg border px-3 py-2 text-ui"
          onChange={(event) => onFilter(event.target.value)}>
          <option value="all">All topics</option>
          {Object.entries(SECTION_LABELS).filter(([key]) => sections.includes(key) || key === filter)
            .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <form role="search" className="news-border news-panel flex min-w-0 flex-1 items-center rounded-lg border sm:ml-auto sm:max-w-sm"
          onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="news-search" className="sr-only">Search headlines and summaries</label>
          <input ref={input} id="news-search" type="search" maxLength={200} value={search}
            placeholder="Search news"
            title="Search headlines and summaries. Press / to focus."
            aria-describedby="news-search-scope" aria-controls="news-results"
            className="news-search-input news-fg min-w-0 w-full rounded-lg bg-transparent px-3 py-2 text-ui"
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onSearch('');
                input.current?.blur();
              }
            }} />
          {search && <button type="button" aria-label="Clear search"
            className="news-link shrink-0 rounded-lg px-2 text-ui"
            onClick={() => { onSearch(''); input.current?.focus(); }}>
            <span aria-hidden="true">&times;</span>
          </button>}
        </form>
      </div>
      <p id="news-search-scope" className="sr-only">
        Searches headlines and summaries in the current published index, not article bodies or other outlets.
      </p>
      <p role="status" className={search || filter !== 'all' || loading || failed ? 'news-subtle mt-2 text-caption' : 'sr-only'}>
        {loading ? 'Loading articles' : failed ? 'Articles could not be loaded' : `Showing ${shown} of ${total} matching articles`}
      </p>
    </section>
  );
}

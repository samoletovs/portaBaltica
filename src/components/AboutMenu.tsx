import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

const LINKS = [
  { to: '/newsroom', label: 'The newsroom' },
  { to: '/about/ai', label: 'How we use AI' },
  { to: '/corrections', label: 'Corrections' },
  { to: '/follow', label: 'Follow portaBaltica' },
  { to: '/briefings', label: 'Business briefings' },
  { to: '/api-docs', label: 'API documentation' },
];

export function AboutMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target)) {
        ref.current.open = false;
      }
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

  return (
    <details ref={ref} className="relative shrink-0" onKeyDown={(event) => {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector('summary')?.focus();
      }
    }}>
      <summary className="news-link flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-ui"
        aria-label="About portaBaltica">
        About <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </summary>
      <nav aria-label="About portaBaltica"
        className="news-border news-panel absolute right-0 z-50 mt-2 w-64 rounded-lg border p-2 shadow-lg">
        {LINKS.map(({ to, label }) => (
          <Link key={to} to={to} className="news-fg news-hover-panel flex items-center rounded px-3 py-2 text-ui"
            onClick={() => { if (ref.current) ref.current.open = false; }}>
            {label}
          </Link>
        ))}
      </nav>
    </details>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { DashboardSection } from '../types';
import { useOverflowFade } from '../utils/useOverflowFade';

export interface SectionLink {
  id: DashboardSection;
  label: string;
}

/**
 * An in-page rail for the dashboard's own sections.
 *
 * The overview is roughly **13,000px at 1440 and 28,000px at 375** — fourteen
 * screens on a desktop and thirty-one on a phone. Nobody scrolls thirty-one
 * screens, so everything below about the third was effectively invisible, and
 * the masthead tabs did not help: they route to a filtered view rather than
 * moving you within the page, and nothing told a reader that was what they did.
 *
 * This is the smallest thing that fixes both halves of that. It sticks to the
 * top while you scroll, so a way out is always one tap away; it highlights the
 * section you are actually in, so the page reports where you are; and the
 * highlight moving as you scroll is what teaches a reader that the sections and
 * the tabs are the same set of things.
 *
 * **Why this and not a sticky masthead.** The masthead is rendered by
 * `SiteLayout` above *every* route, including the newsroom, and it is about
 * 130px tall with the ticker — a fifth of a phone viewport, permanently, on an
 * article page. DESIGN.md already lists dashboard chrome colonising the
 * newsroom as a known gap, and making it sticky would deepen that. A rail that
 * belongs to the dashboard costs 44px, appears only where there is something
 * to navigate, and leaves the reading half of the site alone.
 *
 * These are real anchors. A fragment link works with JavaScript disabled,
 * survives being copied out of the address bar, is focusable and activatable by
 * keyboard for free, and lands correctly because `.dash-section` carries a
 * `scroll-margin-top` that clears this rail.
 */
export function SectionRail({ sections }: { sections: SectionLink[] }) {
  const [active, setActive] = useState<string | null>(null);
  const railRef = useRef<HTMLElement | null>(null);
  const [fadeRef, fadeClass] = useOverflowFade<HTMLDivElement>();

  useEffect(() => {
    const targets = sections
      .map(({ id }) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;

    // Track the topmost section whose start has passed under the rail. Reading
    // "which section am I in" off entry ratios alone gets it wrong on a page
    // where one section is taller than the viewport: nothing is intersecting
    // by a large fraction, so the answer flickers or goes blank.
    const observer = new IntersectionObserver(
      () => {
        const railHeight = railRef.current?.getBoundingClientRect().height ?? 0;
        const line = railHeight + 8;
        let current: string | null = null;
        for (const target of targets) {
          if (target.getBoundingClientRect().top <= line) current = target.id;
        }
        setActive(current ?? targets[0].id);
      },
      { rootMargin: '0px', threshold: [0, 0.01, 0.5, 1] },
    );

    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [sections]);

  // Keep the active chip in view on a narrow screen, where the rail scrolls
  // sideways and the section you are in may be off the end of it.
  useEffect(() => {
    if (!active || !railRef.current) return;
    const chip = railRef.current.querySelector<HTMLElement>(`[data-section="${active}"]`);
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <nav
      ref={railRef}
      aria-label="Jump to a dashboard section"
      className="sticky top-0 z-30 -mx-4 sm:-mx-6 mb-6"
      style={{ background: 'var(--bg-page)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div
        ref={fadeRef}
        className={`flex gap-1 overflow-x-auto px-4 sm:px-6 ${fadeClass}`}
      >
        {sections.map(({ id, label }) => {
          const isActive = active === id;
          return (
            <a
              key={id}
              href={`#${id}`}
              data-section={id}
              className={`shrink-0 px-3 py-2 text-ui whitespace-nowrap border-b-2 transition-colors ${isActive ? 'font-semibold' : ''}`}
              style={{
                borderColor: isActive ? 'var(--news-accent)' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              /* The rail describes where the reader is, so the current section
                 is `aria-current="location"` rather than `page` — the page has
                 not changed, and the masthead tab already claims `page`. */
              aria-current={isActive ? 'location' : undefined}
            >
              {label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}

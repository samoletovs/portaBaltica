import type { ReactNode } from 'react';

/**
 * The heading of a dashboard section, and the line that says where its numbers
 * came from.
 *
 * Written once because it was written eight times, and because the same defect
 * was in all eight: the heading and its source line sat in a
 * `flex items-baseline justify-between` row, so at 375px the caption wrapped
 * onto a second line and floated to the right margin, visually detached from
 * the heading it belongs to and looking like an unrelated fragment. They stack
 * below `sm` and only sit on one line when there is room for one.
 *
 * The spacing is DESIGN.md §1.2's rule that a heading belongs to what follows
 * it: 48px above from the gap between sections, 12px below to its own content,
 * roughly the 2:1 Carbon describes. The tiles previously put 24px below the
 * heading and had 32px between sections, so a section boundary was barely more
 * emphatic than the gap between two cards inside one.
 */
export function TileHeader({
  title,
  meta,
  children,
}: {
  title: string;
  /** Country, source, as-of — the provenance line. */
  meta?: ReactNode;
  /** Anything that must sit between the heading and the content, such as a notice. */
  children?: ReactNode;
}) {
  return (
    <header className="mb-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
        <h2 className="balance-text text-title font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h2>
        {meta && (
          <p className="text-caption" style={{ color: 'var(--text-tertiary)' }}>
            {meta}
          </p>
        )}
      </div>
      {children}
    </header>
  );
}

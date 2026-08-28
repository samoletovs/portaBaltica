import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Block } from './markdown-parse';
import { headingId, parseMarkdown } from './markdown-parse';

// ─── A small markdown renderer ───
//
// The published policy documents in newsroom/policy/ are the authoritative
// text. They are rendered from source rather than retyped into JSX so that the
// policy has one place to be edited and cannot silently drift from what the
// site says.
//
// No dependency, and no `dangerouslySetInnerHTML` anywhere: this produces React
// elements directly, so there is no path by which markdown source could inject
// markup. `tests/markdown.test.tsx` asserts that.

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

// `break-words` because a policy document is prose we do not control the width
// of. `corrections.md` links with the label `github.com/samoletovs/portaBaltica/issues`
// — 41 characters, and a URL offers a line break nowhere — which pushed
// `/corrections` 42px past a 320px viewport, on the one page a reader reaches
// when they already think we have got something wrong.
//
// Applied to the class rather than to that label: shortening the label fixes
// the instance, and the next long path or repository URL someone writes into a
// policy is the same defect again. The same reasoning covers inline code, which
// carries `newsroom/sources.yaml` at 21 characters today and is one edit from
// being the next offender.
const LINK_CLASS =
  'news-link break-words underline underline-offset-4';

/** Renders inline emphasis, code and links. Returns React nodes, never HTML. */
function renderInline(text: string, keyPrefix = ''): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== '' && part !== undefined);

  return parts.map((part, position) => {
    const key = `${keyPrefix}-${position}`;

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="news-fg font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={key}
          className="news-accent-panel news-accent code-inline break-words rounded px-1 py-0.5 font-mono"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const link = LINK.exec(part);
    if (link) {
      const [, label, href] = link;
      // Internal routes go through the router so the policy's own cross-links
      // behave like navigation rather than a full page load.
      if (href.startsWith('/')) {
        return (
          <Link key={key} to={href} className={LINK_CLASS}>
            {label}
          </Link>
        );
      }
      if (href.startsWith('#')) {
        return (
          <a key={key} href={href} className={LINK_CLASS}>
            {label}
          </a>
        );
      }
      return (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          {label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    }

    return <span key={key}>{part}</span>;
  });
}

/**
 * Heading sizes come from the shared scale, and they descend.
 *
 * They did not before: h3 was rendered at `text-callout` and h4 at `text-ui`,
 * which put both at or below the size of the paragraphs they introduced. A
 * heading that is smaller than its own body text stops reading as a heading
 * and starts reading as a stray bold line, which is most of why these pages
 * looked unstructured.
 *
 * h4 is the exception and is deliberate: it drops to a small uppercase label
 * in the interface face. That is a different kind of object from h1–h3 — a
 * tag on a block rather than a level of the document — so it is distinguished
 * by treatment rather than by being another notch down an already short ramp.
 */
const HEADING_CLASSES: Record<number, string> = {
  1: 'balance-text news-fg text-headline font-semibold tracking-tight sm:text-display',
  2: 'balance-text news-fg mt-12 mb-4 text-title font-semibold tracking-tight',
  3: 'balance-text news-fg mt-8 mb-3 text-lead font-semibold',
  4: 'news-subtle mt-6 mb-2 text-caption font-semibold uppercase tracking-widest',
};

function Heading({ level, text }: { level: number; text: string }) {
  const Tag = `h${Math.min(level, 6)}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <Tag id={headingId(text)} className={HEADING_CLASSES[level] ?? HEADING_CLASSES[4]}>
      {renderInline(text, `h-${text}`)}
    </Tag>
  );
}

function BlockView({ block, index }: { block: Block; index: number }) {
  switch (block.kind) {
    case 'heading':
      return <Heading level={block.level} text={block.text} />;

    case 'rule':
      return <hr className="news-border my-8" />;

    case 'meta':
      return (
        <dl className="news-border news-panel my-6 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border px-4 py-3 text-ui">
          {block.entries.map((entry, position) => (
            <div key={`${index}-m-${position}`} className="flex gap-2">
              <dt className="news-subtle">{entry.label}</dt>
              <dd className="news-muted">
                {renderInline(entry.value, `dd-${index}-${position}`)}
              </dd>
            </div>
          ))}
        </dl>
      );

    case 'list':
      return block.ordered ? (
        <ol className="pretty-text news-muted my-6 list-decimal space-y-2 pl-6 text-prose">
          {block.items.map((item, position) => (
            <li key={`${index}-${position}`}>{renderInline(item, `li-${index}-${position}`)}</li>
          ))}
        </ol>
      ) : (
        <ul className="pretty-text news-muted my-6 list-disc space-y-2 pl-6 text-prose">
          {block.items.map((item, position) => (
            <li key={`${index}-${position}`}>{renderInline(item, `li-${index}-${position}`)}</li>
          ))}
        </ul>
      );

    case 'table':
      // A policy table is prose in cells with a short label column, and at a
      // phone's width a column is not a column. Measured on master at 320px:
      //
      //   /corrections   3 columns at 108 / 115 / 110px, rows 13 lines tall,
      //                  and 46px of it hidden with no scroll affordance
      //   /about/ai      2 columns at 114 / 172px, rows 7 lines tall
      //
      // 115px at 14px type is about **11 characters a line**. §4.2 puts a
      // comfortable measure at 45–75 and WCAG SC 1.4.8 caps a block of text at
      // 80, so the cells were failing the site's own reading rule by a factor
      // of four — on the two pages a sceptical reader goes to. Widening the
      // columns is not available: the viewport is the constraint.
      //
      // So below `sm` each row becomes a labelled block at the full column
      // width, which is the same information at ~33 characters a line and no
      // sideways scroll. It costs height, and that is the right trade here in
      // a way it was not for the section filter in §4.5: this is the content,
      // not a control standing in front of it.
      //
      // The header row is hidden below `sm` because each cell carries its own
      // label there — rendered as a real element rather than as
      // `content: attr(...)`, which cannot be selected, copied or read
      // reliably. Above `sm` those labels are hidden and the table is a table.
      return (
        <div className="news-border my-6 overflow-hidden rounded-lg border sm:overflow-x-auto">
          <table className="block w-full border-collapse text-left text-ui sm:table">
            <thead className="hidden sm:table-header-group">
              <tr className="news-border news-panel border-b">
                {block.header.map((cell, position) => (
                  <th
                    key={`${index}-h-${position}`}
                    scope="col"
                    className="news-subtle px-4 py-2 text-caption font-semibold uppercase tracking-widest"
                  >
                    {renderInline(cell, `th-${index}-${position}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {block.rows.map((row, rowPosition) => (
                <tr
                  key={`${index}-r-${rowPosition}`}
                  className="news-border block border-b p-4 last:border-0 sm:table-row sm:p-0"
                >
                  {row.map((cell, position) => (
                    <td
                      key={`${index}-c-${rowPosition}-${position}`}
                      className="news-muted block align-top leading-relaxed sm:table-cell sm:px-4 sm:py-2"
                    >
                      <span className="news-subtle block text-caption font-semibold uppercase tracking-widest sm:hidden">
                        {block.header[position]}
                      </span>
                      {renderInline(cell, `td-${index}-${rowPosition}-${position}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'paragraph':
    default:
      return (
        <p className="pretty-text news-muted my-6 text-prose">
          {renderInline(block.text, `p-${index}`)}
        </p>
      );
  }
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} index={index} />
      ))}
    </div>
  );
}

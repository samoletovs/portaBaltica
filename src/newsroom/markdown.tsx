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

const LINK_CLASS =
  'text-ocean-300 underline underline-offset-4 hover:text-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-400';

/** Renders inline emphasis, code and links. Returns React nodes, never HTML. */
function renderInline(text: string, keyPrefix = ''): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== '' && part !== undefined);

  return parts.map((part, position) => {
    const key = `${keyPrefix}-${position}`;

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-slate-100">
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
          className="rounded bg-slate-800/70 px-1 py-0.5 font-mono text-[0.85em] text-ocean-100"
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

const HEADING_CLASSES: Record<number, string> = {
  1: 'text-3xl font-semibold tracking-tight text-white',
  2: 'mt-10 mb-3 text-xl font-semibold tracking-tight text-white',
  3: 'mt-8 mb-2 text-base font-semibold text-slate-100',
  4: 'mt-6 mb-2 text-sm font-semibold text-slate-200',
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
      return <hr className="my-8 border-slate-800/60" />;

    case 'meta':
      return (
        <dl className="my-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-slate-800/60 bg-slate-900/40 px-4 py-3 text-sm">
          {block.entries.map((entry, position) => (
            <div key={`${index}-m-${position}`} className="flex gap-2">
              <dt className="text-slate-500">{entry.label}</dt>
              <dd className="text-slate-200">
                {renderInline(entry.value, `dd-${index}-${position}`)}
              </dd>
            </div>
          ))}
        </dl>
      );

    case 'list':
      return block.ordered ? (
        <ol className="my-4 list-decimal space-y-2 pl-6 text-[17px] leading-relaxed text-slate-300">
          {block.items.map((item, position) => (
            <li key={`${index}-${position}`}>{renderInline(item, `li-${index}-${position}`)}</li>
          ))}
        </ol>
      ) : (
        <ul className="my-4 list-disc space-y-2 pl-6 text-[17px] leading-relaxed text-slate-300">
          {block.items.map((item, position) => (
            <li key={`${index}-${position}`}>{renderInline(item, `li-${index}-${position}`)}</li>
          ))}
        </ul>
      );

    case 'table':
      return (
        <div className="my-6 overflow-x-auto rounded-lg border border-slate-800/60">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800/60 bg-slate-900/50">
                {block.header.map((cell, position) => (
                  <th
                    key={`${index}-h-${position}`}
                    scope="col"
                    className="px-4 py-2.5 font-medium text-slate-200"
                  >
                    {renderInline(cell, `th-${index}-${position}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowPosition) => (
                <tr
                  key={`${index}-r-${rowPosition}`}
                  className="border-b border-slate-800/40 last:border-0"
                >
                  {row.map((cell, position) => (
                    <td
                      key={`${index}-c-${rowPosition}-${position}`}
                      className="px-4 py-2.5 align-top leading-relaxed text-slate-300"
                    >
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
        <p className="my-4 text-[17px] leading-relaxed text-slate-300">
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

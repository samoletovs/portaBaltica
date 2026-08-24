// ─── Markdown block parser ───
//
// Pure functions, no JSX: the policy documents in newsroom/policy/ are parsed
// here and rendered by markdown.tsx. Keeping the parser separate makes it
// directly unit-testable, and covers exactly what those documents use.

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'meta'; entries: { label: string; value: string }[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'rule' };

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^-{3,}\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+\.\s+(.*)$/;
const TABLE_ROW = /^\|(.*)\|\s*$/;
const TABLE_DIVIDER = /^\|[\s:|-]+\|\s*$/;
/** `**Last updated:** 2026-08-24` — a labelled metadata line. */
const META_LINE = /^\*\*([^*]+?):\*\*\s*(.*)$/;

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    if (RULE.test(line.trim())) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    // A table is a row followed by a divider row; anything else starting with
    // a pipe is treated as ordinary text.
    if (TABLE_ROW.test(line) && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW.test(lines[index])) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = isOrdered ? ORDERED.exec(current) : BULLET.exec(current);
        if (match) {
          items.push(match[1].trim());
          index += 1;
          continue;
        }
        // An indented line continues the previous item across a line wrap.
        if (/^\s+\S/.test(current) && items.length > 0) {
          items[items.length - 1] += ` ${current.trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered: isOrdered, items });
      continue;
    }

    // Ordinary prose. The first line is consumed unconditionally: it has
    // already failed every block test above, and a branch that can consume
    // zero lines would spin forever — a line like "| not a table |", which is
    // a pipe row with no divider under it, reaches exactly this point.
    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length) {
      const current = lines[index];
      if (
        current.trim() === '' ||
        HEADING.test(current) ||
        RULE.test(current.trim()) ||
        BULLET.test(current) ||
        ORDERED.test(current) ||
        TABLE_ROW.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      index += 1;
    }

    // A run of two or more labelled lines is a metadata header, not prose.
    // CommonMark would collapse them onto one line, which is not what the
    // author of the policy documents means by writing them stacked.
    const metaMatches = paragraph.map((entry) => META_LINE.exec(entry));
    if (paragraph.length > 1 && metaMatches.every(Boolean)) {
      blocks.push({
        kind: 'meta',
        entries: metaMatches.map((match) => ({ label: match![1], value: match![2] })),
      });
      continue;
    }

    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

/** Stable id for a heading, so sections of the policy can be linked to directly. */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

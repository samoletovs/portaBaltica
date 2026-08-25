// ─── Readable figures ───
//
// Generated prose arrives with the precision the arithmetic happened to
// produce: "a deviation of -6.71378%" or "the four-year average of 7.075%".
// Nobody reads a labour-market story to five decimal places, and the spurious
// digits actively mislead — they imply the underlying series is measured that
// finely when it is not.
//
// This rounds for display only. Two rules keep it honest:
//
//   1. Only the rendered text changes. The stored article, the figures bound
//      to their signal fields, and everything the validator checked are
//      untouched. The precise value stays available in the `title` attribute,
//      so a reader who wants it can still get it.
//   2. It only ever shortens a decimal fraction. Years, counts, identifiers and
//      anything without a decimal point are left exactly as written, because a
//      transform that could turn 2026 into 2.0k would be worse than the problem
//      it solves.
//
// The real fix belongs upstream — the generator should not emit five decimals
// in the first place. This is the reader-facing half, and it is safe to keep
// even once the pipeline rounds at source, because it is a no-op on a number
// that is already short.

/**
 * Decimal numbers, with an optional sign and an optional percent sign.
 *
 * The whitespace before `%` is only consumed when a `%` actually follows.
 * Matching `\s*%?` unconditionally swallowed the space in "16.31578 EUR/hour"
 * and produced "16.32EUR/hour".
 */
const DECIMAL = /-?\d+\.\d+(?:\s*%)?/g;

/** Percentages read best at one decimal; bare quantities keep two. */
function roundToken(token: string): string {
  const isPercent = token.trimEnd().endsWith('%');
  const numeric = Number.parseFloat(token);
  if (!Number.isFinite(numeric)) return token;

  const decimals = (token.split('.')[1] ?? '').replace(/[^\d]/g, '').length;
  const limit = isPercent ? 1 : 2;
  if (decimals <= limit) return token;

  const rounded = numeric.toFixed(limit).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  return isPercent ? `${rounded}%` : rounded;
}

/** True when rounding would actually change the text. */
export function needsRounding(text: string): boolean {
  return formatFigures(text) !== text;
}

/**
 * Shortens over-precise decimals in a run of prose.
 *
 * Returns the input unchanged when there is nothing to shorten, so callers can
 * cheaply detect whether a tooltip is warranted.
 */
export function formatFigures(text: string): string {
  return text.replace(DECIMAL, roundToken);
}

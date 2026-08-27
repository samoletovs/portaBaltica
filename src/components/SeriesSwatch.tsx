/**
 * A small line swatch in a series colour.
 *
 * Series colours label text in three places on the dashboard — the direct
 * labels above a comparison chart, the four power-market zone prices, and the
 * recharts legend. Measured against the real card surface, **328 of 496 of
 * those text nodes failed their contrast floor**:
 *
 *   light  --series-lt  3.24:1     dark  --series-lv  3.90:1
 *   light  --series-lv  4.01:1
 *   light  --series-ee  4.28:1
 *
 * All four clear SC 1.4.11's 3:1 for a graphical object and none clear SC
 * 1.4.3's 4.5:1 for text under 24px. That is not four unlucky values: a hue
 * tuned to sit just above 3:1 as a *line* cannot also clear 4.5:1 as *text*,
 * so the palette was being asked to meet a floor it was never built for.
 *
 * The obvious repair — brighten the values — makes a documented property
 * worse. DESIGN.md records ΔE 13.9 between `--series-lv` and `--data-negative`,
 * and brightening Latvia moves it toward the "this got worse" red it has to
 * stay distinct from.
 *
 * So the colour moves instead of changing. It is not deleted, because it was
 * carrying something real: which line in the chart below belongs to this
 * reading. The flag emoji cannot carry that — Segoe UI Emoji has no
 * regional-indicator glyphs, so on Windows `🇱🇻` renders as the letters "LV"
 * in the *text* colour, identifying the country while carrying none of its
 * hue. Deleting the colour outright would have left a Windows reader with no
 * way to match a label to a line at all.
 *
 * A swatch is where a 3:1 colour belongs, and it is what the recharts legend
 * in the same card already does.
 *
 * The dash pattern is deliberately not reproduced here. The four chart
 * patterns run from solid to `30 9`, and inside a 14px swatch both `30 9` and
 * Latvia's solid line draw as a plain bar — a swatch that renders Finland
 * solid would contradict the chart rather than summarise it. The dash stays in
 * the chart, where there is room for it to read; the label row carries its own
 * non-colour encoding already, in the country name written beside it.
 */
export function SeriesSwatch({ color, className = '' }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ width: 14, height: 3, background: color }}
    />
  );
}

/**
 * A small line swatch in a series colour.
 *
 * Series colours label text in three places on the dashboard — the direct
 * labels above a comparison chart, the four power-market zone prices, and the
 * recharts legend. Measured against the real card surface, **328 of 496 of
 * those text nodes failed their contrast floor**:
 *
 *   light  --series-lv  3.59:1     dark  --series-lv  3.74:1
 *   light  --series-ee  4.09:1     dark  --series-ee  3.98:1
 *   light  --series-lt  4.18:1     dark  --series-lt  4.15:1
 *
 * All of them clear SC 1.4.11's 3:1 for a graphical object and none clears SC
 * 1.4.3's 4.5:1 for text under 24px. That is not a set of unlucky values: a hue
 * tuned to sit above 3:1 as a *line* cannot also clear 4.5:1 as *text*, so the
 * palette was being asked to meet a floor it was never built for.
 *
 * The 2026 chroma reduction is the proof. It raised every one of those ratios —
 * light Latvia went 4.01 → 3.59 the other way, but light Lithuania went
 * 3.24 → 4.18 and dark Lithuania 9.92 → 4.15 — and **not one series crossed
 * 4.5**. Changing the values does not fix this; only moving the colour off the
 * text does.
 *
 * The other obvious repair makes a documented property worse. DESIGN.md records
 * the distance between `--series-lv` and `--data-negative`, and brightening
 * Latvia moves it toward the "this got worse" red it has to stay distinct from.
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
 *
 * A **marker** is the opposite case and is reproduced. Where the reader has
 * chosen solid strokes, the shape at the end of each line is the only thing
 * besides hue telling the three apart, and a circle, a square and a triangle
 * are all unambiguous at 8px in a way a dash pattern is not at 14. Showing it
 * here is what lets a reader match the triangle in the chart to the word
 * "Lithuania" beside it.
 */
export function SeriesSwatch({
  color,
  className = '',
  marker,
}: {
  color: string;
  className?: string;
  /** Drawn instead of the bar when the reader has chosen solid strokes. */
  marker?: 'circle' | 'square' | 'triangle';
}) {
  if (marker) {
    return (
      <span
        aria-hidden="true"
        className={`inline-block shrink-0 ${className}`}
        style={{
          width: 9,
          height: 9,
          background: color,
          borderRadius: marker === 'circle' ? '50%' : marker === 'square' ? 1 : undefined,
          clipPath: marker === 'triangle' ? 'polygon(50% 0%, 100% 100%, 0% 100%)' : undefined,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ width: 14, height: 3, background: color }}
    />
  );
}

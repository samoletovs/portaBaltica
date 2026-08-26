# portaBaltica — the design book

This is the authoritative description of how the site looks and why. It covers
both halves — the newsroom at `/` and the dashboard at `/data` — because they
are one product and a reader crosses between them constantly.

It exists because the site keeps re-learning the same lesson. The type scale
was rebuilt twice: once for the newsroom alone, which produced a site where
crossing from a story to a chart felt like crossing between two companies, and
then again for everything. Spacing, colour and focus were about to repeat that
history — the newsroom had a focus ring on every interactive element and the
dashboard had none, on any, anywhere.

**A rule that is only written down is a rule that will be broken by the next
change.** Everything here that can be enforced is enforced in
`tests/design-system.test.ts` and `tests/typography.test.ts`. If you want to
add a value that is not on a scale below, the test will stop you, and that is
the point: the friction is the design system.

---

## 1. Foundations

### 1.1 Type

Eight steps, one family, two weights. Defined in `src/index.css`, enforced by
`tests/typography.test.ts`, and documented in `AGENTS.md`. Unchanged by this
book except for one correction: **two weights means two.**

| Step | Size | Job |
|---|---|---|
| `text-caption` | 12px | eyebrows, badges, meta, footnotes, axis labels, source lines |
| `text-ui` | 14px | nav, controls, labels, table cells, dense prose |
| `text-callout` | 16px | card and panel titles, deks, secondary prose |
| `text-prose` | 18px | article and policy prose |
| `text-lead` | 22px | standfirsts, feed headlines, indicator values |
| `text-title` | 28px | section headings |
| `text-headline` | 34px | page headlines |
| `text-display` | 40px | the lead story, article `h1`, page `h1` |

**Weights: regular (400) and semibold (600). Nothing else.** The book used to
say this while the site used `font-medium` in thirty-two places and an inline
`fontWeight: 500` in four more, so in practice there were three. On a system UI
face 400 → 500 is barely a change, which is worse than no change: it costs a
weight and buys nothing legible. Emphasis is carried by size, colour and
semibold.

> Guardian's Source tokens do the same thing — headline presets vary size and
> line height, and the weight axis is used sparingly.
> `guardian/csnx:libs/@guardian/source/src/design-tokens/tokens.json`

### 1.2 Spacing

**An 8px grid, with a 4px subdivision for component internals and 2px inside
badges.** This is Carbon's `2x Grid` model, chosen over Material's 4dp base
because this is a dense data UI and Carbon is the only major system that
designs for that case explicitly.

> "The basic unit of 2x Grid geometry is the 8-pixel square mini unit."
> — <https://carbondesignsystem.com/elements/2x-grid/overview/>

Nine steps. They are named in `src/index.css` as `--space-*` and, because the
components are written in Tailwind, they correspond exactly to a **restricted
allowlist of Tailwind's numeric spacing**:

| Token | Tailwind | px | Job |
|---|---|---|---|
| `--space-3xs` | `0.5` | 2 | inside a badge or chip |
| `--space-2xs` | `1` | 4 | icon-to-label, tight inline gaps |
| `--space-xs` | `2` | 8 | between lines of a stacked label |
| `--space-sm` | `3` | 12 | between related items in a card |
| `--space-md` | `4` | 16 | default card and panel padding |
| `--space-lg` | `6` | 24 | between blocks inside a panel |
| `--space-xl` | `8` | 32 | between panels |
| `--space-2xl` | `12` | 48 | between dashboard sections |
| `--space-3xl` | `16` | 64 | page-level breaks |

Everything else is banned: no `p-5`, no `py-2.5`, no `gap-1.5`, no `mt-9`.
Those existed — thirty-seven distinct padding values, thirty-one margins,
fourteen gaps — and that is precisely why nothing on the page looked
intentional. Two panels 20px apart and two panels 24px apart read as a mistake,
because one of them is.

**Space above a heading is larger than space below it.** A heading belongs to
the content beneath it, so it must sit closer to it than to whatever it follows.
Carbon states the principle; the ratio here is roughly 2:1.

> "The top level headers have more space surrounding them giving them focus and
> prominence. Then as the headers descend in importance they receive less space."
> — <https://carbondesignsystem.com/elements/spacing/overview/>

| Heading | Above | Below |
|---|---|---|
| `text-display` | 64px | 24px |
| `text-headline` | 48px | 16px |
| `text-title` | 32px | 12px |
| `text-lead` | 24px | 8px |

### 1.3 Radius

Four steps, no more. The site had five, including a `rounded-md` used twice —
a sixth of a scale, appearing in two places, related to nothing.

| Token | Tailwind | px | Job |
|---|---|---|---|
| `--corner-chip` | `rounded` | 4 | chips, badges, inline code, skeleton bars |
| `--corner-control` | `rounded-lg` | 8 | buttons, inputs, tooltips, nested panels |
| `--corner-card` | `rounded-xl` | 12 | cards and top-level panels |
| — | `rounded-full` | — | pills, avatars, dots |

Nesting rule: an inner radius is one step below its container. A `rounded-lg`
panel inside a `rounded-xl` card looks right; the same radius twice looks like
the inner element is escaping.

**They are `--corner-*` and they live in `:root`, not `@theme`.** Both halves
of that matter. `@theme` entries are tree-shaken, and `--radius-*` is a
namespace Tailwind owns — so a `--radius-card` declared in `@theme` was present
in source, absent from the built stylesheet, and `var(--radius-card)` resolved
to nothing in production and only in production. See §6.

### 1.4 Surfaces and elevation

**In dark mode, layers get lighter, and separation comes from the surface step
before it comes from a border.** This is Carbon's model, and Material 3 and
Fluent 2 agree in substance.

> "In the dark themes, layers become one step lighter with each added layer."
> — <https://carbondesignsystem.com/elements/color/overview/>

> Material 3 uses *surface tint* — the primary colour overlaid at increasing
> opacity — rather than shadow, "because in dark themes shadows become less
> visible."  — <https://m3.material.io/styles/elevation/overview>

| Token | Job |
|---|---|
| `--bg-page` | the page itself |
| `--bg-card` | cards, panels, the masthead |
| `--bg-raised` | tooltips, popovers, nested panels, hover on a card |
| `--bg-sunken` | wells, table headers, inset code |

The cards used to be `rgba(15, 23, 42, 0.5)` over the page, which composites to
`#0d1322` — **1.06:1 against the background.** The border was `rgba(30, 41, 59,
0.4)`, which composites to 1.10:1 against the card. So a card was delimited by
two boundaries that were, between them, almost exactly invisible, and the whole
dashboard read as one flat sheet with text scattered on it. That is the single
biggest reason it did not look finished. Surfaces are now opaque, so they
compose predictably, and each layer is a real step.

**Rules.**
- Never pure black. Apple uses `#1C1C1E`, Carbon `#161616`, Fluent `#141414`;
  the page here is `#0a0f1a`. Pure black produces halo artefacts at edges.
- Never pure white text on dark. Carbon caps at Gray 10 (`#F4F4F4`).
- **Background step first, border second, shadow last.** A border is for an
  *interactive* boundary or where two layers are adjacent and the step alone is
  too subtle. A shadow is only for something that genuinely floats — a menu, a
  tooltip, a dialog.

### 1.5 Colour

Three families, and they must not be confused with each other.

**Neutral text ramp.** Every step is a ratio against the surface it sits on,
not a hex someone liked. The floor for anything a reader is expected to read is
**4.5:1 (WCAG 2.2 SC 1.4.3, AA)**.

| Token | Floor | Job |
|---|---|---|
| `--text-primary` | 12:1 | headings, indicator values |
| `--text-body` | 10:1 | running prose |
| `--text-secondary` | 7:1 | labels, deks, panel titles |
| `--text-tertiary` | 4.5:1 | meta, captions, **source attribution** |
| `--text-disabled` | 3:1 | inert only — never carries information |

This ramp is the fix for a real failure. `--text-muted` was `#475569`, which is
**2.53:1** on the page — and it was used for the source line under every chart.
The most important trust signal on a data-journalism site was rendered below
the legibility threshold. `--text-tertiary` was `#64748b` at **4.03:1**, also
short. In the light theme it was worse: tertiary at **2.56:1** and muted at
**1.48:1**, which is very close to invisible.

**Semantic colour** is for status, and only for status.

> "Semantic colors communicate at-a-glance information... Use them for important
> messages. Don't use them for decoration." — <https://fluent2.microsoft.design/color>

`--data-positive`, `--data-negative`, `--data-warning`, `--data-neutral`. In
dark themes these are deliberately lighter and less saturated than their light
equivalents, because a saturated red on a dark ground vibrates. Carbon shifts
its error red to `#FF8389` in dark for exactly this reason.

**Accent** (`--news-accent`, the ocean blue) is reserved for three things:
links, the active navigation indicator, and the primary call to action. Nothing
else. It is deliberately *not* a chart colour.

> "Avoid overusing brand colors or using them on large surfaces as they can
> dilute a hierarchy." — <https://fluent2.microsoft.design/color>

**Data-visualisation colour** is a separate palette from all of the above —
see §3.

### 1.6 Motion

Short, productive, and switchable off.

| Token | Value | Job |
|---|---|---|
| `--motion-fast` | 70ms | button and toggle states |
| `--motion-base` | 150ms | hover, colour changes, small moves |
| `--motion-slow` | 240ms | panel expansion, disclosure |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0.38, 0.9)` | element stays on screen |
| `--ease-entrance` | `cubic-bezier(0, 0, 0.38, 0.9)` | element appears |
| `--ease-exit` | `cubic-bezier(0.2, 0, 1, 0.9)` | element leaves |

These are Carbon's *productive* curves and durations, not its *expressive*
ones. A dashboard is a tool.
— <https://carbondesignsystem.com/elements/motion/overview/>

**`prefers-reduced-motion: reduce` must be honoured.** It was not honoured
anywhere on this site, including on an infinitely-looping ticker animation,
which is the exact case the setting exists for.

> "Design for and include a 'no motion' setting for your app or website as
> recommended by the WCAG." — <https://fluent2.microsoft.design/motion>

Never animate `all`. Name the properties.

---

## 2. Interaction

### 2.1 Focus

**Every focusable element on the site has a visible focus indicator.** This is
now a global `:focus-visible` rule rather than a class each component must
remember, because the class approach demonstrably failed: sixteen newsroom
components used `news-focus` and *not one* dashboard component had any focus
style at all. Every indicator card is a `<button>`; the whole `/data` half of
the site was unusable by keyboard.

The indicator is a solid **2px outline at 2px offset**, in a colour with at
least **3:1** contrast against the surface behind it.

> "The simplest way to meet the size requirement is to use a focus indicator
> which is a solid 2 CSS pixel thick perimeter."
> — WCAG 2.2 SC 2.4.13, <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html>

SC 2.4.11 also applies: a focused element must not be completely hidden behind
sticky chrome. The masthead is sticky, so anything scrolled to by keyboard
needs `scroll-margin-top` clearing it.

### 2.2 States

Dark mode: **lighter on hover, lighter still on press.** Fluent notes that
Windows native reverses this; on the web, lighter-on-hover is the convention.

| State | Treatment |
|---|---|
| hover | surface moves one step up, or text moves one step brighter |
| active/pressed | surface moves two steps up |
| selected | accent border or underline, plus a non-colour cue |
| disabled | `--text-disabled`, `cursor: not-allowed`, and never the only copy of information |

A hover state must never be the *only* way to discover something. The indicator
cards reveal a `→` on hover; that is decoration, and the card is a link
regardless.

---

## 3. Data visualisation

This is a data-journalism site, so the chart rules are editorial rules, not
decoration rules. They matter more here than anything above.

### 3.1 Never interpolate across missing data

> "Never interpolate between periods when data is unavailable. Always label
> both the start and end point during which data is not available."
> — <https://carbondesignsystem.com/data-visualization/axes-and-labels/>

Recharts' `connectNulls` draws a straight line across a gap, inventing readings
that were never published. Our World in Data goes further and renders a
distinct hatched pattern for no-data regions rather than leaving them
ambiguous. On this site a gap is a gap.

### 3.2 Colour is never the only encoding

> "Color is not used as the only visual means of conveying information."
> — WCAG 2.2 SC 1.4.1 (Level A), <https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html>

The Baltic comparison chart drew Latvia in sky, Estonia in emerald and
Lithuania in amber. Under deuteranopia — around 8% of men — emerald and amber
converge. Three lines, two of which a substantial minority of readers could not
tell apart, with a legend that keyed on nothing but colour.

The palette is now **cyan / amber / pink**, which are separated in hue in a way
that survives the common confusions, and every series additionally carries a
**stroke pattern** (solid / dashed / dotted). Carbon prefers direct labelling
over a legend, and the latest value for each country is shown inline in the
panel header, coloured to match.

### 3.3 The y-axis

> "Always start numerical axes at zero for part-to-whole and comparison charts,
> such as bar and area chart. Truncating the Y axis can distort the perception,
> making a small difference look big and significant." ... "Line charts and
> scatter plots are less sensitive to this distortion."
> — <https://carbondesignsystem.com/data-visualization/axes-and-labels/>

So: **bars and filled areas start at zero; lines may be cropped.** A series that
crosses zero — anything measured as a percentage change — gets an explicit zero
reference line, because on those series zero is the most important value on the
chart and it was previously unmarked.

### 3.4 Gridlines recede, data dominates

Gridlines are structure, not data, and are deliberately below the 3:1 non-text
threshold — Carbon's own gridline token sits at about 1.8:1. They must, however,
come from the theme: `#1e293b` was hardcoded in three chart components while a
`chartColors.grid` token sat unused two lines away, so in the light theme the
gridlines rendered near-black on white.

Aim for **5–8 y-axis ticks**, fewer on mobile.

### 3.5 Direction is not sentiment

The most important rule on this page.

Every indicator card coloured a rise green and a fall red. So rising
unemployment was green. Rising inflation was green. Rising government debt was
green. The dashboard was, silently and on every load, editorialising in the
wrong direction.

Financial UIs get away with green-up because they show *prices*, where up is
unambiguously good for a holder. Macro statistics are not prices. The FT's own
charts use a neutral series colour and let the reader judge.

Therefore each indicator declares a **polarity**:

| Polarity | Meaning | Treatment |
|---|---|---|
| `lower-better` | unemployment, inflation, PPI, government debt | a fall is `--data-positive` |
| `higher-better` | GDP, wages, employment, renewable share, exports | a rise is `--data-positive` |
| `neutral` | population, house prices, imports, vehicle registrations, government revenue | **no sentiment colour at all** |

`neutral` is the default, and it is the right default. Whether rising house
prices are good news depends entirely on whether you own one, and it is not the
dashboard's job to decide. Neutral indicators show the direction with an arrow
and a sign, in `--text-secondary`.

The **series line itself is never sentiment-coloured.** It used to be: the
sparkline took its colour from the sign of the final data point, so an entire
ten-year series turned red or green according to one quarter. Series get a
neutral colour; only the delta chip carries meaning.

### 3.6 Numbers

- **Tabular figures everywhere a number can change or align.**
  `font-variant-numeric: tabular-nums`. Our World in Data additionally sets
  `lnum` for lining numerals — worth having, since old-style figures in a table
  are a mess.
- **Always signed.** A delta shows `+` or `−` explicitly, plus `▲`/`▼`. Colour
  is the third encoding, never the first.
- **Use a real minus sign** (`−`, U+2212), not a hyphen. A hyphen is
  narrower than a digit and breaks column alignment even in a tabular face.
- **Abbreviate in house style**: `bn` and `tn`, lower case, no space — the FT
  and Reuters convention, not the American `B`/`T`.
- **Fixed decimal places within a column.** `1.20` and not `1.2` when its
  neighbour is `1.25`.

### 3.7 Attribution

Every chart and every table names its source, immediately beneath, in
`text-caption` at `--text-tertiary`. Our World in Data renders exactly this at
12–13px, and it is the element that makes the difference between a chart and a
picture of a chart.

Where a series is stale, say so and date it. Where it is unavailable, render
`—` and the word "Unavailable", never `0`.

---

## 4. Editorial layout

### 4.1 The front page

- One lead, at `text-display`, in a bordered panel.
- Everything below it is a divided list, not a grid of cards. Rules between
  items, no boxes — the Guardian's "container" model.
- The section rail is secondary and visually quieter than the main column.

### 4.2 The article

- The reading column is `max-w-measure` (38rem ≈ 68 characters at 18px).
  Bringhurst puts a comfortable line at 45–75 characters; WCAG SC 1.4.8 caps a
  block of text at 80. The Guardian's centre column is 620px, the NYT's about
  600–620px, and the FT's about 680px, so this sits deliberately at the tighter
  end because our prose is dense with figures.
- Standfirst at `text-lead`, `--text-secondary`, narrower than the body.
- Byline, timestamp and AI disclosure travel together and are never separated.
- A chart embedded in an article always links to the same series on `/data`.
  The article's claim and the reader's ability to check it are one object.

### 4.3 The dashboard

- Page `h1` at `text-display`, sections at `text-title`. Both halves of the
  site open the same way.
- **A panel title is `text-callout`, not a 12px uppercase micro-label.** The
  dashboard headed its panels with text smaller than the content inside them,
  which is the same inversion the type pass fixed one level up and left here.
- Density is compact by default: this is a terminal, and Carbon's condensed
  row heights (32–40px) are the model.

---

## 5. What the tests enforce

`tests/typography.test.ts` and `tests/design-system.test.ts` together assert:

- the type scale exists, ascends, has sane ratios and line heights, is in `rem`,
  and no step collides with a colour variable of the same name;
- one font family, no third-party font requests, and no font named that is not
  actually served;
- no arbitrary sizes, no Tailwind default ramp, no inline px `fontSize`;
- **two weights** — no `font-medium`, no `font-bold`, no inline `fontWeight`
  other than 400 and 600;
- spacing, gap and radius classes are on the allowlists in §1.2 and §1.3;
- every text token clears its contrast floor in **both** themes;
- a global `:focus-visible` rule exists, is at least 2px, and no component
  disables an outline without replacing it;
- `prefers-reduced-motion` is honoured, and nothing animates `all`;
- charts do not hardcode a hex colour that a theme token already provides, and
  do not use `connectNulls`.

Contrast is computed, not eyeballed. If you change a colour, the test tells you
what ratio you actually shipped.

---

## 6. Two traps in the CSS

Both are namespace collisions with Tailwind v4, both were found by reading
`dist/` rather than source, and both fail silently.

**`--text-*` is two things.** Tailwind reads that namespace as the font-size
scale, and `:root` in `index.css` also defines `--text-primary`, `--text-body`
and friends as *colours*. The colours are emitted after `@theme`, so they win:
a size step named `--text-body` resolves to `#c8d1dc`, which is not a length,
and the utility silently does nothing. That is why the editorial step is
`--text-prose`. `tests/typography.test.ts` asserts no step ever collides again.

**`@theme` entries are tree-shaken.** A token declared there that no generated
utility uses may not reach the built stylesheet at all — `--radius-card` did
not — so `var(--radius-card)` worked in dev and resolved to nothing in
production. Anything meant to be read by hand-written CSS belongs in `:root`.
The rule of thumb: if a `var()` in this file is the only consumer, declare it
in `:root`.

After a change to the token layer, check what actually shipped:

```powershell
npm run build
Select-String -Path dist\assets\*.css -Pattern '--corner-card:|--focus-ring:'
```

---

## 7. Known gaps

Honest list of what this book describes but the site does not yet fully do.

1. **Light theme is a set of overrides, not a designed theme.** It works and it
   now passes contrast, but it is built from `!important` rules that reach into
   Tailwind's generated slate classes. It should be token-driven like the
   newsroom surfaces already are.
2. **The chart palette exists twice** — as `--series-*` in `index.css` and as
   literals in `ThemeContext`. Recharts writes colours into SVG presentation
   attributes where jsdom will not resolve `var()`, so the literals are needed;
   `tests/design-system.test.ts` compares the two so they cannot drift, but one
   source would be better than two guarded ones.
3. **No density toggle.** The dashboard is compact by assertion, not by a
   switch a reader can throw.
4. **No `@media (prefers-contrast: more)` path**, and no forced-colours pass.
5. **Charts have no keyboard or screen-reader story.** Recharts renders SVG
   with no accessible table equivalent. Every chart should be a `<figure>` with
   a real caption and a visually-hidden data table.
6. **Missing data is a gap, not a labelled gap.** Carbon asks for the start and
   end of an unavailable period to be labelled, and Our World in Data hatches
   the region. We stop at not interpolating.
7. **No motion on data updates.** When a value changes, nothing says it changed.
8. **Renaming the colour tokens to `--fg-*`** would end the first trap above
   for good. It touches every dashboard component, so it is its own change.

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

**Layout must never depend on the animation running.** Honouring the setting is
half the rule; the other half is that the still version has to be a correct
page.

The ticker is ~3300px of `max-content` inside a 1226px box with
`overflow: hidden`. That clips it, and every ancestor measures
`scrollWidth === clientWidth`, so the containment looks right all the way up.
It was not right: `document.scrollWidth` was 3056 against a 1274px viewport, so
**every route — including every article — scrolled 1782px sideways into blank
space.** A visible scrollbar, on production, for months.

The cause is that a running marquee puts a `transform` on the track at all
times, and a transform creates a containing block that holds the overflow in.
So containment was a *side effect of the animation*. Turn the animation off and
it goes with it. The fix is `contain: paint` on the viewport, which states the
containment directly instead of arranging for it to be true by accident.

`transform: translateZ(0)` also fixes the measurement, and is the wrong answer:
it re-creates the coupling that caused the bug. A rule that restores the bug's
own precondition is a rescheduling, not a fix.

**The general rule, which is the part worth remembering: the reduced-motion
path is the one nothing exercises.** The only people who could see this were
the people who asked the page to stop moving — so the failing branch was the
accessible one, and the reporters were the readers least likely to be
generating bug reports about a layout they cannot see working. Nothing on this
site had ever been rendered with the preference on until it was checked
deliberately, and the first check found a bug on every route within minutes.

Verify motion-dependent layout **with the preference on**, in a real browser.
jsdom does not lay out, so a unit test cannot see this class at all; the check
lives in the live suite, and it asserts that the preference actually took —
otherwise a run where the emulation silently failed reports a pass.

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

**A state has to have somewhere to go.** `--bg-raised`, `--bg-card-hover` and
`--bg-input` all held the same value, so "surface moves one step up" was
describing something that could not happen: a control resting on `--bg-input`
hovered to the identical colour. The table above was true of cards, which rest
on `--bg-card`, and quietly false of every control. `--bg-control-hover` is the
step that makes the row true, and `design-system.test.ts` asserts rest and hover
differ in both themes rather than trusting the prose.

**Write control states as CSS, not as Tailwind variants.** `disabled:dash-raised`
looks like it works and is never emitted at all — Tailwind only generates a
variant of a utility it owns, and `dash-raised` is hand-written here. Nothing
warns; the class sits in the markup looking load-bearing. That is how the
beneficial-owner search button came to render identically enabled and disabled.
States belong beside the control, as `.dash-btn:hover:not(:disabled)` and
`.dash-btn:disabled` — rules that either exist or do not. A test scans every
component for a Tailwind variant applied to a project-owned class.

**A state rendered when it is not true is the same defect as a value rendered
when there is no data** (§3.8), with the sign flipped. The compatibility layer's
`[class*="bg-slate-800"]` matched the substring inside `hover:bg-slate-800/30`,
so every indicator row on `/data` was painted in its own hover colour *at rest*,
with `!important` — the affordance was dead, and hovering changed nothing. The
same selector caught `disabled:bg-slate-800`, so an **enabled** button wore its
disabled colour, which does not merely fail to inform but actively misinforms.
Measure states in the browser by driving them: rest, hover, disabled, and assert
they differ.

**When a band names an external scale, check the names against the scale and not
only the numbers.** `classifySeaState` split on 0.1, 0.5, 1.25 and 2.5 metres —
the WMO sea state code boundaries, exactly right, clearly copied from the scale —
and then labelled every band one degree too high, so 0.1 m read "Slight" when the
scale says Smooth and 2.5 m read "Very Rough" when the scale says Rough. Measured
against 8928 hourly readings from the four Latvian ports, 92% of observations
carried a label one degree more alarming than the standard, and "Very Rough" —
degree 6, which opens at 4 m — fired a metre and a half early on a sea that has
never reached it. The thresholds being right is what made it invisible: the
numbers audit cleanly, and only the words are wrong. Cite the scale in the test,
as a table, so the specification is the thing under assertion.

That prompted an audit of every band on the site that names an external
standard, and it found a second one pointing the other way. **Air quality fetched
Europe's index and banded it with America's thresholds**: `european_aqi` is the
EEA/CAMS index, six bands at 20/40/60/80/100, and both call sites split it at the
US EPA's 50 and 100 into Good / Moderate / **Unhealthy** — an EPA word the
European scale does not use. Over 6696 hourly readings from the three capitals,
**76.1% named the air better than the European scale does and 0.0% named it
worse**; 5050 readings the EEA rates *Fair* were called "Good". A scale that only
ever errs towards reassurance is worse than one that errs both ways, because
nothing about it ever looks alarming enough to check.

The rest of the audit came back clean, which is worth recording so it is not
repeated: the power card has no severity bands at all, and `freshness.js`'s
cadence names match Eurostat's own `freq` codes.

**Derive a claim from the number you print, not from a band beside it.** The
insight card printed a PM2.5 figure and asserted "Well below WHO guidelines" in
the same sentence — but the assertion was read off the AQI band, not off the
figure. Sampled over 6696 paired readings, PM2.5 exceeded the WHO 24-hour
guideline of 15 µg/m³ eight times, and on **all eight** the line still said "well
below", printing 16.9 µg/m³ and calling it well below 15. A sentence that cites
one number and concludes from another will contradict itself the moment they
diverge, and it will do it in prose rather than in a chart, where nothing checks.

**Two encodings of one value must claim the same granularity.** The sea state
drew five bands in three colours while its emoji showed five steps, so colour and
emoji contradicted each other on the page; the air-quality meter drew three
segments and said "Band n of 3" while its scale had six, so the meter understated
the range as surely as the label understated the reading. Either grouping is
defensible on its own; disagreeing is not, and a hardcoded count is how the
disagreement gets in. `seaState.test.ts` and `airQualityBands.test.ts` each
assert the two encodings group the *same* bands rather than merely the same
number of them, and that the ramp never doubles back — a severity scale that
reverses says a rougher sea is calmer.

**A token is tuned for one job and has no floor for another.** The ticker
separated its items with a `·` coloured `--border-card` — 1.54:1 in dark, 1.23:1
in light. A border token has no text contrast floor because nothing intended it
to be read, so borrowing it for text cannot pass. It was also redundant: the
track already puts 32px between items and the mark sat 8px from its own, reading
as a trailing artefact rather than a separator, so it was deleted rather than
recoloured. `--border-*`, `--chart-grid` and `--scrollbar-*` are now rejected as
`color:` by test. The same fault one category out is a chart-line colour used
for a 12px figure — see §3.6.
### 2.3 Measure it in the browser, not in the source

A standing caution, learned the expensive way on this project.

A static scan of the stylesheet measured the accent `#38bdf8` as a *foreground*
against the page — 6.91:1, comfortably passing — and concluded the token was
fine. It was being used as a **fill**, with white text on top, at **2.56:1**,
and that was the selected state of the country switcher, the date range and the
chart period. No amount of reading the CSS finds that; only asking a live page
what it actually computed does.

So: before claiming a contrast fix, open the page and read
`getComputedStyle()`. The same applies to `:focus-visible`, which cannot be
observed at all in a browser whose window is not focused — `document.hasFocus()`
returning false means every element reports no outline, and that is the harness
lying, not the CSS failing.


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

The palette is now the flags (§3.6), every series additionally carries a
**stroke pattern**, and the latest value for each country is direct-labelled in
the panel header in its own colour — which Carbon prefers over a legend anyway.

**Status bands need the same treatment, and a glyph is not enough on its own.**
Air quality is drawn on `--data-positive` / `--data-warning` / `--data-negative`,
and green against red measures **ΔE 8.3** under deuteranopia in the dark theme —
indistinguishable. In light, moderate against unhealthy is **23.1**, also under
the 25 floor. A ✓/!/✕ glyph at 14px was the only other channel.

So a band also carries its **ordinal position**: three segments, filled up to
the current band, with "Band 2 of 3" beside them. Position survives every
colour vision and greyscale, and it suits the data — air quality is ordered
rather than categorical, so the reader learns *how bad* and not merely *which
colour*.

**A ranked bar does not need five hues.** The port and cargo bars used cyan,
teal, emerald and two greys for series whose rank is already carried by bar
length. Hue variety bought nothing and cost legibility: `bg-slate-400` measured
2.63:1 on a white card, and three of the five had no rule in the compatibility
layer at all. They are now `--cat-1` … `--cat-5`, one hue in five lightness
steps, every step measured above 3:1 on its own card, `--cat-1` always the most
prominent in both themes.

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

That has a corollary the site had to learn from a reader. Some series barely
move: population shifts well under 1% across a five-year window, and drawn as a
zero-based fill it is a dead flat line pinned to the top of the card, which
reads as a rendering failure rather than as a slow decline. The rule is
therefore general rather than a special case for population — **a series whose
whole range is under 2% of its own level drops the fill, becomes a plain line,
and is allowed to crop**, which is the one form in which cropping is
legitimate. The crop is then *disclosed* on the card ("Axis cropped to
1.86m–1.88m"), which is what Our World in Data does and the difference between
a cropped axis and a misleading one.

Watch the library defaults here. Recharts' implicit y-axis is `[0, 'auto']`, so
a chart with no explicit `<YAxis>` is already zero-based whether or not anyone
decided it should be.

### 3.4 Gridlines recede, data dominates

Gridlines are structure, not data, and are deliberately below the 3:1 non-text
threshold — Carbon's own gridline token sits at about 1.8:1. They must, however,
come from the theme: `#1e293b` was hardcoded in three chart components while a
`chartColors.grid` token sat unused two lines away, so in the light theme the
gridlines rendered near-black on white.

Aim for **5–8 y-axis ticks**, fewer on mobile.

### 3.5 Direction, and where it stops being neutral

Every indicator card colours its change: **green for a rise, red for a fall.**
That is what a reader scanning a dashboard for momentum expects, and a
dashboard that cannot be scanned has lost the only reason to open it.

With one exception, and it is the one that matters. Twelve series are worse
when they rise — unemployment, every inflation measure, producer prices,
government debt, the gas price, bankruptcies. On those the colours **flip**: a
fall is drawn green because a fall is the good news. Without that flip the
dashboard renders rising unemployment in green, which is editorialising,
silently, in the wrong direction, on exactly the series a reader most cares
about.

So each indicator declares a **polarity** in `src/utils/polarity.ts`:

| Polarity | Examples | Rise is drawn |
|---|---|---|
| `higher-better` | GDP, wages, exports, renewables | green |
| `lower-better` | unemployment, inflation, PPI, debt, gas price | **red** |
| `neutral` | house prices, population, imports, gov revenue, vehicles | green |

`neutral` is the default and is coloured by direction like everything else.
Green there means *went up*, not *good* — and the arrow and the sign say so
without any colour at all. The test for putting an indicator in one of the
first two rows is whether a finance ministry, a trade union and a central bank
would all agree on the sign. Where they would not, it stays neutral.

**Colour is the third encoding, never the first.** `--data-positive` and
`--data-negative` are green and red, which under a Brettel deuteranopia
simulation measure **ΔE 8 apart** — indistinguishable for roughly 8% of men.
The ▲/▼ glyph, the explicit `+`/`−` sign and a screen-reader description are
what actually carry the direction (WCAG 2.2 SC 1.4.1). None of them is
optional.

The **sparkline follows the same rule as the delta**, so a card reads as one
statement rather than a green number above a red line. What it must never do
again is take its colour from the raw sign of the last data point, which is how
a decade of falling unemployment came to be drawn in red.

**So does the ticker.** It used to render every delta in flat grey, on the
stated grounds that it "cannot know whether a rise in an arbitrary indicator is
good news". That was true when it was written and stopped being true the moment
`polarity.ts` existed — the indicator cards had been reading direction by
meaning for some time and the ticker was simply never given the same treatment.
It is not a licence to go back to the older behaviour of colouring every `+`
green; it is the same honest rule applied in one more place.

**A number with no comparison has no direction, and therefore gets no colour.**
"Suspended activities: 3,693" was drawn in amber. Amber is a *status* colour —
Fluent's rule is "use them for important messages, don't use them for
decoration" — and a steady-state registry total that has been the same order of
magnitude for years is not a warning. Colouring it told the reader "this is
bad" on no evidence, which is this section's defect applied to a single number
instead of to a chart.

### 3.6 The country palette is the flags

Latvia carmine, Estonia blue, Lithuania yellow. A reader who knows the flags
never has to consult a legend, which is the cheapest legibility win available
on a three-country chart.

| | Dark | Light |
|---|---|---|
| Latvia | `#dc3b4a` | `#e6414e` |
| Estonia | `#4da6ff` | `#1a7ae0` |
| Lithuania | `#fdb913` | `#c28206` |
| Finland *(bidding zone only)* | `#f0abfc` | `#8b1a9c` |

Four measured constraints produced those exact values.

1. **Raw flag colours fail.** Latvian carmine `#9E3039` is 2.40:1 on a card and
   Lithuanian green `#006A44` is 2.87:1, both under the 3:1 SC 1.4.11 asks of a
   graphical object. They are lightened until they pass.
2. **Lithuania is yellow, not green.** Against Latvian carmine, flag green
   measures **ΔE 6** under deuteranopia — total convergence, so around 8% of men
   could not tell Latvia from Lithuania. Yellow measures ΔE 52.
3. **Latvia must not be the same red as "declining".** At `#e4707a` it sat
   **ΔE 8.6** from `--data-negative` — the same colour — and red would have meant
   both *Latvia* and *falling* on one screen, which is the three-meanings defect
   this book exists to remove.

   The value that shipped is **ΔE 13.9** in light and 22.7 in dark. That light
   figure is the tightest separation in the whole palette — every *series* pair
   is 26 or more — and it is recorded here rather than left implicit because
   the rejected 8.6 above is the only reason anyone thought to measure it. It
   is a deliberate trade: constraint 4 caps gold near `L* 60`, Latvia has to
   stay clear of gold under deuteranopia, and that pins it into a band which
   happens to sit near the negative red. If a future change loosens any of
   those three, this is the number to re-open. The floor the test enforces is
   12.
4. **3:1 is the floor, not the target.** The first light palette answered
   constraint 1 by pushing all three to about **7:1** — `#a4262c`, `#0057a8`,
   `#b4700a` — which is AAA *text* contrast applied to a line. Readers reported
   the light charts as dark and muddy and they were right: `#b4700a` reads
   brown, not gold. The values above are the brightest that still clear 3:1 on
   a white card, and they are **14–16 L\* lighter** than the ones they replace:

   | | Contrast on white | ΔE under deuteranopia |
   |---|---|---|
   | Latvia `#e6414e` | 4.01:1 | LV–EE 109 |
   | Estonia `#1a7ae0` | 4.28:1 | EE–LT 135 |
   | Lithuania `#c28206` | 3.24:1 | LV–LT 26 |

   Gold is the binding constraint in the light theme, not red or blue. Yellow
   is intrinsically light, so on white it cannot be both vivid and 3:1 — about
   `L* 60` is the ceiling, and Latvia then has to stay far enough below it to
   survive deuteranopia, where red and gold both collapse toward yellow and
   only lightness separates them.

Contrast cannot express "too dark" on its own, because in a dark theme brighter
means *more* contrast and in a light theme it means less. So the test asserts
**L\* ≥ 45** for the three Baltic series in both themes. The old light palette
sat at 37.

Finland is deliberately **not** a flag colour: its flag is blue, which is
Estonia's. It appears only as a Nord Pool bidding zone, never as one of the
three Baltic states. It used to be violet and is now fuchsia in both themes,
because a brighter Estonia crowded the violet down to ΔE 23 — under the
threshold. That is the second-order cost of constraint 4, and the reason the
whole palette is chosen together rather than one series at a time.

**Stroke patterns stay** — Latvia solid, Estonia `8 5`, Lithuania `18 6` — even
though the hues are now well separated. That is measured, not cautious:
between-series *luminance* contrast is only 1.19–1.76:1, well under the 3:1 at
which WCAG's note on SC 1.4.1 lets lightness count as a second distinction. Hue
is therefore the only other channel, and hue alone is precisely what the
criterion forbids. The dash is the second channel, and it survives greyscale
printing too.

They are quieter than they were. Lithuania used to be `2 4` — two on, four off
— which at a 2px stroke is not a dashed line but a dot every six pixels, and
over a dense multi-year series it read as texture rather than as a series. The
power chart had the same `2 3`, plus an `8 2 2 2` that read as morse code. A
mark **at least 6px long and never shorter than the gap after it** is the
difference between a dashed line and a row of dots, and the test enforces it.

Lines are drawn at **2–2.5px**, not 1.5px. At hairline weight on a dark ground
chroma perception collapses and two warm hues read as one colour — which is
what "the red and the orange are hard to tell apart" actually meant.

**A series colour never touches text.** The palette is tuned to clear SC
1.4.11's 3:1 as a *line*, and a hue sitting just above that floor cannot also
clear SC 1.4.3's 4.5:1 as text under 24px — the two are not satisfiable in one
value at these hues. Measured against the real card surface across both themes
and eleven routes, **328 of 496 series-coloured text nodes failed the floor
that governed them**:

| token | hex | on card | as text (4.5) | as a line (3.0) |
|---|---|---|---|---|
| `--series-lt` light | `#c28206` | 3.24 | **fail** | pass |
| `--series-lv` dark | `#dc3b4a` | 3.90 | **fail** | pass |
| `--series-lv` light | `#e6414e` | 4.01 | **fail** | pass |
| `--series-ee` light | `#1a7ae0` | 4.28 | **fail** | pass |

Brightening them is the wrong repair twice over: it would undo constraint 4
above, and moving Latvia up walks it toward `--data-negative`, collapsing the
ΔE 13.9 that keeps "Latvia" distinguishable from "this got worse".

So the colour **moves rather than changes**. It was carrying something real —
which line in the chart belongs to this reading — so the value goes to
`--text-primary` and a `SeriesSwatch` beside it takes the hue, at the 3:1 floor
the palette actually meets. The recharts legend already worked this way.

**The flag emoji cannot do the swatch's job.** Segoe UI Emoji ships no
regional-indicator glyphs, so on Windows `🇱🇻` renders as the letters "LV" in
the *text* colour: an identifier that carries none of the country's hue.
Deleting the colour outright would have left a Windows reader with no way to
match a label to a line at all. Verified by screenshot, not assumed.

**Known and unfixed: gold on a raised surface.** The light 3:1 was verified
against the white card, and the ranked-comparison and modal-split bars are not
on the card — they sit in a `--bg-raised` track:

```
--series-lt #c28206   on --bg-card   #ffffff   3.24:1  pass
                      on --bg-page   #f6f8fb   3.04:1  pass
                      on --bg-raised #f1f5f9   2.95:1  FAIL
                      on --bg-sunken #eef2f7   2.88:1  FAIL
```

Only gold, only light, only those two surfaces — LV, EE and FI clear raised at
3.66, 3.91 and 7.03, and every dark value clears it. It is the same fault as
the one above, one level out: **a floor verified against one background and
then used against another.** It is recorded rather than fixed because the fix
is a decision: darkening gold until it clears 3:1 on `--bg-raised` walks it
into `--data-warning` (`#a16207`), trading a marginal contrast failure for a
semantic collision. `tests/seriesContrast.live.test.ts` names it explicitly, so
it stays visible and a *new* offender still fails.

### 3.7 Numbers

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

### 3.8 Attribution

Every chart and every table names its source, immediately beneath, in
`text-caption` at `--text-tertiary`. Our World in Data renders exactly this at
12–13px, and it is the element that makes the difference between a chart and a
picture of a chart.

Where a series is stale, say so and date it. Where it is unavailable, render
`—` and the word "Unavailable", never `0`.

**Absence is never rendered as a value.** This is the rule the site has broken
in three different directions, which is why it is written down rather than
assumed:

| Component | Absent data rendered as | Because |
|---|---|---|
| `classifySeaState` | **"Very Rough"** — a storm, in red | every `<` is false for `NaN`, so a missing wave height fell past the whole chain to the final `return` |
| air quality | **"Good"** — clean air | `AQI_STYLES.good` was the fallback for an unrecognised status |
| EU funds bars | **"all statuses equal"** | a zero total made every width `Infinity`, which CSS drops silently |
| port wave forecast | **a full-height bar** | `(null / peak) * 100` is `NaN`, and CSS drops `height: NaN%` and leaves the container's height |
| cargo mix bars | **"all cargo types equal"** | `Math.max` and `reduce` both propagate `NaN`, so one absent weight set *every* width to `NaN%` and every share to "0.0%" |

Three components, three different plausible answers, one cause. A default that
looks like data is worse than a crash, because a crash is at least visible —
and each of these was found by accident rather than reported, precisely because
it looked like a considered result.

The fourth row was found *after* this rule was written down, in the same
component as the first, by the same mechanism as the third — so writing the rule
did not find the instances that already existed. The port card also guarded its
wave height through `classifySeaState` and then called `.toFixed(1)` on that same
value one line later, which would have printed "Sea state unavailable" and
thrown while rendering it. Grep for the mechanism, not the component.

The fifth was found by doing exactly that, and it is the worst of them: **one bad
item destroyed every good one**. `Math.max(...)` and `reduce` are both poisoned
by a single `NaN`, so a cargo category arriving without a weight made `total` and
`max` NaN, and then every row — including the well-formed ones — printed "0.0%"
(because `NaN > 0` is false) and got `width: NaN%`. A trailing `, 1` on the
`Math.max` looks like it guards this and does not: it stops a division by zero
when every weight is zero, and `Math.max(NaN, 1)` is NaN. **Filter before you
aggregate**; a floor after the fact cannot rescue an aggregate that is already
NaN.

The same sweep found `valueAt` filtering on `value !== null`, which `NaN`
passes — so `PortBars` had the identical flaw one call away. That one is fixed at
the single function every port panel reads through rather than at each bar,
because the aggregate is the thing that has to be clean.

`src/utils/payload.ts` is the general answer: `list()` yields nothing to draw
and `finite()` yields `null` to render as a dash, and neither invents a number.
`finite()` also refuses `'42'` rather than coercing it, because a field that
silently became a string is something to notice, not to absorb. Note what `list()`
does **not** do: `Array.isArray(value) ? (value as T[]) : []` validates the
container and *casts* the contents, so an element type is a compile-time claim
about a payload we did not write. Every one of the last three rows in that table
was inside a boundary `list()` had already passed.

**Zero is a reading; absent is not.** A bar for a genuine zero draws nothing,
because the minimum-visible-width floor exists to keep a small *real* quantity on
screen and lending it to zero draws cargo that does not exist. A row with no
reading at all shows an em dash for both its share and its quantity, and is
excluded from the total — "we do not know" and "none of it" are different claims
about a port.

### 3.9 Two components can take down the whole site

`Header` and `DataTicker` are rendered by `SiteLayout`, which wraps **every**
route — the newsroom included. `App` gives each dashboard section its own error
boundary, so a tile that throws costs one tile; these two sit outside all of
them, and a failure in either removes the articles as well as the dashboard.

So a field read added in those two files is not the same as one added in a
tile, and a contributor has no way to know that from the code. Treat any new
payload access there as needing a guard by default.

`SystemStatusFooter` was in the same position and demonstrated the point: the
component whose entire job is to report an outage was able to remove the site
while doing it.

This is also the reason the masthead is **not** sticky. Making it so would put
130px of dashboard chrome above every article — a fifth of a phone viewport,
permanently — and deepen the colonisation described in §7.4. The dashboard's
own section rail costs 44px and appears only where there is something to
navigate.

### 3.10 A handler's scope is part of its correctness

A `try`/`catch` or a `.catch` is not judged only by whether it handles the
error. It is judged by **how much it discards** — and a handler that is
correct in itself can be wrong in what it spans.

`DataTicker` fetched one payload and built three independent things from it in
a single `.then`: the electricity price, four exchange rates, and the
indicators. One unguarded read threw, the chain's single `.catch` swallowed
it, and all three went. The ticker never looked broken; it looked like there
was no data, which is why it went unreported for so long even though it sits
above every route.

**Fixing the reads is not fixing the scope.** #100 replaced those reads with
`finite()` and `list()`, and the ticker still emptied completely when a single
`null` appeared inside `d.indicators` — because `list()` validates the
container and casts the contents, so the *next* unguarded read had the same
blast radius as the last one. Measured, not assumed: with one bad indicator the
rendered ticker was the empty string.

So the unit of failure has to be the smallest independent thing. An entry that
cannot be read costs that entry:

```ts
source.flatMap((entry) => {
  try { const item = build(entry); return item ? [item] : []; }
  catch { return []; }
});
```

Guard once at the boundary, not n times at each read inside the builder.

**Rank by blast radius, and check the coupling is not real before splitting
it.** A shared denominator poisons every row where a per-row one loses a
single bar (§3.8), and the same ordering applies here: a chain in `SiteLayout`
costs every route, one in a tile costs a tile. But `FreightModalSplit`
legitimately couples two fetches — a modal split computed from one mode is not
a partial answer, it is a wrong one — so a single `.catch` over the pair is
correct there and must not be "fixed". `App` and `IndicatorTable` already
attach a `.catch` to each call *before* `Promise.all` sees it, which is the
shape to copy.

One coupling is recorded and not fixed: `fetchAllWeather` uses `allSettled`
between ports but `Promise.all([marine, weather])` *within* one, so a port
whose air-temperature request fails loses its wave height too. Repairing it
means making `weather` optional on `PortCard`, which belongs to the maritime
work rather than here.

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
- headings descend, an `h2` is never `text-caption`, and each heading has more
  room above it than below;
- spacing, gap and radius classes are on the allowlists in §1.2 and §1.3;
- every text token clears its contrast floor in **both** themes;
- semantic and series colours clear 4.5:1 and 3:1 respectively, in both themes;
- **the Tailwind compatibility layer is resolved and measured, not just the
  tokens.** The layer remaps ~270 hardcoded colour classes with `!important`,
  and the token tests could not see any of it — so `.text-emerald-400` was
  pinned to `#059669` at **3.77:1** and both amber classes to `#d97706` at
  **3.19:1**, failing SC 1.4.3 on text, while the correct tokens sat unused two
  hundred lines above. The test now resolves each class through the cascade,
  follows the `var()`, and fails on the ratio it actually computes. It also
  fails on a status class the layer does not cover at all — four had none —
  and on a literal hex where a token belongs;
- **every hardcoded class in use has a rule, and the count only goes down.**
  `tests/colourRatchet.test.ts` fails on a class with *no* rule anywhere, which
  is the state the contrast tests are blind to; it holds a per-file budget that
  cannot grow, and a second check fails when a budget drifts above reality so a
  migrated file cannot keep its allowance. Its matcher includes the
  `/NN` opacity form, and a test guards that, because dropping it would leave
  every other check passing while covering strictly less;
- the three Baltic series stay at **L\* ≥ 45** in both themes, because contrast
  alone cannot express "too dark";
- a chart line is never the link accent;
- **the country palette survives a deuteranopia simulation** — every pair of
  Latvia, Estonia and Lithuania stays above ΔE 25, Latvia stays clear of
  `--data-negative`, and Finland stays clear of Estonia's blue;
- every series carries a stroke pattern as well as a hue, and every dash reads
  as a line rather than as a row of dots;
- polarity flips on all twelve `lower-better` series, and the ▲/▼ glyph, the
  sign and a spoken description are all present so colour is never alone;
- a global `:focus-visible` rule exists, is at least 2px, and no component
  disables an outline without replacing it;
- controls have a 44px minimum target;
- "back to the dashboard" goes to the dashboard;
- every chart carries `role="img"` and a described label, and the decorative
  ticker is `aria-hidden`;
- `prefers-reduced-motion` is honoured, and nothing animates `all`;
- charts do not hardcode a hex colour that a theme token already provides, and
  do not use `connectNulls`;
- the JS chart palette and the CSS tokens have not drifted apart.

Contrast and colour separation are **computed**, not eyeballed. If you change a
colour, the test tells you the ratio — or the ΔE — you actually shipped.

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
Several come from an independent `/impeccable` critique run against `src/App.tsx`
in a separate session, which scored the dashboard 23/40 and found things a
design-system audit does not surface because they are not token defects.

1. **Empty states do not distinguish causes.** One grey box is rendered for
   "upstream is down", "Eurostat does not publish this for Estonia" and "no
   observations in range". With the API unavailable `/data` becomes roughly
   12,000px of identical placeholders.
2. **Only Maritime discloses data age.** `freshnessOf()` reaches three
   components; eight tiles publish series that are routinely a quarter or more
   behind with no as-of stamp. On a product whose pitch is traceability, this is
   the credibility gap the newsroom closes and the dashboard reopens.
3. **`assumptions[]` is computed server-side and never shown.** Every dashboard
   figure should carry the passport the articles already have — dataset,
   retrieved-at, cube, assumptions.
4. **Dashboard chrome colonises the newsroom.** `SiteLayout` renders the
   11-tab dashboard header, the ticker and the country/year controls above every
   news route, and `NewsroomLayout` then adds a second nav whose "Latest" also
   points at `/`. The reader meets the dashboard before the journalism.
5. **Charts still have no data-table alternative.** They now carry `role="img"`
   and a described label, which is the floor, not the finish.
6. **Missing data is a gap, not a labelled gap.** Carbon asks for the start and
   end of an unavailable period to be labelled; Our World in Data hatches the
   region. We stop at not interpolating.
7. **Four tiles have no loading, empty or error state** — `EnergyTile`,
   `GovernmentTile`, `LabourTile`, `TradeTile`.
8. **Light theme is a set of overrides, not a designed theme.** It passes
   contrast, but the dashboard's remaining colours are `!important` rules
   reaching into Tailwind's generated slate classes. The layer is now
   *measured* rather than merely present — see §5 — and
   `tests/colourRatchet.test.ts` holds the count so it can only go down.

   **The neutral text ramp is migrated**: `text-white` and every `text-slate-*`
   are gone, replaced by `.dash-fg` / `.dash-body` / `.dash-muted` /
   `.dash-subtle`, and the rules that used to rescue them are deleted rather
   than left dormant. That took the debt from 273 instances to **133**.
   Surfaces, borders and status tints are what remain. The compatibility layer
   is deleted when the ratchet empties.

   Two things made the gap invisible for a long time. A contrast test can only
   measure a class the layer *claims*: thirteen classes had no rule at all,
   rendered as raw Tailwind in both themes, and ranged from 1.66:1 to 4.76:1 —
   including a text placeholder below the SC 1.4.3 floor. And a scan that stops
   at the numeric step matches `text-amber-400` but not `text-amber-400/80`,
   which Tailwind emits as a different class.

   A named class is not just tidier. `text-slate-400` means "the fourth grey"
   and stops being true the moment the background inverts; `dash-muted` means
   "quieter than the body text", which stays true in both themes — and, being
   *declared* rather than overridden, it is visible to the tests that measure
   it.
9. **The chart palette exists twice** — `--series-*` in CSS and literals in
   `ThemeContext`, because recharts writes into SVG attributes where jsdom will
   not resolve `var()`. A test compares them so they cannot drift, but one
   source would be better than two guarded ones.
10. **No density toggle, and no `prefers-contrast: more` path.**
11. **Renaming the colour tokens to `--fg-*`** would end the first trap in §6
    for good. It touches every dashboard component, so it is its own change.

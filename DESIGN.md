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

**The audit scoped itself too narrowly, and the third instance was outside it.**
It looked at *components* that band a value. `/api/ai-insights` bands prices in
prose, and prose was not searched — so the same defect sat one directory over
for another day. Measured against 5856 Latvian intervals across 62 days:

| Said | Fired on |
|---|---|
| "spike … significantly above normal" (`maxP > 100`) | **58 of 62 days, 93.5%** |
| "Below seasonal average" (`avg < 30`) | 12 of 62, against a statistic computed nowhere |
| "Within normal Baltic market range" | the `else` branch, asserted against nothing |
| "Euro strengthening against the dollar" (`> 1.12`) | **100% of the ECB's last 64 trading days** |

The median daily peak over that window was **168**, so the "spike" constant sat
*below the typical day* and called the ordinary exceptional — with advice
attached, on 93.5% of days. A severity that almost always fires carries no
information, and one that carries instructions teaches readers to ignore it.

**Where there is no published scale, derive the comparison or say nothing.** Sea
state had the WMO code and air quality had the EEA's; day-ahead power has no
equivalent, and that absence is exactly what invited a made-up constant. The
honest options are to compute the comparison from the series already held — a
trailing percentile needs no new data, only a wider `start` on a call already
made — or to state the figures and stop. "Peak €244/MWh, day average €130" is
true, useful, and needs no threshold. A named percentile also carries its own
basis, which a literal never can: "in the highest tenth of daily peaks over the
last 31 days" can be checked, and "significantly above normal" cannot.

**A direction is not a level.** "Strengthening" and "weakening" describe a
*change*, and that block fetched a single day's reference rate and held no
previous value — so no threshold could have made the claim supportable. The
calibration was wrong too, but the category error came first: check that the
data can answer the *kind* of question before arguing about where to put the
cut.

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

**A benchmark that does not share the scale is not a benchmark, it is a ruined
axis.** The EU27 line answers "is 6.8% good or bad", and it can only do that
where the EU figure is a weighted *average* of its members — a rate, a share, a
price, an index, a per-head figure. For an extensive total it is a *sum
containing* the three, one to two orders of magnitude larger: EU27 population is
about 449 million against Latvia's 1.85 million. Drawn on the same linear axis it
prices the axis in EU units and flattens Latvia, Estonia and Lithuania into one
line along the bottom, so the reference destroys the comparison the chart exists
to make. This is the same failure as a cropped axis, from the other direction —
one exaggerates a difference, this one erases it.

The remedy is not a second axis, which invites the reader to compare two
different scales as though they were one. It is to **withhold the line**:
`euAggregation` in `api/shared/indicators.js` states which kind each indicator
is, and `/api/baltic-compare` does not even request the EU slice for a total. A
chart with no benchmark already has to look intentional (§3.6), so nothing about
it renders — and an indicator that declares nothing is treated as a total, since
a missing line is a smaller loss than an unreadable chart.

**And the declaration is checked against the axis, because it is a taxonomy
standing in for a measurement.** Sixty-six indicators are classified by hand;
nothing in the sanity, coverage, freshness or cadence assertions can see a
wrong classification, because they all read the three countries and the mistake
lives in a fourth geography. So `src/utils/referenceScale.ts` measures the
thing itself — the height of the y-axis with the benchmark against without —
and the chart withholds any line that fails it, whatever the registry says.

Measured live over a five-year window, the two groups do not overlap and are
not close:

| | axis the three keep |
|---|---|
| the 11 `sum` cubes that carry an EU figure | 0.002 – 0.034 |
| the 42 `average` cubes | 0.541 – 1.000 |

Tourist arrivals, nights spent and air passengers — the three charts that
prompted the rule — keep 0.2%, 0.2% and 0.6%. The threshold sits in the empty
band between the modes rather than beside either edge.

Two clauses, because there are two ways to lose the axis and only one of them
is the benchmark's doing. A band can already be unreadable without it: life
expectancy spans 7.6% of its own zero-based axis, the employment rate 9.5%,
labour productivity 12.4%, with no EU line drawn at all — which is what a
zero-based axis does to a series living at 73–79. Withholding the benchmark
there widens nothing and costs a real reading, so the test is whether **the
reference is what pushed them under**, not whether they are under.

When a line is withheld the figure stays in the header, and the card says so.
An undisclosed omission is the same fault as an undisclosed crop above: the
reader has to be able to tell a benchmark that was withheld from one that was
never there.

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

**And on a `lower-better` series the card says so in words.** This section used
to claim the arrow was enough to resolve the ambiguity the polarity flip
creates. It is not, and a reader said so: *"some indicators do not represent the
trend with the colour — is the rate going up or down, not clear."*

The complaint is exact. Put two falling cards side by side — imports and
producer prices — and one draws a red ▼ while the other draws a green ▼. Both
are correct under the rule above. Neither tells the reader whether green means
*up* or means *good*, because on that one screen it means both. A 12px glyph
tinted the same colour as the number beside it does not read as an independent
channel; it reads as part of one coloured token.

So `polarityNote()` returns "Lower is better" for the twelve flipped series and
the card prints it under the value. Only those twelve need it: everywhere else a
rise is already drawn green, which is what an unprimed reader assumes anyway, so
a note would be noise explaining the obvious.

The general point is the one worth keeping. **A rule that is correct can still
be unreadable, and the fix for an ambiguity is usually to say the thing rather
than to encode it more cleverly.**

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

Latvia carmine, Estonia blue, Lithuania gold. A reader who knows the flags
never has to consult a legend, which is the cheapest legibility win available
on a three-country chart.

| | Dark | Light |
|---|---|---|
| Latvia | `#bf5259` | `#c07173` |
| Estonia | `#407cc0` | `#5580b4` |
| Lithuania | `#a67300` | `#9c761f` |
| Finland *(bidding zone only)* | `#9c5089` | `#96688c` |

**The axis that decides these is chroma, and it is the one nobody was
measuring.** Two generations of this palette were chosen against contrast,
lightness and colour-blind separation — three real constraints, all enforced by
tests, none of which pushes back on *saturation*. So the optimiser took all of
it. Measured against the maximum chroma sRGB can even produce at each hue and
lightness, the values this table replaces sat at:

| | Light | Dark |
|---|---|---|
| Latvia | 80% of gamut | 82% |
| Estonia | 93% | **100%** — the boundary exactly |
| Lithuania | 99% | 99% |

A reader reported the charts as painful to look at. That was not a preference;
it was an accurate description of a palette drawn at the edge of the display.
Datawrapper says it plainly — *"avoid bright, saturated colors"*, and *"if your
colors come close to 100% saturation and 100% brightness, it's likely your
colors are too colorful"* — and the affective-colour work behind that advice is
Bartram, Patra and Stone, CHI 2017.

The replacements sit at OKLCH chroma ≈ 0.10 (light) and ≈ 0.13 (dark), inside
the C 0.08–0.15 band that Our World in Data's line palette and Tableau 10 both
occupy. `tests/design-system.test.ts` now enforces a ceiling of 0.16, which is
a ratchet against the next well-meaning "make it pop" rather than a target.

**Nothing was traded away for it — the separations improved.**

| | Weakest deuteranopia pair | Latvia vs `--data-negative` |
|---|---|---|
| light, before | ΔE 26 | ΔE 13.9 |
| light, after | **ΔE 37** | **ΔE 37.8** |
| dark, before | ΔE 52 | ΔE 22.7 |
| dark, after | ΔE 36 | ΔE 19.3 |

That is worth dwelling on, because it is the opposite of what the earlier
reasoning assumed. Saturation was being spent as though it bought separation.
It did not: under deuteranopia red and gold both collapse toward yellow, so what
separates them is *lightness*, and chroma was pure cost.

The other constraints still hold and still have their reasons:

1. **Raw flag colours fail.** Latvian carmine `#9E3039` is 2.40:1 on a card and
   Lithuanian green `#006A44` is 2.87:1, both under the 3:1 SC 1.4.11 asks of a
   graphical object. They are lightened until they pass.
2. **Latvia must not be the same red as "declining".** At `#e4707a` it once sat
   ΔE 8.6 from `--data-negative` — the same colour — so red would have meant
   both *Latvia* and *falling* on one screen. The floor the test enforces is 12;
   the light theme now clears it at 37.8, where it used to scrape by at 13.9.
3. **3:1 is the floor, not the target.** An early light palette answered
   constraint 1 by pushing all three to about 7:1 — `#a4262c`, `#0057a8`,
   `#b4700a` — which is AAA *text* contrast applied to a line. It read as dark
   and muddy and the gold came out brown. Contrast cannot express "too dark",
   because in a dark theme brighter means *more* contrast and in a light theme
   it means less; lightness can, and the test asserts **L\* ≥ 45** in both
   themes.

Constraints 3 and the chroma ceiling are the two guard rails, and they point in
opposite directions on purpose: one stops the palette going muddy, the other
stops it going neon. The previous two revisions each satisfied one and violated
the other.

#### Why Lithuania is gold and not green

The old answer was that flag green sat **ΔE 6** from Latvian carmine under a
deuteranopia simulation — total convergence, so roughly 8% of men could not
tell Latvia from Lithuania — while yellow measured ΔE 52.

**That answer is now obsolete, and it was re-measured rather than repeated.**
Against the muted Latvia above, green separates *better* than gold does: ΔE 44
versus 37 in the light theme, 53 versus 36 in dark. The old figure was a
property of the old carmine, and this book had explicitly invited the question
to be re-opened if the palette moved. It moved.

Green is still not available, for a different and harder reason. Lithuania's
flag green `#006A44` is hue 160, and green is intrinsically mid-lightness: on a
white card it has to go dark to clear 3:1, which walks straight into the L\* ≥ 45
floor that exists *because* readers called an earlier palette muddy. Scanned
across the whole green range at this palette's chroma, the light theme yields:

| Hue | Legal candidates |
|---|---|
| 128 (lime) | 87 |
| 132 | 47 |
| 136 (olive) | 10 |
| 140–172 | **0** |

Nothing at all at the flag's own hue. Green survives in the light theme only as
olive, which does not read as the Lithuanian stripe, and a country cannot be
olive in one theme and green in the other.

And green already means something here. `--data-positive` colours every delta
and every sparkline that moved the good way, so a green *country* line would be
a third meaning for one colour — which is the defect this section exists to
remove, wearing a different hue.

Finland is deliberately **not** a flag colour: its flag is blue, which is
Estonia's, and the two collide at ΔE 3 under deuteranopia. It appears only as a
Nord Pool bidding zone, never as one of the three Baltic states, and it is the
series that most constrains the rest — at low chroma, fuchsia collapses toward
blue, so it is separated by lightness instead, which is free.

**A second, non-colour encoding is mandatory** — Latvia solid, Estonia `8 5`,
Lithuania `18 6` — even though the hues are well separated. That is measured,
not cautious: between-series *luminance* contrast is only 1.19–1.76:1, well
under the 3:1 at which WCAG's note on SC 1.4.1 lets lightness count as a second
distinction. Hue is therefore the only other channel, and hue alone is precisely
what the criterion forbids.

**Which encoding is now the reader's choice**, because the two trade against
each other and neither is right for everyone. A dashed line survives greyscale
printing, which a marker does not; but over a dense multi-year series a dash
reads as texture rather than as a series, which is why Highcharts' accessibility
guidance prefers shape for line charts. So `StrokeStyle` in `FilterContext`
offers:

- `patterned` *(default)* — the dash patterns above.
- `plain` — solid strokes, each line ending in a distinct shape: circle for
  Latvia, square for Estonia, triangle for Lithuania. The marker is drawn only
  at the last observation, because 60-odd monthly points across three series is
  186 shapes on a 250px panel, which is worse than either problem it solves. It
  sits on the last *observation* rather than the last column, since the three
  countries do not publish on the same schedule.

The setting may not remove the second channel, only swap it, and
`tests/design-system.test.ts` asserts that: a `plain` mode that merely deleted
the dashes would be a preference that turns off accessibility.

The patterns are quieter than they were. Lithuania used to be `2 4` — two on,
four off — which at a 2px stroke is not a dashed line but a dot every six
pixels, and over a dense multi-year series it read as texture rather than as a
series. The power chart had the same `2 3`, plus an `8 2 2 2` that read as morse
code. A mark **at least 6px long and never shorter than the gap after it** is
the difference between a dashed line and a row of dots, and the test enforces it.

Lines are drawn at **2–2.5px**, not 1.5px. At hairline weight on a dark ground
chroma perception collapses and two warm hues read as one colour — which is
what "the red and the orange are hard to tell apart" actually meant.

**A series colour never touches text.** The palette is tuned to clear SC
1.4.11's 3:1 as a *line*, and a hue sitting above that floor cannot also clear
SC 1.4.3's 4.5:1 as text under 24px — the two are not satisfiable in one value
at these hues. Measured against the real card surface across both themes and
eleven routes, **328 of 496 series-coloured text nodes failed the floor that
governed them**. Every Baltic series still does, at the current values:

| token | hex | on card | as text (4.5) | as a line (3.0) |
|---|---|---|---|---|
| `--series-lv` light | `#c07173` | 3.59 | **fail** | pass |
| `--series-ee` light | `#5580b4` | 4.09 | **fail** | pass |
| `--series-lt` light | `#9c761f` | 4.18 | **fail** | pass |
| `--series-lv` dark | `#bf5259` | 3.74 | **fail** | pass |
| `--series-ee` dark | `#407cc0` | 3.98 | **fail** | pass |
| `--series-lt` dark | `#a67300` | 4.15 | **fail** | pass |

The chroma reduction is the proof that no value fixes this. It *raised* most of
these ratios — light Lithuania went 3.24 → 4.18, dark Lithuania 9.92 → 4.15 —
and **not one series crossed 4.5**. Brightening is the wrong repair twice over:
it would undo the "3:1 is the floor, not the target" constraint above, and
moving Latvia up walks it toward `--data-negative`.

So the colour **moves rather than changes**. It was carrying something real —
which line in the chart belongs to this reading — so the value goes to
`--text-primary` and a `SeriesSwatch` beside it takes the hue, at the 3:1 floor
the palette actually meets. The recharts legend already worked this way.

**The flag emoji cannot do the swatch's job.** Segoe UI Emoji ships no
regional-indicator glyphs, so on Windows `🇱🇻` renders as the letters "LV" in
the *text* colour: an identifier that carries none of the country's hue.
Deleting the colour outright would have left a Windows reader with no way to
match a label to a line at all. Verified by screenshot, not assumed.

**Fixed, and worth recording how.** This section used to carry a known,
deliberately unfixed defect: the light 3:1 was verified against the white card,
and the ranked-comparison and modal-split bars are not on the card — they sit in
a `--bg-raised` track, where gold measured 2.95:1 and on `--bg-sunken` 2.88:1.
The same fault as the one above, one level out: **a floor verified against one
background and then used against another.**

It was left unfixed because the fix looked like a bad trade — darkening gold
until it cleared 3:1 on the raised track walks it into `--data-warning`
(`#a16207`), swapping a marginal contrast failure for a semantic collision.

The chroma reduction resolved it as a side effect, and from the direction nobody
was looking in. `#9c761f` is *less saturated* rather than darker, so it gained
contrast without approaching the warning hue:

```
--series-lt #9c761f   on --bg-card   #ffffff   4.18:1  pass
                      on --bg-page   #f6f8fb   3.93:1  pass
                      on --bg-raised #f1f5f9   3.81:1  pass
                      on --bg-sunken #eef2f7   3.72:1  pass
```

The allowance in `tests/seriesContrast.live.test.ts` is deleted rather than left
in place, because a stale exception is indistinguishable from a live one and
would go on excusing the next value that lands at 2.9:1.

The general lesson is the one the trade obscured: when two constraints appear to
conflict, check whether the axis you are moving along is the only one available.
Darkening and desaturating both raise contrast; only one of them was considered.

### 3.7 Numbers

- **Tabular figures everywhere a number can change or align.**
  `font-variant-numeric: tabular-nums`. Our World in Data additionally sets
  `lnum` for lining numerals — worth having, since old-style figures in a table
  are a mess.
- **Always signed.** A delta shows `+` or `−` explicitly, plus `▲`/`▼`. Colour
  is the third encoding, never the first.
- **Use a real minus sign** (`−`, U+2212), not a hyphen. A hyphen is
  narrower than a digit and breaks column alignment even in a tabular face.
- **Abbreviate in house style**: `m`, `bn` and `tn`, lower case, no space — the
  FT and Reuters convention, not the American `M`/`B`/`T`.
- **Fixed decimal places within a column.** `1.20` and not `1.2` when its
  neighbour is `1.25`.
- **A number states what it is measured in.** `formatValue` has an explicit
  branch per unit and `tests/formatValue.test.ts` asserts that *no unit in the
  indicator registry reaches the generic fallback*, so a new indicator with an
  unhandled unit fails the suite rather than shipping a bare figure.

That last rule is there because both halves of it shipped broken.

**The scale was dropped.** `M EUR` means the series is denominated in *millions*
of euro — every Eurostat definition behind it queries `currency=MIO_EUR`.
`formatValue` read the raw number as though it were euro and only appended a
magnitude once the number itself passed a million. Latvia's quarterly goods
imports, 5,623 million euro, rendered as **`€5,623`**, and a quarterly move of
200 million rendered as **`−€200`**. A reader could not tell five thousand euro
from five billion, and the delta looked like the price of a bicycle.

The unit test asserted exactly that behaviour — `formatValue(3500, 'M EUR')` →
`'€3,500'` — which is why nothing caught it. **The test was written from the same
misreading as the code**, which is this book's recurring failure mode in a new
place: a check that agrees with its author's imagination cannot find the thing
the author did not imagine.

**The unit was dropped entirely.** Nine indicators declared units the function
had no branch for — `nights`, `passengers/quarter`, `thousand tonnes CO2-eq`,
`M tonne-km`, `k tonnes`, `k passengers`, `per 1000 inhabitants` — and every one
fell through to a numeric fallback that printed a bare number. Rail freight read
`1,234`, of nothing.

The repair that matters is not the nine branches; it is the registry check. Nine
more examples would have been nine more things somebody thought of. Comparing
the handled set against the units the registry actually declares is a check on
the *property*, and it is the difference between fixing these nine and stopping
the tenth — the same distinction §"A word list encodes your examples" draws in
AGENTS.md.

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

**A guard whose false branch is a claim.** This is a distinct shape from absence
rendered as a value by accident, and it is worse, because the guard makes the
code *look* defended. `total > 0 ? share : '0.0'` reads as handling the empty
case; what it actually does when `total` is NaN is route the poisoned value into
a **confident zero** — `NaN > 0` is `false`, so a category we did measure printed
"0.0%". The unguarded version would have printed `NaN%` and been visibly broken.

`fetchElectricityPrices` had the same shape twice, and worse:

```js
current: currentEntry ? currentEntry.price : 0     // no interval for this hour
catch (e) { return { prices: [], current: 0 }; }   // the fetch failed entirely
```

**Zero is not an absurd electricity price.** Nord Pool clears at zero and goes
negative when the wind is up, and this very tile carries a "Negative price"
badge for it — so the fabricated zero was indistinguishable from a reading, and
the dashboard printed "€0.00/MWh" as a headline on the strength of a request
that never completed. Every consumer already handled `null` correctly; this one
function was the only thing defeating them.

So: **every `x ? real : fallback` where the fallback is a number rather than a
dash has this available to it.** The fallback for an unknown is `null` at the
boundary and `—` on the page, never a value that could have been measured.

**Filter before you aggregate, and check that each guard earns its place.**
`Math.min(...prices.map(p => p.price))` coerces `null` to 0 and propagates NaN,
so one unpriced interval printed "Low €0.00" for a day whose real floor was
nowhere near it. And mutation testing is what shows a guard is load-bearing:
`typeof x === 'number' && Number.isFinite(x)` looks careful and is redundant,
because `Number.isFinite` does not coerce and already rejects `null`, `NaN`,
`Infinity` and `'50'`. Removing the first half broke nothing, so it was removed.
A check that cannot fail is not a check.

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

### 4.4 A phone is not a small desktop

Three rules, each written from a measurement taken on a real phone viewport
rather than from a narrowed desktop window.

**An affordance measured in percent is not an affordance on a phone.** The fade
on a sideways-scrolling strip was `3%`, which is 43px at 1440 and **12px at
402** — so it shrank to nothing on exactly the devices where those strips
overflow. Measured on an iPhone 17 Pro, the ticker's leading item read as a
crisp cut rather than a fade: `R/USD` for EUR/USD, and `0.8574` with its label
gone entirely. The fade is `--edge-fade`, a length, because the thing it has to
soften is a character and a character is a length.

**A tick interval is a claim about how many points the series carries, and it
will stop being true.** `EconomyTile` set `interval={3}` under a comment reading
"six ticks across a 24-hour day". Elering then moved the day-ahead feed to
15-minute resolution: 88 quarter-hours rather than 24 hours, so it drew 22
labels, and at 402px **20 of the 21 visible ones overlapped**. It was clean at
1440, which is why it survived — the defect existed only at widths nothing
measured. Derive the interval from the data (`tickInterval`), never write one.

**What costs a tenth of a laptop can cost a third of a phone.** The guided tour
is a 223px panel pinned to the bottom edge: about a tenth of a 900px desktop
viewport, and **26% of an iPhone 17 Pro, 33% of an iPhone SE** — over the part
of the screen a thumb already occupies, uninvited, on a first visit. It was also
explaining the section tabs while covering them. It no longer opens itself below
`sm`; the trigger stays, so the feature is deferred rather than removed, and the
completion flag is deliberately not written, because a reader who was never
offered the tour has not declined it.

The corollary for the 44px rule in §5: `target-inline` is the opt-out, reserved
for a chip inside a larger target. Every control in that panel carried it, so on
the one surface operated exclusively by thumb, every control was under the
minimum — Skip 64×26, Back 49×34, Next 50×34.

### 4.5 A second pass, because one pass is a start

The first pass fixed the four things it looked at. Sweeping every route again at
320 / 375 / 414 / 768 found four more, and the shape of all four is the same:
**a rule the site already has, not reaching somewhere.**

**A sideways strip must look like one — and the check is the rendered mask, not
the call site.** Five strips scroll sideways on this site. Three carried
`useOverflowFade`; two did not, and the two nobody had measured were the two
that were wrong.

```
                                       hidden @320   mask
  header controls        Header             231px    yes
  site section tabs      Header             647px    yes
  dashboard rail         SectionRail        453px    yes
  newsroom masthead nav  NewsroomLayout      83px    NO  -> fixed
  insights row           InsightsBanner    1061px    NO  -> fixed
```

The newsroom nav cut its **active** tab: "How we use AI" rendered as `Hc`
beneath its own accent underline, which reads as a broken tab rather than as a
row that continues. The insights row cut a live figure mid-word —
*"Highest ter"*.

**The second of those is the one to remember, because reading the source calls
it correct.** `InsightsBanner` does call the hook and does spread its class. But
`useOverflowFade` attaches in an effect, and an effect runs when its *owner*
mounts — the component renders a separate "Loading insights" element on the
first commit, so the effect runs against a null ref, and a ref object cannot
re-trigger an effect when it is later filled. The fade is wired and dead.
`NewsFeed`'s new filter strip had the identical fault, measured `mask: NONE`
with 601px hidden, and was fixed by giving the strip **its own component** so
the element arrives with its own hook. So: a strip that appears after data
loads needs the hook mounted with it, and the only check that can tell is one
that reads the computed mask in a browser.

**A control that wraps costs vertical space, and vertical space is what a phone
has least of.** The front page's section filter was ten chips in a `flex-wrap`
row. Measured:

```
          rows   height   first story starts at
   320px    4     200px    583px   ->  1 row, 44px, 427px
   375px    4     200px    565px   ->  1 row, 44px, 409px
   414px    3     148px    513px   ->  1 row, 44px, 409px
   768px    2      96px    443px   ->  unchanged, deliberately
```

200px is 26% of a 780px viewport spent on a filter, above any journalism —
the same arithmetic that removed the tour panel above. It scrolls sideways
below `sm` and wraps at `sm` and up, so the desktop layout is provably
untouched: 768px is identical on both sides of the change.

**A large heading pays for its padding in wrapped lines.** The lead card's `p-6`
is 24px each side at every width. At 320px that leaves the 34px headline a
238px box, and the headline ran to **7 lines at 1.57 words per line** — the
one-word-per-line failure, arrived at through spacing rather than type.
`p-4 sm:p-6` gives it 254px and **5 lines at 2.2 words per line**, with 375px
and above unchanged. The type step is not the lever here and was left alone:
34px already steps down from `sm:text-display`, and at 375px it sets a
perfectly good 4 lines.

**The 44px rule reaches `nav a`, so a navigation control outside a `nav` is
outside the rule.** The masthead wordmark — the site's home link, on every
route — measured **83×26 at every width**. It is not in a `<nav>`, so nothing
touched it. It carries `min-h-11` now; the row is already `h-14`, so the target
grew and nothing moved. When a rule is expressed as a selector, the question is
always what the selector does *not* select.

### 4.6 At a phone's width, a column is not a column

The two published policy documents render markdown tables, and a policy table is
prose in cells with a short label column. Measured on master at 320px, with
characters per line as the readability number §4.2 already uses:

```
                  columns          chars/line   tallest cell   scrolls
  /corrections    108 / 115 / 110      8.5        13 lines     46px, no affordance
  /about/ai       114 / 172           11.5         7 lines     no
```

§4.2 puts a comfortable measure at 45–75 characters and WCAG SC 1.4.8 caps a
block of text at 80. **Eight** is failing the site's own reading rule by a
factor of five, on the two pages a sceptical reader goes to. Widening the
columns was not available: the viewport is the constraint, and three columns of
prose do not fit 288px however they are arranged.

So below `sm` each row becomes a labelled block at the full column width, and
the header row is hidden because every cell carries its own label:

```
                  chars/line       tallest cell   height
  /corrections    8.5 -> 29        13 -> 3        717 -> 647px
  /about/ai      11.5 -> 28.5       7 -> 4        814 -> 914px
  both @768       unchanged         unchanged     unchanged
```

`/corrections` is both **3.4× the measure and 70px shorter**, because prose at
its natural width wraps more efficiently than prose in a 108px column.
`/about/ai` costs 100px of height for 2.5× the measure, and that is the right
trade here in a way it was not for the section filter above: **this is the
content, not a control standing in front of it.**

Two things that look like details. The label is a real element rather than
`content: attr(data-label)`, because generated content cannot be selected,
copied or reliably read. And `display: block` on table elements is widely said
to destroy the accessibility tree — measured here with an ARIA snapshot, it does
not: at 320px Chromium still reports `table` → `rowgroup` → 3 × `row` → 9 ×
`cell`, and each cell announces its own label, so the header association is
replaced rather than lost.

### 4.7 Ask what the cut is removing before you fade it

§4.5 says a sideways strip must look like one, and the reflex that follows is to
reach for `useOverflowFade`. The third strip found by that rule is the
counter-example: **a fade would have been the wrong fix, and it would have
looked right.**

`/follow` renders each feed address in a chip carrying `overflow-x-auto
whitespace-nowrap`. Measured against production:

```
                          on screen                 hidden
  320px  /rss.xml         https://portabaltica.       170px
         /feed.json       https://portabaltica.       186px
  375px  both             https://portabaltica.naurol
  414px  both             https://portabaltica.naurolabs.c
  768px  differ           the whole URL
```

At every phone width **both chips rendered byte-identical visible text**, because
the only thing distinguishing RSS from JSON Feed is the path and the path is
precisely what the cut removed. Two controls whose entire job is to say *which*
address, reading the same — on the page whose entire job is to hand a reader a
URL.

Fading the edge would have made that read as deliberate. The chips wrap instead
(`break-words`, the same answer `markdown.tsx` already gives for a URL that
offers a line break nowhere), so the whole address is on screen and nothing
scrolls: 63px and 79px hidden at 320px → **0**, at a cost of one line.

So the rule §4.5 states is about how a cut *looks*, and it has a prior question:
**what is on the other side of it?** When the hidden part is more of the same —
another tab, another card — a fade is right, because the reader can see there is
more and reach it. When the hidden part is the informative part, no treatment of
the edge helps, and the answer is to stop cutting.

### 4.8 What a keyboard and a screen reader actually get

Two mobile passes measured tap targets, overflow, fades and heading steps.
Nothing had measured whether the site can be used without a mouse. Audited in
Chromium against a real build — jsdom reports focus for elements a browser will
not focus, and `getComputedStyle` on an SVG there is close to useless — with a
positive and a negative control on every run.

**Most of it is already right, and that is the result.** Across `/`, `/data`,
an article and `/follow`, at 320px and 375px:

```
  route        tab stops   no focus ring   clipped by a scroller   off-screen
  /                   81               0                       0            0
  /data              158               0                       0            0
  /article            40               0                       0            0
  /follow             39               0                       0            0
```

318 tab stops, every one reachable, every one with an outline, none clipped.
**The five faded scroll strips do not trap or hide focus**: a browser scrolls a
focused descendant into view, and a `mask` — unlike `overflow: hidden` on a
clipping ancestor — does not prevent it. Tab order never jumped upward by more
than 24px, so it follows visual order. Every route: one `main`, one `h1`, no
skipped heading levels, every `nav` labelled, `lang="en"`. The `sr-only`
"Front page" `h1` on the feed holds.

**A status message has to exist before it has anything to say.** The download
controls announced **nothing** on success: the file arrives, no visible content
changes, focus stays on the button, and `[role="status"]` was absent from the
group entirely. WCAG 2.2 SC 4.1.3 (AA) is precisely this case. The subtler half
is that the region was *mounted with its own message* on failure — assistive
technology watches a live region for changes, and a region inserted together
with its text is frequently missed, so even the failure was unreliable. The
region is permanent now and only its text changes; success is announced
`sr-only`, because the file arriving is its own feedback for a sighted reader.

**A chart with no accessible name is invisible on a site that is mostly
charts.** `chartAccessibility.ts` provides `describeSeries`, which is good — it
says what is plotted, over what span, and where the series started and ended.
Measured on `/data`, 77 recharts surfaces render and **67 carry a described
`role="img"` ancestor; 10 do not**, so they announce as anonymous graphics.

The guard is the reason. `design-system.test.ts` asserts the rule against a
hand-written list of **two** files while **six** components render a chart —
the same population gap this book records twice already. Source enumeration and
rendered DOM agree exactly on which are missing:

```
  BalticCompareChart   role="img"   described   guarded
  IndicatorCard        role="img"   described   guarded
  GridStatePanel       role="img"   hand-written label
  EconomyTile          none                              1 bare surface
  PowerMarketCard      none                              1 bare surface
  IndicatorTable       none                              8 bare sparklines
```

The eight are 24px sparklines in a table whose row already carries the figure
and its change, so `aria-hidden` may be the right answer there rather than a
description — **and it was.** Read out of Chromium's own accessibility tree, one
row announces:

```
  GDP Growth Rate % QoQ 0.6% Q1 2026 0.7% ▼ −0.1%
  down, which is unfavourable for this indicator
```

Name, unit, latest value, **its period**, previous, change and the spoken
polarity. Describing the trace repeats all of it, and WAI-ARIA calls a graphic
that duplicates adjacent text decorative. The one thing a description would add
— the span and the extremes — is on the indicator's own page, which the row is
a link to.

**And hiding it was only half the fix, which is the part worth remembering.**
`aria-hidden` over a *focusable* element is an ARIA violation rather than a
style preference: it hides a node a keyboard can still land on, which is worse
than either state alone. Recharts 3 turns `accessibilityLayer` on by default,
so every chart surface carries `role="application"` and `tabIndex={0}` — and
each of these eight sat **inside the row's own `<button>`**, a nested
interactive control. So the box is hidden *and* the chart leaves the tab order,
and the guard in §5 requires both together.

### 4.10 The library put 27 unnamed applications in the tab order

Measured in Chromium against the real build, tabbing the dashboard:

```
                 tab stops   of which chart surfaces   unnamed
  /data/economy         81                        27        16
  /data/energy          56                        16         4
```

**A third of the tab stops on `/data/economy` were chart SVGs announcing as an
unnamed "application".** `role="application"` is the heaviest role in ARIA: it
tells a screen reader to stop its own browse-mode key handling and hand every
keystroke to the page. Unnamed, it is a mode switch into nothing. Nothing in
this repo asked for it — `accessibilityLayer` defaults to `true` in recharts 3
and no component opts out.

Two remedies exist and `tests/chartKeyboard.test.tsx` proves both against the
library rather than describing them, because the mechanism was read out of
`recharts/es6/container/RootSurface.js` and a source read is a hypothesis:

- **name the surface in place** — `role="img"` and `aria-label` passed to the
  chart element reach the SVG and override `application`, which is better than
  this codebase's current wrapper, since it makes one node carry both the
  graphic and its description rather than a named div containing an unnamed
  focusable application;
- **leave the tab order** — `accessibilityLayer={false}`, for a chart that is
  decorative.

`IndicatorTable` takes the second. The other five components are recorded in an
equality in `design-system.test.ts` so the list cannot outlive the defect.

### 4.9 Describe the chart, not the panel around it

Fixing the ten above turned into a question the audit had not asked: **what
should an accessible name for a chart actually say?** Three answers were tried
against the rendered page, and two of them were wrong in ways that read fine in
source.

**Do not restate what is already text beside it.** `GridStatePanel` carried a
hand-written label reciting generation, demand, net flow and renewable share.
Every one of those four figures is already on screen in the stat boxes
immediately above — so a screen-reader user heard them once as content and
again as the chart — and **renewable share is not plotted at all**: the chart's
three `dataKey`s are `generated`, `metered` and `planned`. The label described
the panel, not the chart. What only the chart carries — the shape over time,
and where measurement stops and forecast begins — was never stated. It goes
through `describeComparison` now, with one appended clause naming the
measurement boundary, because that is a fact about the join between two series
and no per-series description can express it.

**A shared vocabulary is right until its assumption is false.**
`describeComparison` reports the *last* observation of each series under the
heading "Latest readings". That is correct for the historical series it was
written for, and false for a day-ahead price curve, which runs forward into
tomorrow. Applied to `PowerMarketCard` it produced:

```
  the label said     Estonia €28.26 … Finland €1.83    "Latest readings"
  the panel showed   Estonia €28.41 … Finland €27.45   current
```

Finland out by a factor of fifteen — the last *interval* of the published
curve, announced as the latest *reading*. It is the forecast trap `AGENTS.md`
records for freshness probes, arriving in an accessible name. So that chart is
described bespoke: how many zones, over how many intervals, whether the curve
continues into tomorrow, and a pointer to the per-zone prices already listed
above it.

The rule is not "always share" or "always bespoke". It is: **use the shared
vocabulary wherever its assumption holds, and prove it holds by reading the
rendered label against the page.** Both defects above are invisible in a diff
and obvious the moment the label is compared with the figures beside it.

**And a shared helper must not leave that as the caller's problem.**
`describeComparison` now takes an optional `asAt` — the period the caller
declares is current — and reports the reading *there*, noting when the series
continues past it. That is the guarantee. Underneath it sits a structural
refusal: **when a period label occurs twice it cannot identify a point**, so no
clause of the form "X in \<period\>" is well-defined, and the helper stops
claiming one and reports each series' range instead.

That check is structural rather than a date parser, and the measurement is why.
Across the three real call sites the helper receives period *labels*, and they
are display strings:

```
  PowerMarketCard   184 points   "00:45"     88 duplicate labels
  GridStatePanel     48 points   "18:00"      0 duplicates
  an indicator       22 points   "2026-Q2"    0 duplicates
```

The day-ahead labels carry **no date at all**, and 88 of 184 repeat because the
clock wraps at midnight — so "00:45" names two different points and nothing in
the input distinguishes them. `GridStatePanel` knows where measurement stops
only because its payload carries `meteredTo`, which never reaches the helper.
Recency is caller knowledge; a parser would only ever handle the formats its
author imagined and fail silently on the next, in the direction that reports
success.

**The residual is stated rather than hidden:** a forward curve whose labels
happen to be unique still gets "Latest readings" for a point that may be a
forecast. `GridStatePanel` is exactly that case — its clause is unambiguous and
true as drawn, and it is not current. Only `asAt` closes it. Measured across 105
rendered chart labels, the rework changes **none** of them, so the safety is
new and the existing wording is untouched.

**The guard derives its population.** `design-system.test.ts` asserted the rule
against a hand-written list of **two** files while **six** components rendered a
chart, so four were unguarded while looking covered — the fourth instance of
that shape in this project. Measured on the shipped tree, the old form is
**green** while ten surfaces announce as anonymous graphics. The set is read
from the source now, `ResponsiveContainer` is the marker, and a count assertion
fails if that marker ever stops identifying charts — because an empty set passes
everything. The one exclusion is written as an **equality**, so it cannot
outlive its reason.

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
- headings descend, an `h2` is never smaller than the content of its own
  `<section>`, and each heading has more room above it than below;
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
- every chart carries `role="img"` and a described label **or is hidden and out
  of the tab order**, and the decorative ticker is `aria-hidden`. The chart
  population is derived, not listed: the set is every component containing a
  `ResponsiveContainer`, with a count assertion so an empty set cannot pass. The
  checks are **element-scoped**, tied to each chart rather than to the file —
  a planted fault proved a file-scoped version green on an undescribed chart,
  because the same file carried an unrelated `aria-hidden` span. A second
  equality records every chart surface still left as an unnamed
  `role="application"` by recharts' default accessibility layer;
- `prefers-reduced-motion` is honoured, and nothing animates `all`;
- charts do not hardcode a hex colour that a theme token already provides, and
  do not use `connectNulls`;
- the JS chart palette and the CSS tokens have not drifted apart.

`tests/reducedMotionLayout.live.test.ts` measures the two things above that only
a browser can answer, in one pass over every derived route at nine widths: no
route scrolls sideways, and **every strip that does scroll carries a mask**. The
second is a live check rather than a source check on purpose — the insights row
in §4.5 read as correct in source and rendered with no fade.

Its exemption list is now **empty, and it emptied itself twice**. It named two
strips; fixing those turned the test red, which is how a third was found —
`/follow`'s feed URL chips, added meanwhile by another change and covered by no
check that reads a rendered mask. Written as a filter rather than an equality it
would still name two strips that no longer offend, matching nothing, reporting
success, and never surfacing the third.

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

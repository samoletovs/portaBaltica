/**
 * Every dashboard section, in one place, as a value.
 *
 * This was a type in `types.ts` plus three hand-written runtime copies:
 * `VALID_SECTIONS` in `App.tsx` decided what `/data/:section` actually renders,
 * `DASHBOARD_SECTIONS` in `main.tsx` decided what a legacy `/section` URL
 * redirected to, and `Header.tsx` decided what was clickable. All four agreed,
 * and nothing made them agree.
 *
 * The failure is silent and in the worst direction. Removing one id from
 * `VALID_SECTIONS` alone left `tsc --noEmit` at exit 0 — a `Set<string>` is not
 * checked against the union — and left all 26 route tests green, because they
 * derived from the *type* and from `Header.tsx`, neither of which had changed.
 * The reader clicks "Trade", the address bar reads `/data/trade`, and `App.tsx`
 * falls back to `'all'` and serves them the Overview. Measured, not supposed:
 * 26 passed with `trade` removed.
 *
 * So the sections are a value first and the type is derived from it. A section
 * cannot now exist for the router and not for the renderer, because there is
 * only one list to add it to.
 *
 * This lives here rather than in `types.ts` because `main.tsx` needs it eagerly
 * to resolve legacy URLs, and `types.ts` also exports `PORTS` — importing it
 * from the entry chunk cost 702 bytes of port data that a reader who never
 * opens the dashboard would have paid for. Measured both ways.
 */
export const DASHBOARD_SECTIONS = [
  'economy', 'trade', 'government', 'labour', 'energy',
  'property', 'environment', 'maritime', 'business',
] as const;

/** Active dashboard section. Derived, so it cannot disagree with the list. */
export type DashboardSection = typeof DASHBOARD_SECTIONS[number];

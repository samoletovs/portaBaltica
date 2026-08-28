import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

/**
 * What recharts puts in the tab order, and how to change it.
 *
 * Recharts 3 turns `accessibilityLayer` **on by default**, which gives every
 * chart surface `role="application"` and `tabIndex={0}`. The intent is
 * arrow-key navigation of data points; the effect here, measured in Chromium
 * against the real build, was:
 *
 *     /data/economy   80 tab stops, 27 of them chart surfaces
 *                     every one announcing as an unnamed "application"
 *     /data/energy    56 tab stops, 16 of them chart surfaces
 *
 * `role="application"` is the heaviest role in ARIA — it tells a screen reader
 * to stop its own browse-mode key handling and hand every keystroke to the
 * page. Unnamed, it is a mode switch into nothing.
 *
 * These tests exist because the remedy was read out of `recharts/es6/container/
 * RootSurface.js` rather than measured, and a source read is a hypothesis:
 *
 *     if (typeof otherAttributes.role === 'string') role = otherAttributes.role;
 *     else role = hasAccessibilityLayer ? 'application' : undefined;
 *
 * If that is right, a chart can be *named in place* rather than wrapped, which
 * is better than the wrapper this codebase currently uses — one node carrying
 * both the graphic and its description, instead of a named div containing an
 * unnamed focusable application. So the mechanism is pinned here, for whoever
 * picks up the components this pass did not own.
 */

const rows = [
  { period: '2025-Q1', value: 1 },
  { period: '2025-Q2', value: 2 },
];

/** Recharts needs a sized box; jsdom gives `ResponsiveContainer` none. */
function chart(props: Record<string, unknown>) {
  const { container } = render(
    <div style={{ width: 300, height: 100 }}>
      <ResponsiveContainer width={300} height={100}>
        <AreaChart data={rows} {...props}>
          <Area dataKey="value" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>,
  );
  return container.querySelector('.recharts-surface');
}

describe('what recharts puts in the tab order', () => {
  it('draws a surface at all, so the assertions below mean something', () => {
    // The control. `ResponsiveContainer` renders nothing when it has no size,
    // and every query against a chart then returns null — `AGENTS.md` records
    // a session nearly filing a false bug report on exactly that. If this
    // fails, nothing else in this file is admissible.
    expect(chart({}), 'no chart surface rendered — the harness has no size').not.toBeNull();
  });

  it('makes every chart a focusable, unnamed application by default', () => {
    const surface = chart({});

    expect(surface!.getAttribute('role')).toBe('application');
    expect(surface!.getAttribute('tabindex')).toBe('0');
    expect(surface!.getAttribute('aria-label'), 'and it carries no name').toBeNull();
  });

  it('lets a caller name the surface in place, overriding the application role', () => {
    // The recommendation, proven rather than asserted: passing `role` and
    // `aria-label` reaches the surface, so a chart can be one named graphic
    // instead of a named wrapper around an unnamed application.
    const surface = chart({ role: 'img', 'aria-label': 'GDP growth, 20 readings' });

    expect(surface!.getAttribute('role')).toBe('img');
    expect(surface!.getAttribute('aria-label')).toBe('GDP growth, 20 readings');
  });

  it('takes it out of the tab order when the layer is off', () => {
    const surface = chart({ accessibilityLayer: false });

    expect(surface!.getAttribute('tabindex'), 'not focusable').toBeNull();
    expect(surface!.getAttribute('role'), 'and not an application').toBeNull();
  });

  it('honours an explicit tabIndex even with the layer on', () => {
    // The companion: without this, the test above passes just as well on a
    // library that ignores the prop and happens to default to nothing.
    expect(chart({ tabIndex: -1 })!.getAttribute('tabindex')).toBe('-1');
  });
});

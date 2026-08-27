import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fade the end of a horizontally scrolling strip, but only the end that is
 * actually cut off.
 *
 * A row that scrolls sideways has to look like one. The section tabs clipped
 * the last tab mid-character at 375px and the insights row clipped its last
 * card, both with a hard edge and no gradient, which reads as a layout bug
 * rather than as more content.
 *
 * The reason this is a hook rather than one static class is that a fixed mask
 * dims the first and last item *whether or not there is anything past them*.
 * The section tabs do not overflow at 1440, so an always-on fade would grey out
 * "News" and "Maritime" permanently to solve a problem that only exists on a
 * phone. So the fade follows the scroll position: it appears on the left once
 * you have scrolled away from the start, on the right while there is more to
 * come, and not at all when everything fits.
 */
export function useOverflowFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const { scrollLeft, scrollWidth, clientWidth } = element;
    // A sub-pixel layout can leave scrollWidth a hair over clientWidth with
    // nothing actually hidden, so allow a pixel of slack at both ends.
    setEdges({
      start: scrollLeft > 1,
      end: scrollLeft + clientWidth < scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    measure();
    element.addEventListener('scroll', measure, { passive: true });

    // The strip's own contents can change size — the insights row is filled
    // asynchronously — so watch the box rather than only the window.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    for (const child of Array.from(element.children)) observer?.observe(child);
    window.addEventListener('resize', measure);

    return () => {
      element.removeEventListener('scroll', measure);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const fadeClass = [edges.start && 'edge-fade-start', edges.end && 'edge-fade-end']
    .filter(Boolean)
    .join(' ');

  // A tuple rather than an object, because an object whose property is called
  // `ref` reads to `react-hooks/refs` as a ref being dereferenced during
  // render, and the lint error it raises is not wrong about the shape even
  // though it is wrong about the risk.
  return [ref, fadeClass] as const;
}

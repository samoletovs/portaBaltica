import { useLayoutEffect, type RefObject } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

const MOTION_QUERY = 'screen and (prefers-reduced-motion: no-preference)';
let registered = false;

function canAnimate(element: HTMLElement | null): element is HTMLElement {
  if (!element || typeof window.matchMedia !== 'function' || element.getClientRects().length === 0) return false;
  if (!registered) {
    gsap.registerPlugin(ScrollTrigger);
    registered = true;
  }
  return true;
}

/** The measured bars reveal from zero; numeric labels remain real and readable throughout. */
export function useEvidenceReveal(ref: RefObject<HTMLElement | null>, revision: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!canAnimate(root)) return;
    const media = gsap.matchMedia();
    media.add(MOTION_QUERY, () => {
      gsap.fromTo(root.querySelectorAll('.story-evidence-fill'), { scaleX: 0 }, {
        scaleX: 1, duration: 0.7, stagger: 0.08, ease: 'power3.out',
        scrollTrigger: { trigger: root, start: 'top 90%', once: true },
        clearProps: 'transform',
      });
    });
    return () => media.revert();
  }, [ref, revision]);
}

/**
 * Collection choreography also admits cards arriving after a lazy/data boundary.
 * Only child additions are observed; animation style writes cannot retrigger it.
 */
export function useScrollCollection(ref: RefObject<HTMLElement | null>, selector: string, revision: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!canAnimate(root)) return;
    const surface = root;
    const media = gsap.matchMedia();
    media.add(MOTION_QUERY, () => {
      const seen = new WeakSet<Element>();
      let queued = 0;
      let resized = 0;
      const context = gsap.context(() => {}, root);
      function discover() {
        queued = 0;
        context.add(() => {
          const added = [...surface.querySelectorAll<HTMLElement>(selector)].filter(element => !seen.has(element));
          for (const element of added) {
            seen.add(element);
            element.setAttribute('data-scroll-reveal', '');
            if (element.hasAttribute('data-scroll-rule')) {
              gsap.fromTo(element, { scaleX: 0, transformOrigin: 'left center' }, {
                scaleX: 1, ease: 'none',
                scrollTrigger: { trigger: element, start: 'top 90%', end: 'top 35%', scrub: 0.5 },
              });
              continue;
            }
            gsap.fromTo(element, { opacity: 0, y: 28 }, {
              opacity: 1,
              y: 0,
              duration: 0.65,
              ease: 'power3.out',
              scrollTrigger: { trigger: element, start: 'top 94%', once: true },
              clearProps: 'opacity,transform',
            });
          }
          if (added.length) ScrollTrigger.refresh();
        });
      }
      discover();
      const observer = new MutationObserver(() => {
        if (!queued) queued = requestAnimationFrame(discover);
      });
      observer.observe(root, { childList: true, subtree: true });
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
        if (!resized) resized = requestAnimationFrame(() => { resized = 0; ScrollTrigger.refresh(); });
      });
      resize?.observe(root);
      const revealFocused = (event: FocusEvent) => {
        if (!(event.target instanceof Element)) return;
        const card = event.target.closest(selector);
        if (card) {
          gsap.getTweensOf(card).forEach(tween => { tween.scrollTrigger?.kill(); tween.kill(); });
          gsap.set(card, { opacity: 1, y: 0, clearProps: 'opacity,transform' });
        }
      };
      root.addEventListener('focusin', revealFocused);
      return () => {
        observer.disconnect();
        resize?.disconnect();
        if (queued) cancelAnimationFrame(queued);
        if (resized) cancelAnimationFrame(resized);
        root.removeEventListener('focusin', revealFocused);
        context.revert();
      };
    });
    return () => media.revert();
  }, [ref, selector, revision]);
}

/** A reading rule follows the actual story length, including charts arriving later. */
export function useStoryProgress(ref: RefObject<HTMLElement | null>, revision: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    const nav = root?.querySelector<HTMLElement>('.folio-story-reading-nav');
    if (!root || !nav || typeof ResizeObserver === 'undefined') return;
    const update = () => root.style.setProperty('--story-nav-height', `${nav.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => { observer.disconnect(); root.style.removeProperty('--story-nav-height'); };
  }, [ref, revision]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!canAnimate(root)) return;
    const story = root.querySelector<HTMLElement>('#article-story');
    if (!story) return;
    const media = gsap.matchMedia();
    media.add(MOTION_QUERY, () => {
      const progress = ScrollTrigger.create({
        trigger: story,
        start: 'top 25%',
        end: 'bottom 75%',
        onUpdate: self => root.style.setProperty('--story-progress', String(self.progress)),
      });
      let queued = 0;
      const resize = new ResizeObserver(() => {
        if (!queued) queued = requestAnimationFrame(() => { queued = 0; ScrollTrigger.refresh(); });
      });
      resize.observe(story);
      return () => {
        resize.disconnect();
        if (queued) cancelAnimationFrame(queued);
        progress.kill();
        root.style.removeProperty('--story-progress');
      };
    });
    return () => media.revert();
  }, [ref, revision]);
}

/** Chart/table is a change of representation, never a count-up of source values. */
export function useAnalysisTransition(ref: RefObject<HTMLElement | null>, revision: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!canAnimate(root)) return;
    const surface = root;
    const media = gsap.matchMedia();
    media.add(MOTION_QUERY, () => {
      const context = gsap.context(() => {}, root);
      let observer: MutationObserver | undefined;
      function animate() {
        const content = surface.querySelector('.lab-chart, .lab-table-scroll, .lab-loading, .lab-empty');
        if (!content) return false;
        context.add(() => {
          gsap.fromTo(content, { opacity: 0.45, y: 12 }, {
            opacity: 1, y: 0, duration: 0.35, ease: 'power3.out', clearProps: 'opacity,transform',
          });
        });
        return true;
      }
      if (!animate()) {
        observer = new MutationObserver(() => { if (animate()) observer?.disconnect(); });
        observer.observe(root, { childList: true, subtree: true });
      }
      return () => { observer?.disconnect(); context.revert(); };
    });
    return () => media.revert();
  }, [ref, revision]);
}

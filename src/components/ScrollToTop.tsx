import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const scrollToTarget = () => {
      const target = document.getElementById(hash.slice(1));
      if (!target) return false;
      // Focus can remove an entrance transform; scroll against the final box.
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      return true;
    };
    if (scrollToTarget()) return;
    // Article anchors arrive after the route's JSON and lazy component.
    const observer = new MutationObserver(() => {
      if (scrollToTarget()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname, hash]);

  return null;
}

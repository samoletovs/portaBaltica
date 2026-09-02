import { useEffect } from 'react';

function setMeta(selector: string, attribute: string, value: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, value);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function setCanonical(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = href;
}

interface PageMeta {
  title: string;
  description?: string;
  canonicalPath?: string;
  /**
   * An absolute canonical, for a page whose canonical version is not ours.
   *
   * Wins over `canonicalPath`, and exactly one of the two should be given. It
   * exists for syndicated articles: `rel=canonical` is a claim about whose page
   * this is, and for a piece we reproduce the answer is the source's URL rather
   * than any path on this origin — so it cannot be expressed as a path.
   */
  canonicalUrl?: string;
  /** Set false on pages that must never be indexed, e.g. a refused article. */
  index?: boolean;
}

/** Keeps the document head in step with the client-rendered route. */
export function usePageMeta({ title, description, canonicalPath, canonicalUrl, index = true }: PageMeta) {
  useEffect(() => {
    document.title = title;
    if (description) {
      setMeta('meta[name="description"]', 'name', 'description', description);
      setMeta('meta[property="og:description"]', 'property', 'og:description', description);
    }
    setMeta('meta[property="og:title"]', 'property', 'og:title', title);
    setMeta('meta[name="robots"]', 'name', 'robots', index ? 'index, follow' : 'noindex, nofollow');
    if (canonicalUrl) setCanonical(canonicalUrl);
    else if (canonicalPath) setCanonical(`${window.location.origin}${canonicalPath}`);
  }, [title, description, canonicalPath, canonicalUrl, index]);
}

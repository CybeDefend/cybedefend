import { useLayoutEffect, useState } from 'react';

/**
 * Whether `element` holds a link, kept current as its content changes. An
 * entry that carries its own authorisation (`AuthorizedContent`, a closed
 * area's registration) appears or goes without its parent rendering again, so
 * the parent cannot decide from its own render. True until the element is
 * mounted: nothing is hidden before it was read, and the first read runs
 * before the browser paints.
 */
export function useHoldsLink(element: HTMLElement | null): boolean {
  const [holds, setHolds] = useState(true);
  useLayoutEffect(() => {
    if (!element) return undefined;
    const read = () => setHolds(element.querySelector('a[href]') !== null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [element]);
  return holds;
}

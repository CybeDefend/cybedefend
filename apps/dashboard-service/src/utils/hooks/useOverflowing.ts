import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/**
 * True while the element's content is taller than its box
 * (`scrollHeight > clientHeight`), i.e. while part of it is only reachable by
 * scrolling. Measured on mount, on every resize of the box or of its direct
 * children (a longer list grows the child, not the box), on scroll, and when a
 * direct child comes or goes (the rail keeps its scroller mounted when the
 * product changes, and swaps the nav inside it): a new child is watched from
 * then on. Reads false in jsdom, where nothing has a height, and without an
 * element.
 */
export function useOverflowing(ref: RefObject<HTMLElement | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight);
    measure();

    element.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer) {
      observer.observe(element);
      for (const child of Array.from(element.children)) observer.observe(child);
    }

    const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;
    const children =
      typeof MutationObserver === 'function'
        ? new MutationObserver((records) => {
            for (const record of records) {
              record.removedNodes.forEach((node) => {
                if (isElement(node)) observer?.unobserve(node);
              });
              record.addedNodes.forEach((node) => {
                if (isElement(node)) observer?.observe(node);
              });
            }
            measure();
          })
        : null;
    children?.observe(element, { childList: true });

    return () => {
      element.removeEventListener('scroll', measure);
      observer?.disconnect();
      children?.disconnect();
    };
  }, [ref]);

  return overflowing;
}

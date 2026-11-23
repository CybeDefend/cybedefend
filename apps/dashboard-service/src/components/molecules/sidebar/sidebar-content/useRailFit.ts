import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { decideRailFit } from './railFit';
import type { RailFit } from './railFit';

/**
 * The room the scroller keeps under its content while everything fits (its
 * `pb-2`): what the fit measures against. While the list is cut, the scroller
 * takes `pb-6` for its fade, and the fit keeps measuring against this one, so
 * the hint cannot change the decision that made it appear.
 */
export const RAIL_FIT_PADDING = 8;

/**
 * Heights before a block was ever measured, from the rail's metrics: the
 * project's name row over six 28 px tabs 2 px apart; the eyebrow of Recent
 * projects over its 32 px rows 2 px apart; a hairline in 6 px of air each
 * side. A measured height replaces each as soon as the block has been shown.
 */
const ESTIMATE = { project: 28 + 6 * 28 + 5 * 2, divider: 13, recentHead: 30, recentRow: 32, recentGap: 2, cloud: 160 };

type Measured = typeof ESTIMATE;

interface UseRailFitOptions {
  /** Off where the rail is allowed to scroll (the phone drawer): everything wanted is shown. */
  enabled: boolean;
  /** False off a project page. */
  wantProject: boolean;
  /** How many recent projects there are to list. */
  recentCount: number;
  /**
   * The air the block above the scroller (the logo) may take, which the
   * scroller then loses; the caller applies `logoAir` to that block.
   */
  logoRoom?: number;
  /**
   * The Community rail's « CybeDefend Cloud » card (`data-rail-section="cloud"`): whether it is
   * wanted (not dismissed). Left out on the cloud's rail, which has none: the result then has no
   * `cloudCard`. The card is the first to give way.
   */
  wantCloudCard?: boolean;
}

/**
 * Whether the rail keeps `current` rather than lay out `next`. A logo that would only grow by
 * one pixel keeps its air: the browser snaps the logo's fractional padding, so a pixel given can
 * be taken back by the next measure, and the measure runs after every render (otherwise React
 * gives up after 50 nested updates and the page crashes). Less air always
 * applies, so the rail never scrolls.
 */
const keepsFit = (current: RailFit, next: RailFit): boolean => {
  const grows = next.logoAir - current.logoAir;
  return (
    current.recentRows === next.recentRows &&
    current.project === next.project &&
    current.cloudCard === next.cloudCard &&
    grows >= 0 &&
    grows <= 1
  );
};

/** The height of Recent projects with 1, 2, … `count` rows. */
const recentHeights = ({ recentHead, recentRow, recentGap }: Measured, count: number): number[] =>
  Array.from({ length: count }, (_, index) => recentHead + (index + 1) * recentRow + index * recentGap);

const heightOf = (element: Element): number => element.getBoundingClientRect().height;

/**
 * A section's height with its vertical margins. A margin is outside the element's box but inside
 * the content's height: left out, it stayed in the base while the section showed and left it when
 * the section went, so in a band of window heights as wide as the margin the section went, came
 * back, and went again after every render.
 */
const outerHeightOf = (element: Element): number => {
  const style = getComputedStyle(element);
  return heightOf(element) + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
};

/**
 * How far the room may move while two layouts take turns and still count as the same window: the
 * browser rounds the scroller's height (and snaps fractional paddings), so the layout a decision
 * produces can leave a pixel or two more or less than the one it replaced. A real resize moves it more.
 */
const FLIP_BACK_TOLERANCE = 2;

const sameFit = (a: RailFit, b: RailFit): boolean =>
  a.recentRows === b.recentRows && a.project === b.project && a.cloudCard === b.cloudCard && a.logoAir === b.logoAir;

/** How much a fit shows: when two fits take turns at one window height, the rail keeps the smaller. */
const weightOf = (fit: RailFit): number =>
  (fit.project ? 1_000_000 : 0) + Math.min(fit.recentRows, 999) * 1_000 + (fit.cloudCard ? 100 : 0) + fit.logoAir;

/**
 * Which of the rail's optional sections the window can hold without the rail
 * scrolling, and how many recent projects. `scrollerRef`
 * is the box that would scroll, `contentRef` the single block inside it; the
 * optional blocks carry `data-rail-section` (`divider`, `project`, `recent`, and the Community `cloud` card),
 * and the recent rows sit in a `data-rail-rows` list; a `data-rail-spacer`
 * (free room) is left out of the base. The base — everything
 * else — is the content less the optional blocks it holds right now, so
 * showing or hiding one never changes the decision that showed or hid it.
 * Measured before paint on every render, and again whenever the scroller (the
 * window) or the content (a label that wraps, a checklist that appears)
 * changes size.
 */
export function useRailFit(
  scrollerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  { enabled, wantProject, recentCount, logoRoom = 0, wantCloudCard }: UseRailFitOptions,
): RailFit {
  // Everything at first: the first pass measures the real heights, and the
  // decision lands before the browser paints.
  const [fit, setFit] = useState<RailFit>({ recentRows: Number.MAX_SAFE_INTEGER, project: true, logoAir: 0, cloudCard: true });
  const measured = useRef<Measured>({ ...ESTIMATE });
  // The air the logo holds in the page as rendered: the scroller is that much shorter than with a compact logo.
  const appliedLogoAir = useRef(0);
  appliedLogoAir.current = enabled ? fit.logoAir : 0;
  const current = useRef(fit);
  current.current = fit;
  // The fit the rail last left, and the room it had then: a decision that would go straight back
  // to it, in about the same room, is the layout answering its own decision, not a new window.
  const left = useRef<{ fit: RailFit; available: number } | null>(null);

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!enabled || !scroller || !content) return;

    const sizes = measured.current;
    let shownHeight = 0;
    content.querySelectorAll<HTMLElement>('[data-rail-section]').forEach((element) => {
      const height = outerHeightOf(element);
      shownHeight += height;
      const section = element.dataset.railSection;
      if (section === 'project' || section === 'divider' || section === 'cloud') sizes[section] = height;
      if (section !== 'recent') return;
      const list = element.querySelector('[data-rail-rows]');
      const rows = list ? Array.from(list.children) : [];
      if (!list || rows.length === 0) return;
      const listHeight = heightOf(list);
      const rowsHeight = rows.reduce((sum, row) => sum + heightOf(row), 0);
      sizes.recentHead = height - listHeight;
      sizes.recentRow = rowsHeight / rows.length;
      if (rows.length > 1) sizes.recentGap = (listHeight - rowsHeight) / (rows.length - 1);
    });

    // A `data-rail-spacer` holds the room the rail leaves free (the Community
    // rail's, which brings its last entries to the foot): not content.
    content.querySelectorAll<HTMLElement>('[data-rail-spacer]').forEach((element) => {
      shownHeight += heightOf(element);
    });

    const paddingTop = Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    const available = scroller.clientHeight + appliedLogoAir.current - paddingTop - RAIL_FIT_PADDING;
    const next = decideRailFit({
      available,
      base: heightOf(content) - shownHeight,
      recent: recentHeights(sizes, recentCount),
      project: sizes.project,
      divider: sizes.divider,
      wantProject,
      logoRoom,
      cloudCard: sizes.cloud,
      wantCloudCard,
    });
    const previous = current.current;
    if (keepsFit(previous, next)) return;
    // Two fits taking turns in about the same room: whatever the cause (a height the measure missed, a
    // browser's rounding), re-deciding after every render would loop until React gives up and the
    // page crashes. The rail settles on the one that shows less, so it never scrolls.
    const flipsBack =
      left.current !== null &&
      Math.abs(left.current.available - available) <= FLIP_BACK_TOLERANCE &&
      sameFit(left.current.fit, next);
    if (flipsBack && weightOf(previous) <= weightOf(next)) return;
    left.current = { fit: previous, available };
    current.current = next;
    setFit(next);
  }, [scrollerRef, contentRef, enabled, wantProject, recentCount, logoRoom, wantCloudCard]);

  // Every render: a route, a project name or an organisation can change what is shown.
  useLayoutEffect(measure);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!enabled || !scroller || !content || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(scroller);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollerRef, contentRef, enabled, measure]);

  const card = (show: boolean): Pick<RailFit, 'cloudCard'> =>
    wantCloudCard === undefined ? {} : { cloudCard: wantCloudCard && show };
  if (!enabled) return { recentRows: recentCount, project: wantProject, logoAir: 0, ...card(true) };
  return {
    recentRows: Math.min(fit.recentRows, recentCount),
    project: wantProject && fit.project,
    logoAir: fit.logoAir,
    ...card(fit.cloudCard !== false),
  };
}

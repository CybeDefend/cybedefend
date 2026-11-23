import React, { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RAIL_FIT_PADDING, useRailFit } from './useRailFit';

/*
 * jsdom lays nothing out: each element says how tall it is in `data-h`, the
 * scroller how much room it offers in `data-client`, and the content is as
 * tall as its children. A fake ResizeObserver lets a test resize the window.
 */
const heightOf = (element: Element): number => {
  if (element instanceof HTMLElement && element.dataset.h !== undefined) return Number(element.dataset.h);
  return Array.from(element.children).reduce((sum, child) => sum + heightOf(child) + marginOf(child), 0);
};

/** A child's vertical margins: in its parent's height, not in its own box (as a browser lays it out). */
const marginOf = (element: Element): number =>
  element instanceof HTMLElement
    ? (Number.parseFloat(element.style.marginTop) || 0) + (Number.parseFloat(element.style.marginBottom) || 0)
    : 0;

let observers: Array<() => void> = [];
class FakeResizeObserver {
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    observers.push(callback);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    observers = observers.filter((callback) => callback !== this.callback);
  }
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = heightOf(this);
    return { x: 0, y: 0, top: 0, left: 0, right: 0, width: 0, height, bottom: height, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return Number(this.dataset.client ?? 0);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface HarnessProps {
  room: number;
  enabled?: boolean;
  wantProject?: boolean;
  /** The recent projects there are to list. */
  recentCount?: number;
  /** The air the logo above the scroller may take; what it takes, the scroller loses. */
  logoRoom?: number;
  /** The navigation's height; a browser gives fractional heights (fonts, 125 % display scaling). */
  navHeight?: number;
  /** Round the scroller's `clientHeight` to a whole pixel, as a browser does. */
  roundClient?: boolean;
  /** What the browser's sub-pixel snapping of the logo's padding adds to the scroller, for a given air. */
  snap?: (air: number) => number;
  /** The free room a spacer takes at the foot of the content (the Community rail's). */
  spacer?: number;
  /** The Community rail's « CybeDefend Cloud » card, wanted (not dismissed), 120 px tall. */
  wantCloudCard?: boolean;
  /** What the browser's rounding takes off the navigation while no recent project shows. */
  navJitter?: number;
  /** The card's top margin (the real card keeps 4 px from what is above it). */
  cardMargin?: number;
  /** Height the card brings that no measure sees (a layout quirk): it makes the decision flip. */
  cardUnmeasured?: number;
  /** What showing the card does to the scroller's height (the browser rounding it differently). */
  cardJitter?: number;
}

/**
 * A rail in miniature: 300 px of navigation, a 13 px hairline, a 200 px
 * project section, and Recent projects as a 28 px eyebrow over 32 px rows.
 */
const Harness: React.FC<HarnessProps> = ({
  room,
  enabled = true,
  wantProject = true,
  recentCount = 3,
  logoRoom = 0,
  navHeight = 300,
  roundClient = false,
  snap = () => 0,
  spacer,
  wantCloudCard,
  navJitter = 0,
  cardMargin = 0,
  cardUnmeasured = 0,
  cardJitter = 0,
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const fit = useRailFit(scrollerRef, contentRef, { enabled, wantProject, recentCount, logoRoom, wantCloudCard });
  const client = room + RAIL_FIT_PADDING - fit.logoAir + snap(fit.logoAir) + (fit.cloudCard ? cardJitter : 0);
  return (
    <div ref={scrollerRef} data-testid="scroller" data-air={fit.logoAir} data-client={roundClient ? Math.round(client) : client}>
      <div ref={contentRef}>
        <nav data-h={navHeight - (fit.recentRows > 0 ? 0 : navJitter)} />
        {(fit.project || fit.recentRows > 0) && <div data-rail-section="divider" data-h="13" />}
        {fit.project && <div data-rail-section="project" data-testid="project" data-h="200" />}
        {fit.recentRows > 0 && (
          <div data-rail-section="recent" data-testid="recent">
            <p data-h="28" />
            <div data-rail-rows="">
              {Array.from({ length: fit.recentRows }, (_, index) => (
                <a key={index} data-h="32" />
              ))}
            </div>
          </div>
        )}
        {spacer !== undefined && <div data-rail-spacer="" data-h={spacer} />}
        {fit.cloudCard && (
          <section data-rail-section="cloud" data-testid="cloud-card" data-h="120" style={{ marginTop: cardMargin }} />
        )}
        {fit.cloudCard && cardUnmeasured > 0 && <div data-h={cardUnmeasured} />}
      </div>
    </div>
  );
};

const shown = () => ({
  project: screen.queryByTestId('project') !== null,
  recentRows: screen.queryByTestId('recent')?.querySelectorAll('a').length ?? 0,
});

describe('useRailFit', () => {
  it('does not count the free room a spacer takes as content', () => {
    // The Community rail's spacer fills what the window leaves: counted, it
    // would make the rail look full and drop sections that fit.
    render(<Harness room={300 + 13 + 200 + 28 + 3 * 32} spacer={120} />);
    expect(shown()).toEqual({ project: true, recentRows: 3 });
  });

  it('shows both sections when the rail holds them', () => {
    render(<Harness room={300 + 13 + 200 + 28 + 3 * 32} />);
    expect(shown()).toEqual({ project: true, recentRows: 3 });
  });

  it('gives way a recent row at a time, then the current project, from what it measured', () => {
    const { rerender } = render(<Harness room={600} />);
    expect(shown()).toEqual({ project: true, recentRows: 1 });
    rerender(<Harness room={540} />);
    expect(shown()).toEqual({ project: true, recentRows: 0 });
    // The current project no longer fits (513): its room goes to Recent projects.
    rerender(<Harness room={500} />);
    expect(shown()).toEqual({ project: false, recentRows: 3 });
    rerender(<Harness room={340} />);
    expect(shown()).toEqual({ project: false, recentRows: 0 });
  });

  it('brings the sections back when the window grows, with the heights it measured', () => {
    const { container, rerender } = render(<Harness room={360} />);
    expect(shown()).toEqual({ project: false, recentRows: 0 });
    const scroller = container.firstElementChild as HTMLElement;
    scroller.dataset.client = String(700 + RAIL_FIT_PADDING);
    act(() => observers.forEach((callback) => callback()));
    expect(shown()).toEqual({ project: true, recentRows: 3 });
    rerender(<Harness room={700} />);
    expect(shown()).toEqual({ project: true, recentRows: 3 });
  });

  it('lists as many recent projects as fit on a page without a project', () => {
    render(<Harness room={300 + 13 + 28 + 2 * 32} wantProject={false} />);
    expect(shown()).toEqual({ project: false, recentRows: 2 });
  });

  it('shows everything wanted when it is off (the phone drawer scrolls) or nothing is laid out', () => {
    render(<Harness room={100} enabled={false} />);
    expect(shown()).toEqual({ project: true, recentRows: 3 });
  });

  it('gives the logo the air the richest page leaves, the same on every page', () => {
    // The richest page: 300 + 13 + 200 + one recent row (60) = 573; 25 px are left.
    const { rerender } = render(<Harness room={598} logoRoom={40} />);
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '25');
    expect(shown()).toEqual({ project: true, recentRows: 1 });
    rerender(<Harness room={598} logoRoom={40} wantProject={false} />);
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '25');
    rerender(<Harness room={700} logoRoom={40} />);
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '40');
    expect(shown()).toEqual({ project: true, recentRows: 3 });
  });

  // With fractional display scaling (e.g. 125 %) the rail's heights are
  // fractional and the scroller's clientHeight a whole pixel, so each measure could give the logo
  // a slightly different air, which moves the scroller, which changes the next measure: React
  // would stop after 50 nested updates and the page would crash.
  it('settles when the browser rounds the scroller to a whole pixel and the rail is fractional', () => {
    // The richest page: 300.37 + 13 + 200 + one recent row (60) = 573.37; 24.63 px are left.
    render(<Harness room={598} logoRoom={40} navHeight={300.37} roundClient />);
    const air = Number(screen.getByTestId('scroller').dataset.air);
    expect(Number.isInteger(air)).toBe(true);
    // Never more than is left, so the richest page still fits without scrolling.
    expect(air).toBeGreaterThanOrEqual(23);
    expect(air).toBeLessThanOrEqual(24);
    expect(shown()).toEqual({ project: true, recentRows: 1 });
  });

  it('settles at every height of a window with a fractional rail', () => {
    // A sparse page: the AppSec home, no project, no recent one. The richest page is
    // 300.37 + 13 + 206 (the project's estimate) = 519.37: the logo breathes from 520 to 559.
    for (let room = 515; room <= 565; room += 1) {
      const { unmount } = render(<Harness room={room} logoRoom={40} navHeight={300.37} roundClient wantProject={false} recentCount={0} />);
      const air = Number(screen.getByTestId('scroller').dataset.air);
      expect(Number.isInteger(air)).toBe(true);
      unmount();
    }
  });

  it('does not chase a pixel the sub-pixel snapping gives and takes back', () => {
    // The browser snaps the logo's fractional padding: here an odd air leaves the scroller a
    // pixel more after rounding. Air 23 leaves room for 24, air 24 for 23: without a rule,
    // the measure would alternate forever. The richest page: 301.37 + 13 + 200 + 60 = 574.37.
    render(
      <Harness room={598.5} logoRoom={40} navHeight={301.37} roundClient snap={(air) => (air % 2 === 1 ? 0.03 : -0.03)} />,
    );
    // The smaller of the two: never more air than the rail can give.
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '23');
    expect(shown()).toEqual({ project: true, recentRows: 1 });
  });

  it('still gives the logo the air of a window that grew by more than a pixel', () => {
    const { rerender } = render(<Harness room={590} logoRoom={40} />);
    // The richest page: 300 + 13 + 200 + 60 = 573.
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '17');
    rerender(<Harness room={593} logoRoom={40} />);
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '20');
    rerender(<Harness room={585} logoRoom={40} />);
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '12');
  });

  // Chrome snaps each box to its layout grid, so the rail less its sections need not measure the
  // same with a section shown and hidden. At the edge, each layout then decides for the other:
  // the measure after every render switched between them until React gave up (error #185).
  it('settles on the smaller layout when two layouts each decide for the other', () => {
    // With a recent row the navigation measures 300 and the row does not fit (573 > 572.8);
    // without it the navigation measures 299.5 and the row fits (572.5).
    expect(() => render(<Harness room={572.8} navJitter={0.5} logoRoom={40} />)).not.toThrow();
    expect(shown()).toEqual({ project: true, recentRows: 0 });
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '0');
  });

  it('shows a section again once the window grows after settling', () => {
    const { container } = render(<Harness room={572.8} navJitter={0.5} />);
    const scroller = container.firstElementChild as HTMLElement;
    scroller.dataset.client = String(700 + RAIL_FIT_PADDING);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    act(() => observers.forEach((callback) => callback()));
    expect(shown()).toEqual({ project: true, recentRows: 3 });
  });

  it('gives the logo no air off the desktop rail', () => {
    render(<Harness room={2000} logoRoom={40} enabled={false} />);
    expect(screen.getByTestId('scroller')).toHaveAttribute('data-air', '0');
  });

  it('lists no recent project when there is none', () => {
    render(<Harness room={2000} recentCount={0} />);
    expect(shown()).toEqual({ project: true, recentRows: 0 });
  });

  describe('the Community rail\'s Cloud card', () => {
    const cardShown = () => screen.queryByTestId('cloud-card') !== null;

    it('is not decided on the cloud rail, which never asks for it', () => {
      render(<Harness room={2000} />);
      expect(cardShown()).toBe(false);
    });

    it('shows when the window holds it with every section the page shows', () => {
      render(<Harness room={300 + 13 + 200 + 28 + 3 * 32 + 120} wantCloudCard />);
      expect(cardShown()).toBe(true);
      expect(shown()).toEqual({ project: true, recentRows: 3 });
    });

    it('goes first on a shorter window, before a recent row, with the height it measured', () => {
      const { rerender } = render(<Harness room={300 + 13 + 200 + 28 + 3 * 32 + 120} wantCloudCard />);
      rerender(<Harness room={300 + 13 + 200 + 28 + 3 * 32 + 119} wantCloudCard />);
      expect(cardShown()).toBe(false);
      expect(shown()).toEqual({ project: true, recentRows: 3 });
    });

    it('comes back when the window grows again', () => {
      const { container } = render(<Harness room={400} wantCloudCard wantProject={false} recentCount={0} />);
      expect(cardShown()).toBe(false);
      const scroller = container.firstElementChild as HTMLElement;
      scroller.dataset.client = String(300 + 120 + RAIL_FIT_PADDING);
      act(() => observers.forEach((callback) => callback()));
      expect(cardShown()).toBe(true);
    });

    it('shows off the desktop rail, which scrolls', () => {
      render(<Harness room={100} enabled={false} wantCloudCard />);
      expect(cardShown()).toBe(true);
    });

    // A section's margin is outside its box: left out of its height, it stayed in the base while
    // the card showed and left it when the card went, so in a band as wide as the margin the card
    // went, then came back, after every render, until React gave up (« Minified React error #185 »)
    // and every project page crashed.
    it('counts a section\'s margins, so a window a few pixels short of the card settles', () => {
      for (let room = 300 + 120; room <= 300 + 124; room += 1) {
        const { unmount } = render(
          <Harness room={room} wantCloudCard cardMargin={4} wantProject={false} recentCount={0} />,
        );
        expect(cardShown()).toBe(room >= 300 + 124);
        unmount();
      }
    });

    it('settles where the card and a section trade places, on a project page', () => {
      // The richest page with the card: 300 + 13 + 200 + 60 + 124 = 697.
      for (let room = 690; room <= 700; room += 1) {
        const { unmount } = render(<Harness room={room} wantCloudCard cardMargin={4} recentCount={1} />);
        expect(shown()).toEqual({ project: true, recentRows: 1 });
        expect(cardShown()).toBe(room >= 697);
        unmount();
      }
    });

    // Whatever makes two layouts take turns, the browser may not give the scroller the same
    // height in both: a pixel more or less, or a fraction, once rounded. The rail still settles,
    // on the layout that shows less.
    it.each([0, 0.4, 1, -1, 1.5, -1.5])('settles when the card and its absence take turns and the room moves by %s px', (jitter) => {
      for (let room = 418; room <= 426; room += 1) {
        const { unmount } = render(
          <Harness room={room} wantCloudCard cardUnmeasured={6} cardJitter={jitter} wantProject={false} recentCount={0} />,
        );
        unmount();
      }
    });

    it('is not shown once dismissed', () => {
      render(<Harness room={2000} wantCloudCard={false} />);
      expect(cardShown()).toBe(false);
    });
  });
});

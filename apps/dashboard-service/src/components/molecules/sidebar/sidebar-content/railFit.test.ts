import { describe, expect, it } from 'vitest';

import { decideRailFit } from './railFit';

/**
 * The AppSec rail never scrolls on a desktop. What the window cannot
 * hold is left out, Recent projects first — a row at a time, the oldest
 * first — then the current project; the navigation, the checklist and the
 * foot always stay.
 */
describe('decideRailFit', () => {
  // Recent projects with one, two, three rows: a 28 px eyebrow, 32 px rows 2 px apart.
  const recent = [60, 94, 128];
  const sizes = { base: 380, recent, project: 96 };

  it('shows both sections when everything fits, to the pixel', () => {
    expect(decideRailFit({ available: 604, ...sizes })).toMatchObject({ recentRows: 3, project: true });
  });

  it('drops the oldest recent projects first, a row at a time', () => {
    expect(decideRailFit({ available: 603, ...sizes })).toMatchObject({ recentRows: 2, project: true });
    expect(decideRailFit({ available: 536, ...sizes })).toMatchObject({ recentRows: 1, project: true });
  });

  it('then drops Recent projects, then the current project as well', () => {
    expect(decideRailFit({ available: 535, ...sizes })).toMatchObject({ recentRows: 0, project: true });
    expect(decideRailFit({ available: 439, ...sizes })).toMatchObject({ recentRows: 0, project: false });
  });

  it('gives the room the current project leaves to Recent projects, rather than leaving it empty', () => {
    // The current project alone does not fit (380 + 200 > 510); three recent rows do (380 + 128).
    expect(decideRailFit({ available: 510, base: 380, recent, project: 200 })).toMatchObject({ recentRows: 3, project: false });
    expect(decideRailFit({ available: 475, ...sizes })).toMatchObject({ recentRows: 2, project: false });
  });

  it('fills a page without a project with as many recent projects as fit', () => {
    expect(decideRailFit({ available: 508, ...sizes, wantProject: false })).toMatchObject({ recentRows: 3, project: false });
    expect(decideRailFit({ available: 474, ...sizes, wantProject: false })).toMatchObject({ recentRows: 2, project: false });
    expect(decideRailFit({ available: 439, ...sizes, wantProject: false })).toMatchObject({ recentRows: 0, project: false });
  });

  it('shows no recent row when there is no recent project', () => {
    expect(decideRailFit({ available: 600, ...sizes, recent: [] })).toMatchObject({ recentRows: 0, project: true });
  });

  it('counts the hairline above the sections once, and only when one of them shows', () => {
    expect(decideRailFit({ available: 617, ...sizes, divider: 13 })).toMatchObject({ recentRows: 3, project: true });
    expect(decideRailFit({ available: 616, ...sizes, divider: 13 })).toMatchObject({ recentRows: 2, project: true });
    expect(decideRailFit({ available: 489, ...sizes, divider: 13 })).toMatchObject({ recentRows: 0, project: true });
    expect(decideRailFit({ available: 488, ...sizes, divider: 13 })).toMatchObject({ recentRows: 2, project: false });
    expect(decideRailFit({ available: 452, ...sizes, divider: 13 })).toMatchObject({ recentRows: 0, project: false });
  });

  it('shows what is wanted where nothing is laid out (jsdom, the hidden drawer copy)', () => {
    expect(decideRailFit({ available: 0, ...sizes })).toMatchObject({ recentRows: 3, project: true });
    expect(decideRailFit({ available: Number.NaN, ...sizes, wantProject: false })).toMatchObject({
      recentRows: 3,
      project: false,
    });
  });

  it('shows nothing optional when even the base does not fit, and lets the rail scroll', () => {
    expect(decideRailFit({ available: 300, ...sizes })).toMatchObject({ recentRows: 0, project: false });
  });

  describe('the logo\'s air', () => {
    // 40 px of air the logo block can take; the richest page is the current project and one recent row.
    const room = { ...sizes, logoRoom: 40 };

    it('is none unless asked for, and none where nothing is laid out', () => {
      expect(decideRailFit({ available: 2000, ...sizes })).toEqual({ recentRows: 3, project: true, logoAir: 0 });
      expect(decideRailFit({ available: 0, ...room })).toEqual({ recentRows: 3, project: true, logoAir: 0 });
    });

    it('takes all its room on a window that holds the richest page with room to spare', () => {
      expect(decideRailFit({ available: 380 + 96 + 60 + 40, ...room })).toEqual({ recentRows: 1, project: true, logoAir: 40 });
    });

    it('takes only what is left, and gives it all back before a section goes', () => {
      expect(decideRailFit({ available: 556, ...room })).toEqual({ recentRows: 1, project: true, logoAir: 20 });
      expect(decideRailFit({ available: 536, ...room })).toEqual({ recentRows: 1, project: true, logoAir: 0 });
      expect(decideRailFit({ available: 535, ...room })).toEqual({ recentRows: 0, project: true, logoAir: 0 });
    });

    it('is the same on a page without a project, so the rail does not move from page to page', () => {
      expect(decideRailFit({ available: 576, ...room, wantProject: false })).toEqual({ recentRows: 3, project: false, logoAir: 40 });
      expect(decideRailFit({ available: 556, ...room, wantProject: false })).toMatchObject({ logoAir: 20 });
    });

    it('reserves no recent row when there is no recent project', () => {
      expect(decideRailFit({ available: 380 + 96 + 40, ...room, recent: [] })).toEqual({ recentRows: 0, project: true, logoAir: 40 });
    });

    it('is none when even the base does not fit', () => {
      expect(decideRailFit({ available: 300, ...room })).toEqual({ recentRows: 0, project: false, logoAir: 0 });
    });

    // Measured heights are fractional where a font or the display scaling makes them so (125 %
    // on Windows): the air is rounded down to a whole pixel, never more than is left, and the
    // sections are decided as with the exact air.
    it('is a whole number of pixels, rounded down', () => {
      expect(decideRailFit({ available: 556.63, ...room })).toEqual({ recentRows: 1, project: true, logoAir: 20 });
      expect(decideRailFit({ available: 536.99, ...room })).toEqual({ recentRows: 1, project: true, logoAir: 0 });
    });
  });

  // The Community Edition's « CybeDefend Cloud » card: an invitation, the
  // first thing to give way. It shows only once every section the rail would show fits with it,
  // so a short window drops the card before a recent row, the current project or the navigation.
  describe('the Cloud card', () => {
    const card = { ...sizes, cloudCard: 120, wantCloudCard: true };

    it('is not decided unless asked for, so the cloud rail reads as before', () => {
      expect(decideRailFit({ available: 2000, ...sizes })).not.toHaveProperty('cloudCard');
    });

    it('shows when everything fits with it, to the pixel', () => {
      expect(decideRailFit({ available: 604 + 120, ...card })).toMatchObject({ recentRows: 3, project: true, cloudCard: true });
    });

    it('is the first to give way: a pixel short drops the card, not a recent row', () => {
      expect(decideRailFit({ available: 603 + 120, ...card })).toMatchObject({ recentRows: 3, project: true, cloudCard: false });
      expect(decideRailFit({ available: 604, ...card })).toMatchObject({ recentRows: 3, project: true, cloudCard: false });
    });

    it('needs only what the page shows: on a page without a project it fits in the project\'s room', () => {
      expect(decideRailFit({ available: 380 + 128 + 120, ...card, wantProject: false })).toMatchObject({ recentRows: 3, project: false, cloudCard: true });
    });

    it('is not shown when not wanted (dismissed), and leaves the sections their room', () => {
      expect(decideRailFit({ available: 2000, ...card, wantCloudCard: false })).toMatchObject({ recentRows: 3, project: true, cloudCard: false });
    });

    it('takes the logo\'s air before it goes', () => {
      // One recent project. The richest page with the card: 380 + 96 + 60 + 120 = 656.
      const one = { ...card, recent: [60], logoRoom: 40 };
      expect(decideRailFit({ available: 676, ...one })).toMatchObject({ logoAir: 20, recentRows: 1, cloudCard: true });
      expect(decideRailFit({ available: 656, ...one })).toMatchObject({ logoAir: 0, recentRows: 1, cloudCard: true });
      expect(decideRailFit({ available: 655, ...one })).toMatchObject({ logoAir: 0, recentRows: 1, cloudCard: false });
    });

    it('is shown where nothing is laid out, as everything wanted is', () => {
      expect(decideRailFit({ available: 0, ...card })).toMatchObject({ cloudCard: true });
    });
  });
});

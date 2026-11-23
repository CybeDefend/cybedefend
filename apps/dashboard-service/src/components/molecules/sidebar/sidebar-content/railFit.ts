/**
 * What the AppSec rail can show without scrolling: the rail never shows a
 * scroll bar. The navigation,
 * the checklist and the foot always stay; the two sections under the
 * navigation give way when the window cannot hold them: Recent projects
 * first, a row at a time (the oldest first: the project you just left is the
 * one you go back to), then the current project. The room the current project
 * leaves then goes back to Recent projects: a rail with a hole in its middle
 * reads as too empty.
 *
 * The logo block at the top of the rail breathes with the window (more room,
 * more air): it takes up to
 * `logoRoom` px of air, but only what is left once the richest page — the
 * current project and one recent row — fits, so it gives its air back before
 * any section goes, and it is the same on every page of a window: the rail
 * never moves when you change page.
 *
 * Decided from heights the browser measured, not from window thresholds: a
 * French label that wraps, a trial meter or a finished checklist changes what
 * fits.
 */
export interface RailFitInput {
  /** The height the rail's scroller offers its content. Not laid out (0, NaN): everything wanted is shown. */
  available: number;
  /** The height of what always shows in the scroller: the navigation, the checklist, the trial meter. */
  base: number;
  /** The height of « Recent projects » with one row, two rows…, its eyebrow included; empty when there is none. */
  recent: readonly number[];
  /** The height of « Current project ». */
  project: number;
  /** The hairline that parts the navigation from the sections: paid once, when one of them shows. */
  divider?: number;
  /** False off a project page. */
  wantProject?: boolean;
  /** The air the logo block may take above its compact height; `available` is measured with the logo compact. */
  logoRoom?: number;
  /** The height of the Community Edition's « CybeDefend Cloud » card. */
  cloudCard?: number;
  /**
   * Whether the card is wanted (the Community rail, not dismissed). Left out, the card is not
   * decided at all and the result has no `cloudCard`: the cloud's rail reads as before.
   */
  wantCloudCard?: boolean;
}

export interface RailFit {
  /** How many recent projects to list; none hides the section. */
  recentRows: number;
  project: boolean;
  /** The air given to the logo block, 0 to `logoRoom`. */
  logoAir: number;
  /** Whether the « CybeDefend Cloud » card shows; present only when `wantCloudCard` was given. */
  cloudCard?: boolean;
}

export function decideRailFit({
  available,
  base,
  recent,
  project,
  divider = 0,
  wantProject = true,
  logoRoom = 0,
  cloudCard = 0,
  wantCloudCard,
}: RailFitInput): RailFit {
  // The card is decided only when asked: the cloud's result keeps its three keys.
  const withCard = (fit: RailFit, show: boolean): RailFit =>
    wantCloudCard === undefined ? fit : { ...fit, cloudCard: wantCloudCard && show };

  if (!(available > 0)) return withCard({ recentRows: recent.length, project: wantProject, logoAir: 0 }, true);

  // What the richest page needs, whichever page this is: the logo takes only what is left of it.
  // The card counts in it, so the logo gives its air back before the card goes.
  const card = wantCloudCard ? cloudCard : 0;
  const richest = base + divider + project + (recent.length > 0 ? recent[0] : 0) + card;
  const air = Math.min(Math.max(available - richest, 0), logoRoom);
  const room = available - air;
  // The logo gets whole pixels, rounded down. The scroller's height is read back as a whole
  // pixel (`clientHeight`) while the rail's heights need not be (fonts, 125 % display scaling):
  // a fractional air never measured the same twice, and the measure after every render looped
  // until React gave up. The sections are decided with the exact air.
  const logoAir = Math.floor(air);

  const fits = (recentRows: number, showProject: boolean): boolean =>
    base +
      (recentRows > 0 || showProject ? divider : 0) +
      (recentRows > 0 ? recent[recentRows - 1] : 0) +
      (showProject ? project : 0) <=
    room;

  // The current project stays if it fits on its own; else the room it leaves goes to Recent projects.
  // The sections are decided without the card: it is the first to give way, and shows only in the
  // room the sections the page shows leave.
  const showProject = wantProject && fits(0, true);
  let recentRows = 0;
  for (let rows = recent.length; rows > 0; rows -= 1) {
    if (fits(rows, showProject)) {
      recentRows = rows;
      break;
    }
  }
  const sections =
    base +
    (recentRows > 0 || showProject ? divider : 0) +
    (recentRows > 0 ? recent[recentRows - 1] : 0) +
    (showProject ? project : 0);
  return withCard({ recentRows, project: showProject, logoAir }, sections + card <= room);
}

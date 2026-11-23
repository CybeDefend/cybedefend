import type React from 'react';

import { AS_FOCUS_RAIL } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';

/**
 * The class strings of the AppSec rail: one place, so the navigation, the current project, the recent
 * projects and the posture cannot drift apart by a shade. The rail is navy
 * in both themes (`data-surface="dark"`): words are zinc-300 or lighter,
 * 11 px captions zinc-400, hairlines white at 8 %, hover white at 6 %, and
 * the current row keeps the `from-secondary/20` wash with a 2 px accent bar.
 */

/*
 * The rail's ground: black with a touch of violet, and clearly set apart
 * from the page in both themes. On the light theme, a near-black written as a
 * literal (the `vd-*` tokens exist only under another product space's
 * `data-product`). On the dark theme the black melted into the
 * page, so the rail takes the header's surface (`as-surface`): rail and header
 * frame the page as one piece of chrome, the content sits one step deeper,
 * and the hairline at the rail's edge cuts the column. Sidebar.tsx and the
 * phone drawer in Header.tsx write the same ground.
 */
export const RAIL_BLACK = 'bg-[#060608] dark:bg-as-surface';
/**
 * A breath of the brand violet at the top of the dark rail: a touch of
 * violet, never a fill. The accent
 * token, so it is violet in AppSec.
 */
export const RAIL_HAZE =
  'dark:bg-[radial-gradient(ellipse_150%_34%_at_0%_-4%,rgb(var(--color-secondary-rgb)/0.16),transparent_72%)]';
/**
 * The logo slot at the top of the rail: the logo breathes, centred, with
 * more air when the window has more room. Centred and width-agnostic, it holds
 * the CybeDefend logo. `--rail-logo-h` sizes what
 * it holds: compact, 32 (today's block: 8 px above, a 44 px link, 4 below);
 * with all of its `RAIL_LOGO_ROOM` px of air (`railLogoSlotStyle`), 40, with
 * 28 px above and 16 below. The air is decided by the fit (`useRailFit`),
 * never by a breakpoint.
 */
export const RAIL_LOGO_SLOT = 'flex justify-center px-3';
/**
 * The shared `Logo` atom in the slot: its wordmark as tall as
 * `--rail-logo-h`, 32 to 40 px (134 to 167 px wide, within the 180 px the
 * 224 px rail leaves it), its link 12 px taller (44 to 52 px, a thumb's
 * reach). The atom is a fixed-size wordmark, so the slot sizes it.
 */
export const RAIL_LOGO_FIT = '[&_img]:h-[var(--rail-logo-h)]';
export const RAIL_LOGO_ROOM = 40;

export function railLogoSlotStyle(air: number): React.CSSProperties {
  const share = Math.min(Math.max(air, 0), RAIL_LOGO_ROOM) / RAIL_LOGO_ROOM;
  return {
    paddingTop: 8 + 20 * share,
    paddingBottom: 4 + 12 * share,
    ['--rail-logo-h' as string]: `${32 + 8 * share}px`,
  };
}

/** A floating layer over the rail (a menu, a popover): the zinc kit's raised dark layer (`vd-raised`). */
export const RAIL_RAISED = 'bg-[#1B1B20]';

/** The eyebrow of a section (« Discover », « Current project »). */
export const RAIL_EYEBROW = 'px-2.5 pb-1 pt-2.5 text-[11px] font-medium leading-4 text-zinc-400';

/** A hairline of the rail. */
export const RAIL_HAIRLINE = 'bg-white/[0.08]';

/** A row of the rail: at least 32 px (44 to a thumb below md), 12 px (slightly smaller type). */
export const RAIL_ROW = cn(
  'group relative flex min-h-8 w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium leading-5 transition-colors duration-[120ms] max-md:min-h-11',
  AS_FOCUS_RAIL,
);

/** A row of a project's tabs: 28 px, under the project's name. */
export const RAIL_TAB_ROW = cn(
  'group relative flex min-h-7 w-full items-center gap-2.5 rounded-md px-2.5 py-1 text-[12px] leading-4 transition-colors duration-[120ms] max-md:min-h-11',
  AS_FOCUS_RAIL,
);

/** The current row: the pinned wash (`from-secondary/20`) and white words. */
export const RAIL_ROW_ACTIVE = 'bg-gradient-to-r from-secondary/20 to-transparent text-white';
/** An idle row: zinc-300, white on a 6 % white fill when hovered. */
export const RAIL_ROW_IDLE = 'text-zinc-300 hover:bg-white/[0.06] hover:text-white';

/** The 2 px accent bar of the current row (16 px tall on a 32 px row, 14 on a 28 px one). */
export const RAIL_MARKER = 'absolute inset-y-0 left-0 my-auto h-4 w-0.5 rounded-full bg-secondary';
export const RAIL_TAB_MARKER = 'absolute inset-y-0 left-0 my-auto h-3.5 w-0.5 rounded-full bg-secondary';

/** The glyph of a row: zinc-500 at rest, lighter under the pointer, zinc-100 on the current row. */
export const RAIL_GLYPH_IDLE = 'text-zinc-500 group-hover:text-zinc-300';
export const RAIL_GLYPH_ACTIVE = 'text-zinc-100';

/**
 * The class strings every piece of the zinc kit shares. One place, so a menu, a popover and a tooltip cannot drift
 * apart by a shade.
 */

/**
 * The keyboard focus ring: the brand violet (« iris »), one of the few places
 * the space spends it, offset onto the page token. Only ever on
 * `focus-visible`, so a click never lights it.
 */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-iris/80 focus-visible:ring-offset-1 focus-visible:ring-offset-vd-bg';

/** The ring of a field that holds the focus (input, textarea): an iris edge and a 3 px halo, not a hard outline. */
export const FIELD_FOCUS =
  'focus:border-iris/60 focus:outline-none focus:ring-[3px] focus:ring-iris/[0.12] focus:ring-offset-0 dark:focus:border-iris/50 dark:focus:ring-iris/[0.16]';

/** A field at rest: 1 px hairline, 13 px text; in dark a raised well (`vd-raised`) on the panel. */
export const FIELD =
  'w-full rounded-lg border border-zinc-200 bg-white text-[13px] text-zinc-900 shadow-none max-md:text-base placeholder:text-zinc-400 transition-[border-color,box-shadow] duration-[120ms] hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-red-500/60 dark:border-vd-line-strong dark:bg-vd-raised dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-white/[0.2]';

/**
 * A floating layer (menu, popover, command menu): hairline, 8 px radius. In
 * light the panel colour and the kit's soft shadow; in dark the raised
 * token, a stronger hairline, a 1 px inner top highlight and a deep, soft drop
 * shadow, so the layer reads above the plates under it.
 */
export const FLOATING_SURFACE =
  'rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:border-vd-line-strong dark:bg-vd-raised dark:text-zinc-100 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]';

/** Scale and fade from where the layer was opened (120 ms in, 90 ms out). */
export const FLOATING_MOTION =
  'data-[state=open]:animate-vd-pop-in data-[state=closed]:animate-vd-pop-out motion-reduce:animate-none';

/** One row of a menu or a list of choices: 32 px, 13 px, a zinc tint when highlighted. */
export const MENU_ITEM =
  'relative flex h-8 w-full max-md:h-11 cursor-default select-none items-center gap-2 rounded-md px-2 text-[13px] text-zinc-700 outline-none transition-colors duration-[80ms] data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900 dark:text-zinc-300 dark:data-[highlighted]:bg-white/[0.06] dark:data-[highlighted]:text-zinc-50 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-zinc-400';

/**
 * A plate in dark (a panel, a card, a dialog): the surface token on its
 * hairline, lit by a 1 px inner highlight along the top edge, so it reads as
 * raised from the page rather than cut out of it. Light keeps the white sheet.
 */
export const PLATE_DARK = 'dark:border-vd-line dark:bg-vd-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]';

/**
 * The same top highlight for a plate whose cells paint their own colour (a
 * `gap-px` grid of figures), where an inset shadow would sit under them: a
 * 1 px line drawn above the cells. The host must be `relative`.
 */
export const PLATE_EDGE_DARK =
  "dark:after:pointer-events-none dark:after:absolute dark:after:inset-x-0 dark:after:top-0 dark:after:h-px dark:after:bg-white/[0.045] dark:after:content-['']";

/** The 1 px hairline between groups. */
export const HAIRLINE = 'bg-zinc-200 dark:bg-vd-line';

/**
 * Touch reach below `md` (phones, upright tablets): an invisible `::after`
 * 44 px tall, centred on the control, so a 28-32 px control keeps its look
 * and still takes a thumb (Apple's 44 pt). The host must be `relative`.
 * `TOUCH_HIT` grows the height only (controls side by side keep their own
 * columns); `TOUCH_HIT_SQUARE` grows an icon-only control both ways.
 */
export const TOUCH_HIT =
  "max-md:after:absolute max-md:after:inset-x-0 max-md:after:top-1/2 max-md:after:h-11 max-md:after:min-h-full max-md:after:-translate-y-1/2 max-md:after:content-['']";
export const TOUCH_HIT_SQUARE =
  "max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']";

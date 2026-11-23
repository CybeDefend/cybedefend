/**
 * The class strings of the second design pass that
 * the settings, profile, integration and flow screens share, so a notice on
 * the usage page and one in a registry modal cannot drift apart by a shade.
 * Written next to `styles.ts` rather than inside it; they may be folded in
 * there later. A destructive action is
 * `Button variant="destructive"` (the atom), not a recipe here.
 */

/**
 * A notice (an information, a success, a warning, an error) as a hairline
 * row: the sentence in ink, the status in a 6 px dot before it (`AS_NOTICE_DOT`
 * + a `NOTICE_DOT` colour). The tinted full-width banner it replaces put the
 * colour on the fill and on the words; here the colour carries the
 * information and the words stay readable in both themes.
 */
export const AS_NOTICE_FRAME =
  'rounded-lg border border-as-line px-3 py-2 text-[13px] text-zinc-700 dark:text-zinc-200';
/** One line: the dot centred on the sentence. */
export const AS_NOTICE = `flex items-center gap-2 ${AS_NOTICE_FRAME}`;
/** Several lines (a title and a sentence): the dot aligned with the first line. */
export const AS_NOTICE_BLOCK = `flex items-start gap-2 ${AS_NOTICE_FRAME}`;
/** The title line of a block notice. */
export const AS_NOTICE_TITLE = 'font-medium text-zinc-900 dark:text-zinc-100';
/**
 * The notice dots are gone (no data dots):
 * the exports stay and hide the element, so every notice follows at once.
 * Where a notice's status matters, write its sentence in the status colour
 * (`AS_WORD_TONE`, `atoms/appsec/styles.ts`).
 */
export const AS_NOTICE_DOT = 'hidden';
/** The former dot of a block notice: hidden too. */
export const AS_NOTICE_DOT_BLOCK = 'hidden';
/** The status colours of a notice dot: the status colours of the spec, unchanged. */
export const NOTICE_DOT = {
  info: 'bg-blue-500',
  success: 'bg-green-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  accent: 'bg-secondary',
} as const;

/**
 * A section-title icon without its tile: the same element, no fill, the glyph
 * 18 px in zinc (`AS_GLYPH` on the icon). The wrapper keeps its box, so the
 * title next to it does not move.
 */
export const AS_GLYPH_BOX = 'flex h-8 w-8 shrink-0 items-center justify-center';
export const AS_GLYPH = 'h-[18px] w-[18px] shrink-0 text-zinc-500 dark:text-zinc-400';

/**
 * The selected row of a settings side menu (teams, integration categories,
 * project settings), on the ghost Button: a zinc wash and a 2 px violet marker
 * on the left, never a solid fill. The Button is `relative`, so the marker is
 * its `::before` (its `::after` is the phone touch reach).
 */
export const AS_MENU_CURRENT =
  "bg-zinc-100 text-zinc-900 hover:bg-zinc-100 hover:text-zinc-900 dark:bg-white/[0.06] dark:text-zinc-50 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-secondary before:content-['']";
export const AS_MENU_IDLE =
  'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.03] dark:hover:text-zinc-100';

/**
 * A status or a risk level written as a word: a 6 px dot in its colour, the
 * word in ink (sentence case; `normal-case` when the source is uppercase).
 * The bordered, tinted pill it replaces carried the colour three times.
 */
export const AS_STATUS_WORD = 'inline-flex items-center gap-1.5 text-[13px] text-zinc-700 dark:text-zinc-200';
/** The former 6 px status dot: hidden (no data dots); colour the word with `AS_WORD_TONE` instead. */
export const AS_STATUS_DOT = 'hidden';

/** A quiet tag (a category, a scope, a priority): hairline, no fill. */
export const AS_TAG =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-as-line bg-transparent px-1.5 py-0.5 text-[12px] text-zinc-600 dark:text-zinc-300';

/** A count beside its kind: a dot, the mono number in ink, the kind in zinc. */
export const AS_COUNT = 'inline-flex items-center gap-1.5 font-mono text-[12px] tabular-nums';
export const AS_COUNT_NUMBER = 'text-zinc-700 dark:text-zinc-200';
export const AS_COUNT_KIND = 'text-zinc-500 dark:text-zinc-450';

/** An initials disc where there is no picture: zinc, as in the agents account menu. */
export const AS_AVATAR_FALLBACK =
  'flex items-center justify-center rounded-full bg-zinc-200 font-semibold text-zinc-700 dark:bg-white/[0.08] dark:text-zinc-200';

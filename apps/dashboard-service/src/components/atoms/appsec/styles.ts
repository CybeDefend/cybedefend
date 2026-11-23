/**
 * The class strings the AppSec refresh shares: one place,
 * so a field, a menu and a panel cannot drift apart by a shade. AppSec's
 * counterpart of `atoms/zinc/styles.ts`, in the AppSec accent.
 */

/** Keyboard focus: a 2 px violet ring, only on `focus-visible`, 1 px off the page colour. */
export const AS_FOCUS =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-as-bg';

/** The same ring drawn inside, for a row or a tab in a clipped list. */
export const AS_FOCUS_INSET = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary';

/** Focus on the navy rail (dark in both themes). */
export const AS_FOCUS_RAIL = 'focus:outline-none focus-visible:ring-1 focus-visible:ring-white/25';

/** A field at rest: hairline, white (raised well in dark), 16 px text on a phone. Size and padding come from the caller. */
export const AS_FIELD =
  'rounded-lg border border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 transition-[border-color,box-shadow] duration-[120ms] hover:border-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 max-md:text-base dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-white/[0.2]';

/** A field holding the focus: a violet edge and a 3 px halo. */
export const AS_FIELD_FOCUS =
  'focus:outline-none focus:border-secondary/60 focus:ring-[3px] focus:ring-secondary/15 dark:focus:border-secondary-light/50 dark:focus:ring-secondary/25';

/**
 * A native `<select>` on a fixed height (`h-8`, `h-9`, `max-md:h-11`): no
 * vertical padding. The forms plugin pads every select 8 px top and bottom,
 * and Chrome sets a select's line from the top of what is left, so a 32 px
 * box kept 14 px for a 20 px line and cut the descenders (« 10 / paqe » in
 * the pagers). Without the padding the browser centres the line
 * in the whole box, at every height. Inputs centre their line on their own
 * and keep the plugin's padding; a select with no height of its own needs its
 * padding and must not take this. Give a select a left padding (`pl-*`), not
 * `px-*`: the plugin's 40 px on the right is the room of its chevron, and a
 * `px-3` ran a long option under it.
 */
export const AS_SELECT = 'py-0';

/** A panel (card, table frame, chart frame): hairline, no shadow; in dark the surface lit by a 1 px top highlight. */
export const AS_PANEL =
  'rounded-2xl border border-zinc-200 bg-white dark:border-as-line dark:bg-as-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]';
/** A panel's padding: 16 px on a phone, 24 px from 480 px (the Card atom's `md`). */
export const AS_PANEL_PAD = 'p-4 sm:p-6';
export const AS_PANEL_TITLE = 'text-[15px] font-medium leading-6 tracking-[-0.01em] text-zinc-900 dark:text-zinc-100';
export const AS_META = 'text-[13px] text-zinc-500 dark:text-zinc-400';

/** A sub-card or well inside a panel. */
export const AS_WELL = 'rounded-xl border border-zinc-200 bg-zinc-50 dark:border-as-line dark:bg-white/[0.03]';

/** Page title (h1) and page section heading (h2). */
export const AS_PAGE_TITLE = 'text-2xl font-semibold tracking-[-0.02em] text-zinc-900 dark:text-zinc-50';
export const AS_SECTION_TITLE = 'text-lg font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-50';

/** A floating layer (menu, popover, dropdown panel). */
export const AS_FLOATING =
  'rounded-lg border border-zinc-200 bg-white text-zinc-900 shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]';

/** One row of a menu: 32 px (44 on a phone), 13 px, a zinc tint when hovered. */
export const AS_MENU_ITEM =
  'relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-zinc-700 transition-colors duration-[80ms] hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:bg-zinc-100 max-md:h-11 dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-50 dark:focus-visible:bg-white/[0.06]';

export const AS_HAIRLINE = 'bg-zinc-200 dark:bg-as-line';

/** A tooltip: ink on light, white on dark. */
export const AS_TOOLTIP = 'rounded-md bg-zinc-900 px-2 py-1 text-xs leading-4 text-white dark:bg-zinc-100 dark:text-zinc-900';

/** A small chip (status, count, tag). Colours come from the caller. */
export const AS_CHIP = 'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-xs font-medium';

/** Segmented control: a zinc track, the selected option a white pill with violet text. */
export const AS_SEGMENT_TRACK = 'inline-flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-white/[0.04]';
export const AS_SEGMENT_ITEM =
  'relative inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors duration-[120ms] focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary max-md:h-9';
export const AS_SEGMENT_ON =
  'bg-white text-secondary shadow-[0_1px_2px_rgb(0_0_0/0.08)] ring-1 ring-black/[0.04] dark:bg-as-raised dark:text-secondary-light dark:ring-white/[0.08]';
export const AS_SEGMENT_OFF = 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100';

/** Tables. */
export const AS_THEAD = 'bg-zinc-50/70 dark:bg-white/[0.02]';
/** For a `sticky` head only: opaque, so rows do not show through. */
export const AS_THEAD_STICKY = 'bg-zinc-50 dark:bg-[#16161a]';
export const AS_TH =
  'h-9 whitespace-nowrap px-4 text-left align-middle text-xs font-medium text-zinc-500 first:pl-5 last:pr-5 dark:text-zinc-400';
export const AS_TD = 'px-4 py-3 align-middle text-[13px] text-zinc-600 first:pl-5 last:pr-5 dark:text-zinc-400';
export const AS_TD_STRONG = 'font-medium text-zinc-900 dark:text-zinc-100';
export const AS_TR = 'transition-colors duration-[120ms] hover:bg-zinc-50 dark:hover:bg-white/[0.03]';
export const AS_DIVIDE = 'divide-y divide-zinc-100 dark:divide-as-line';

/** KPI block. */
export const AS_KPI_LABEL = 'text-[13px] text-zinc-500 dark:text-zinc-400';
export const AS_KPI_VALUE = 'text-[28px] font-medium leading-9 tracking-[-0.03em] tabular-nums text-zinc-900 dark:text-zinc-50';
export const AS_KPI_NOTE = 'text-xs text-zinc-500 dark:text-zinc-400';

/**
 * Touch reach below `md`: an invisible `::after` 44 px tall, so a 24-36 px
 * control keeps its look and still takes a thumb. The host must be `relative`
 * and must not clip (`overflow-hidden`). `AS_TOUCH` grows the height only;
 * `AS_TOUCH_SQUARE` grows an icon-only control both ways.
 */
export const AS_TOUCH =
  "max-md:after:absolute max-md:after:inset-x-0 max-md:after:top-1/2 max-md:after:h-11 max-md:after:min-h-full max-md:after:-translate-y-1/2 max-md:after:content-['']";
export const AS_TOUCH_SQUARE =
  "max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']";

/*
  ── Polish 2 (second design pass) ──────────────────────────────────────────
  Colour stays information and leaves the fills: a severity or a status is a
  6 px dot next to a word or a figure in zinc, a tag is a hairline, a selected
  row is a wash with a thin marker, an icon is a glyph. Every screen builds
  these from the strings below, so four agents produce one look.
*/

/**
 * The 6 px dot that carried a colour (a severity, a status) is gone (no data
 * dots): the colour moves into the word
 * (`AS_WORD_TONE`, `AS_RISK_TEXT`) and into a chart's own bars. The export
 * stays, and hides the element, so a caller not yet rewritten shows nothing.
 */
export const AS_DOT = 'hidden';

/**
 * The colour a word carries where a dot used to carry it: « Critical » in red,
 * « Resolved » in green. Text shades measured on their real surfaces, at least
 * 4.5:1 on white, zinc-50 and the dark AppSec surfaces (red-600 4.8:1,
 * orange-700 5.2:1, amber-700 5.0:1, blue-600 5.2:1, emerald-700 5.5:1, the
 * accent 5.1:1 on white; the -400 shades 6.2:1 and up on #18181b). Same values
 * as the KPI molecules' `WORD_TONE`, so a word and a KPI label agree.
 */
export const AS_WORD_TONE = {
  critical: 'text-red-600 dark:text-red-400',
  high: 'text-orange-700 dark:text-orange-400',
  medium: 'text-amber-700 dark:text-amber-400',
  low: 'text-blue-600 dark:text-blue-400',
  good: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-700 dark:text-amber-400',
  info: 'text-blue-600 dark:text-blue-400',
  accent: 'text-secondary dark:text-secondary-light',
  neutral: 'text-zinc-500 dark:text-zinc-400',
} as const;
export type AsWordTone = keyof typeof AS_WORD_TONE;

/** A risk level's word colour, by level (`fixed` and anything unknown stay zinc). */
export const AS_RISK_TEXT: Record<string, string> = {
  critical: AS_WORD_TONE.critical,
  high: AS_WORD_TONE.high,
  medium: AS_WORD_TONE.medium,
  low: AS_WORD_TONE.low,
  info: AS_WORD_TONE.info,
  fixed: AS_WORD_TONE.good,
};

/** The risk colour of a word whatever case the source gives the level (`CRITICAL`, `high`…); zinc otherwise. */
export const riskText = (level: string | null | undefined): string =>
  AS_RISK_TEXT[(level ?? '').toLowerCase()] ?? AS_WORD_TONE.neutral;

/** A count that used to be a pill (`6 C`): dot + mono figure + unit letter or word. */
export const AS_COUNT = 'inline-flex items-center gap-1.5 font-mono text-[12px] tabular-nums';
export const AS_COUNT_VALUE = 'text-zinc-700 dark:text-zinc-200';
export const AS_COUNT_UNIT = 'text-zinc-500 dark:text-zinc-450';
/**
 * A zero keeps its cell: the dot at 40 %, the figure a step quieter — but still
 * a word (rule 7): zinc-500 on white is 4.8:1, zinc-450 on the dark surfaces
 * 5.4:1, where the zinc-400 / zinc-500 first written here read 2.6:1 / 3.9:1
 * (every such figure failed AA in both themes).
 */
export const AS_COUNT_ZERO_DOT = 'opacity-40';
export const AS_COUNT_ZERO_VALUE = 'text-zinc-500 dark:text-zinc-450';

/** A word that used to be a pill (a risk level, a status, a verdict): dot + word in sentence case, 13 px. */
export const AS_DOT_WORD = 'inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] normal-case text-zinc-700 dark:text-zinc-200';
/**
 * Sentence case for a source string that arrives uppercase (`CRITICAL`): the
 * word is lowercased, then its first letter raised. `::first-letter` ignores an
 * inline, so the span is `inline-block`. The string itself is untouched.
 */
export const AS_SENTENCE_CASE = 'inline-block lowercase first-letter:uppercase';

/** A quiet tag (a mark on a finding, a count in a tab): a hairline, no fill. Its brand glyph takes `AS_TAG_GLYPH_ON` only while active. */
export const AS_TAG =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-as-line bg-transparent px-1.5 py-0.5 text-[12px] text-zinc-600 dark:text-zinc-300';
export const AS_TAG_GLYPH_ON = 'text-secondary dark:text-secondary-light';
/**
 * The accent tag (the usual violet on the words, the icon and the border):
 * the quiet tag with its words, glyph and hairline in
 * the accent, still no fill. In AppSec that is the brand violet, #7845FF on
 * light (5.1:1 on white) and #A78BFA on dark (6.3:1 and up).
 */
export const AS_TAG_ACCENT = 'border-secondary/40 text-secondary dark:border-secondary-light/40 dark:text-secondary-light';
export const AS_TAG_GLYPH_OFF = 'text-zinc-400 dark:text-zinc-500';

/** An icon that sat on a tinted tile: the same element, no fill, an 18 px zinc glyph. */
export const AS_ICON_QUIET = 'bg-transparent text-zinc-500 dark:text-zinc-400 [&>svg]:h-[18px] [&>svg]:w-[18px]';

/** A hairline row in place of a tinted full-width banner: `AS_DOT` in the status colour, then the sentence. */
export const AS_NOTICE =
  'flex items-center gap-2 rounded-lg border border-as-line px-3 py-2 text-[13px] text-zinc-700 dark:text-zinc-200';

/** A selected row: a zinc wash, never a solid fill. */
export const AS_ROW_SELECTED = 'bg-zinc-100 dark:bg-white/[0.06]';
/**
 * Its 2 px violet marker on the left edge, painted as a hard-stop background
 * of the row's first cell (a 2 px solid band, no blend). Never a `::before` on
 * a `<tr>`: the browser makes the generated box one more cell and every cell
 * of the selected row slid one column right
 * (`groupedTables.selectedRow.test.tsx`). Not a box-shadow either: a collapsed
 * table does not paint a cell's shadow.
 */
export const AS_ROW_MARKER =
  '[&>*:first-child]:bg-[linear-gradient(90deg,rgb(var(--color-secondary-rgb))_2px,transparent_2px)] dark:[&>*:first-child]:bg-[linear-gradient(90deg,rgb(var(--color-secondary-light-rgb))_2px,transparent_2px)]';

/**
 * The horizontal scroller that holds a results table inside its card. The
 * table brings its own bordered panel; the scroller pulls it out by 1 px on
 * each side, so the panel's side borders sit under the card's and its content
 * starts right at the card's inner edge, where the selected row's marker is
 * drawn. It used to pull it out by 6 px (`-m-1.5`, a copied UI-kit pattern missing
 * its `p-1.5` half): the table's first 5 px, the marker included, were cut by
 * the card. Top and bottom keep their 6 px, so nothing moves vertically; the
 * panel's top corners are squared, since they now show under the card's
 * header line.
 */
export const AS_RESULTS_SCROLLER =
  '-mx-px -my-1.5 overflow-x-auto custom-scrollbar [&>div>div:first-child]:rounded-t-none';

/** The current page of a pagination: violet text on a hairline square, no fill. */
export const AS_PAGE_CURRENT =
  'border border-zinc-300 bg-transparent text-secondary dark:border-as-line-strong dark:bg-transparent dark:text-secondary-light';

/** An avatar without a photo: initials on a zinc disc. */
export const AS_AVATAR =
  'inline-flex items-center justify-center rounded-full bg-zinc-200 text-zinc-700 dark:bg-white/[0.08] dark:text-zinc-200';

/** The product chip of a breadcrumb: zinc text on nothing, like the other crumbs (the root is not where the eye goes). */
export const AS_PRODUCT_CHIP = 'text-[13px] font-medium text-zinc-500 dark:text-zinc-400';

/*
  ── KPI cards with a touch of colour ───────────────────────────────────────
  The figure-first cards read too bare. Colour stays information: a 6 px dot in the KPI's own
  colour before its label (`AS_DOT` + a `KPI_DOT` colour), the delta in mint
  when it is good news, red when it is bad, zinc when it says nothing, and a
  tiny zinc sparkline only where the page already holds a series. The figure
  stays in ink, the glyph stays quiet.
*/
/** The label row of a KPI: its dot, then the label. */
export const AS_KPI_LABEL_ROW = 'flex min-w-0 items-center gap-2';
/** The colour of a KPI, carried by its label or figure: `AS_WORD_TONE` under the KPI names. */
export const KPI_TEXT = AS_WORD_TONE;
/** The colour of a KPI's dot, by what the KPI counts. The dot itself is hidden (`AS_DOT`); kept so no caller breaks. */
export const KPI_DOT = {
  critical: 'bg-critical-risk',
  high: 'bg-high-risk',
  medium: 'bg-medium-risk',
  low: 'bg-low-risk',
  good: 'bg-emerald-500',
  bad: 'bg-red-500',
  warning: 'bg-amber-500',
  info: 'bg-blue-500',
  accent: 'bg-secondary dark:bg-secondary-light',
  neutral: 'bg-zinc-400 dark:bg-zinc-500',
} as const;
/**
 * A delta by what it means, never by its sign: mint when it is good news
 * (the kit's mint values: emerald-700 5.5:1 on white, emerald-400 on the
 * dark surface), red when it is bad (red-600 4.8:1, red-400), zinc when it
 * says nothing.
 */
export const AS_DELTA = {
  good: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-zinc-500 dark:text-zinc-400',
} as const;
export type AsDeltaTone = keyof typeof AS_DELTA;
/** A KPI's sparkline: one thin zinc line, 64 × 20, quiet beside the delta. */
export const AS_KPI_SPARK = 'h-5 w-16 shrink-0 text-zinc-400 max-sm:w-10 dark:text-zinc-500';
/**
 * Several KPIs in one panel, split by hairlines (an instrument strip rather
 * than a grid of cards): the frame paints the hairlines through a 1 px gap,
 * each cell paints the surface back.
 */
export const AS_KPI_STRIP =
  'grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-as-line dark:bg-as-line';
export const AS_KPI_STRIP_CELL = 'min-w-0 bg-white p-4 sm:p-5 dark:bg-as-surface';

/** Recharts: pass these as props (`stroke`, `tick`, `contentStyle`, `cursor`). */
export const AS_CHART = {
  tick: { fill: 'var(--as-chart-tick)', fontSize: 11 },
  grid: 'var(--as-chart-grid)',
  cursor: { fill: 'var(--as-chart-cursor)' },
  tooltip: {
    background: 'var(--as-chart-tooltip-bg)',
    border: '1px solid var(--as-chart-tooltip-border)',
    borderRadius: 8,
    color: 'var(--as-chart-tooltip-text)',
    fontSize: 12,
    boxShadow: '0 4px 16px -4px rgb(0 0 0 / 0.12)',
  },
} as const;

import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EYE_MARK_SHAPES, EYE_MARK_SIZE } from '@/components/atoms/icon/eyeMark';
import { useMotionAllowed } from '@/utils/hooks/useMotionAllowed';
import { APPSEC, spaceOf, type Product } from '@/utils/product';
import { cn } from '@/utils/function/utils';

import { loaderSpaceFor, loaderStatusKeys, loaderThemeIsDark, type LoaderMark, type LoaderSpace } from './loaderHomeLogic';

/**
 * The full-page loader, at app start and in the route guards, in the family of the closed tree's map loader: a monochrome
 * drawing whose hairlines draw themselves, one quiet line in the accent, a
 * few words.
 *
 * - The mark of the space, read from the address: a space that registers its
 *   own `Mark` draws it (its accent, its page); every other — the Platform,
 *   the root, the pages common to every space — draws the CybeDefend eye
 *   (the Platform has no mark of its own).
 *   A 1 px hairline traces its outline, then a scan line in the accent passes
 *   down and leaves the mark inked behind it, its pupil in the accent; it
 *   holds, fades, and draws again.
 * - One plain line, in the UI font, says what the agents are busy with,
 *   changing every 1.8 s; a `title` given by the caller replaces it and
 *   stays. No dot, no separator, no dash.
 *
 * No gradient, no ring, no rotation. Motion is CSS keyframes written once
 * from the timeline below; the only timer is the status line. Where motion is
 * not allowed (reduced motion, the viewer's Calm choice, jsdom) the finished
 * mark stands still and the line changes without animation.
 *
 * It may render outside the router (App.tsx), so it reads
 * `window.location.pathname` and calls no router hook.
 */

interface LoaderHomeProps {
  title?: string;
  /** Dev preview only (`src/dev/LoaderPreview.tsx`): the space to show instead of the one read from the address. */
  space?: LoaderSpace;
  /** Dev preview only: the theme to show instead of the remembered one. */
  dark?: boolean;
}

/** The mark's edge in CSS px, and the stroke that makes a 1 px hairline at that size. */
const MARK_PX = 64;
const BOX = EYE_MARK_SIZE;
const HAIRLINE = BOX / MARK_PX;

/** The status line changes at this cadence. */
const STATUS_CADENCE_MS = 1800;

// ─── Timeline (seconds) ──────────────────────────────────────────────

const CYCLE = 6.4;
/** The two halves are traced together, the pupil once they are under way. */
const TRACE = [
  [0.15, 1.45],
  [0.15, 1.45],
  [0.7, 1.5],
] as const;
/** The scan line runs from SCAN_FROM to SCAN_TO (box units), inking the mark behind it. */
const SCAN_START = 1.35;
const SCAN_END = 2.35;
const SCAN_FROM = 50;
const SCAN_TO = 447;
/** The hairline outline gives way to the ink once the scan has passed. */
const TRACE_OUT = [2.3, 2.7] as const;
/** The whole mark fades before it is drawn again. */
const CYCLE_OUT = 5.8;

const pct = (s: number) => `${Math.min(100, Math.max(0, (s / CYCLE) * 100)).toFixed(3)}%`;

const buildCss = (): string => {
  const loop = `${CYCLE}s linear infinite`;
  const rules: string[] = [
    `@keyframes lh-cycle{0%,${pct(CYCLE_OUT)}{opacity:1}100%{opacity:0}}`,
    `.lh-cycle{animation:lh-cycle ${loop}}`,
    `@keyframes lh-trace-out{0%,${pct(TRACE_OUT[0])}{opacity:1}${pct(TRACE_OUT[1])},100%{opacity:0}}`,
    `.lh-trace{animation:lh-trace-out ${loop}}`,
    `@keyframes lh-reveal{0%,${pct(SCAN_START)}{transform:scaleY(${(SCAN_FROM / BOX).toFixed(4)});animation-timing-function:cubic-bezier(.45,0,.55,1)}${pct(SCAN_END)},100%{transform:scaleY(${(SCAN_TO / BOX).toFixed(4)})}}`,
    `.lh-reveal{transform-origin:0 0;animation:lh-reveal ${loop}}`,
    `@keyframes lh-scan{0%,${pct(SCAN_START)}{transform:translateY(${SCAN_FROM}px);opacity:0;animation-timing-function:cubic-bezier(.45,0,.55,1)}${pct(SCAN_START + 0.08)}{opacity:.9}${pct(SCAN_END - 0.05)}{opacity:.9}${pct(SCAN_END)}{transform:translateY(${SCAN_TO}px)}${pct(SCAN_END + 0.15)},100%{transform:translateY(${SCAN_TO}px);opacity:0}}`,
    `.lh-scan{animation:lh-scan ${loop}}`,
    '@keyframes lh-msg{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
    '.lh-msg{display:inline-block;animation:lh-msg .32s ease-out}',
  ];
  TRACE.forEach(([from, to], i) => {
    rules.push(
      `@keyframes lh-t${i}{0%,${pct(from)}{stroke-dashoffset:1;animation-timing-function:cubic-bezier(.45,0,.55,1)}${pct(to)},100%{stroke-dashoffset:0}}`,
      `.lh-t${i}{stroke-dasharray:1 1;animation:lh-t${i} ${loop}}`,
    );
  });
  return rules.join('\n');
};

const LOADER_CSS = buildCss();

// ─── The marks ───────────────────────────────────────────────────────

/**
 * Both marks are the eye's three shapes; the third (the pupil) carries the
 * accent. What tells a registered space apart is its accent and its page.
 */
const SHAPES: readonly string[] = EYE_MARK_SHAPES;

/** The accent of the mark: the space's own hint when it registers a mark, the brand violet elsewhere. */
const accentOf = (hasOwnMark: boolean): string => (hasOwnMark ? 'text-iris' : 'text-secondary');

/** The page: the space's own surface when it registers a mark, the Platform's elsewhere; zinc-50 in light for both. */
const pageOf = (hasOwnMark: boolean): string => (hasOwnMark ? 'bg-vd-bg' : 'bg-as-bg');

const INK = 'text-zinc-900 dark:text-zinc-100';
const HAIRLINE_TONE = 'text-zinc-400';

const currentPath = (): string => (typeof window === 'undefined' ? '/' : window.location.pathname);

const LoaderHome = ({ title, space: spaceProp, dark: darkOverride }: LoaderHomeProps) => {
  const { t } = useTranslation();
  const animate = useMotionAllowed();
  const clipId = `lh-clip-${useId().replace(/:/g, '')}`;
  // Read once: the loader is replaced, not navigated, when the app is ready.
  const [path] = useState(currentPath);
  const space: LoaderSpace = spaceProp ?? loaderSpaceFor(path);
  // A space that registers its own mark draws it; every other draws the house eye.
  const hasOwnMark = space !== 'cybedefend' && spaceOf(space as Product).Mark !== undefined;
  const mark: LoaderMark = hasOwnMark ? (space as Product) : 'cybedefend';
  // The remembered theme, on the loader's own root (`dark` scopes Tailwind's
  // `dark:` and the `as-*` / space tokens to this subtree).
  const [rememberedDark] = useState(loaderThemeIsDark);
  const dark = darkOverride ?? rememberedDark;
  const statusKeys = loaderStatusKeys(space);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (title) return undefined;
    const id = setInterval(() => setStep((i) => (i + 1) % statusKeys.length), STATUS_CADENCE_MS);
    return () => clearInterval(id);
  }, [title, statusKeys.length]);

  const shapes = SHAPES;
  const accent = accentOf(hasOwnMark);
  const line = title || t(statusKeys[step]);

  return (
    <div
      data-testid="loader-home"
      data-product={hasOwnMark ? (space as string) : APPSEC}
      className={cn('fixed inset-0 z-50 flex flex-col items-center justify-center px-4', pageOf(hasOwnMark), dark && 'dark')}
    >
      {animate && <style>{LOADER_CSS}</style>}
      <p className="sr-only" role="status">
        {title || t('common.loading')}
      </p>

      <svg
        data-testid="loader-home-mark"
        data-mark={mark}
        width={MARK_PX}
        height={MARK_PX}
        viewBox={`0 0 ${BOX} ${BOX}`}
        aria-hidden="true"
        focusable="false"
        className="shrink-0 overflow-visible"
      >
        {animate && (
          <defs>
            <clipPath id={clipId}>
              {/* Full height as drawn: if the animation never runs, the ink shows whole. */}
              <rect className="lh-reveal" x={0} y={0} width={BOX} height={BOX} />
            </clipPath>
          </defs>
        )}
        <g className={animate ? 'lh-cycle' : undefined}>
          <g data-fill="" clipPath={animate ? `url(#${clipId})` : undefined}>
            {shapes.map((d, i) => (
              <path key={i} d={d} fill="currentColor" className={i === 2 ? accent : INK} />
            ))}
          </g>
          {animate && (
            <g data-trace="" className={cn('lh-trace', HAIRLINE_TONE)}>
              {shapes.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={HAIRLINE}
                  strokeLinejoin="round"
                  pathLength={1}
                  className={`lh-t${i}`}
                />
              ))}
            </g>
          )}
          {animate && (
            <line
              data-scan-line=""
              x1={24}
              x2={BOX - 24}
              y1={0}
              y2={0}
              stroke="currentColor"
              strokeWidth={HAIRLINE}
              className={cn('lh-scan', accent)}
            />
          )}
        </g>
      </svg>

      <div
        data-testid="loader-home-status"
        aria-hidden="true"
        className="mt-8 flex h-5 max-w-full items-center justify-center text-[13px] leading-5 text-zinc-500 dark:text-zinc-450"
      >
        <span key={title ? 'title' : step} className={cn('min-w-0 truncate', animate && 'lh-msg')}>
          {line}
        </span>
      </div>
    </div>
  );
};

export default LoaderHome;

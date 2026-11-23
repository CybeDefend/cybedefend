import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '@/components/atoms/button/Button';
import { EYE_MARK_SHAPES, EYE_MARK_SIZE } from '@/components/atoms/icon/eyeMark';
import { RefreshCw } from '@/components/atoms/icon/icons';
import { loaderThemeIsDark } from '@/components/atoms/loader/loaderHomeLogic';
import { Button as VdButton } from '@/components/atoms/zinc/button';
import { useMotionAllowed } from '@/utils/hooks/useMotionAllowed';
import { cn } from '@/utils/function/utils';
import { spaceOf, type Product } from '@/utils/product';

import { APP_FAILURE_COPY, appFailureProduct, type AppFailureVariant } from './appFailureLogic';

/**
 * What the app shows when it cannot start, built from the app's own
 * components: the session
 * could not be restored, the profile and the organisation could not be
 * loaded (a gateway that answers 503), or rendering crashed (the root
 * `AppErrorBoundary`). One page, three variants, so all read as one family.
 *
 * It is the moment the start loader stops (`LoaderHome`): the same mark at the
 * same size, arriving inked as the loader leaves it and dimming to a still
 * zinc, the pupil kept in the accent; then a human title, one sentence that
 * says what happened without blaming anyone, and the way out. Calm, not an
 * alarm: no red, no icon tile, no card, no shadow.
 *
 * - The product comes from the address (`appFailureProduct`, with the one the
 *   tab was opened at for the two pages shown at boot): a space that registers
 *   its own `Mark` has its accent and ink buttons, and its `Lockup` in the
 *   header, under its prefix; every other shows the CybeDefend logo and the Platform's buttons
 *   (the last product used on a page common to every space). The shell has not
 *   set `data-product` on `<html>`, so the page carries it on its own root,
 *   with the remembered theme (`dark` scopes Tailwind's `dark:` and the tokens
 *   to this subtree).
 * - It prints only its own sentences, never a server's text.
 * - The actions are the caller's (App.tsx keeps the retry and the sign-in
 *   escape exactly as they were); the dev preview hands it inert ones.
 *
 * It renders outside the shell, so it reads `window.location.pathname` and
 * calls no router hook.
 */
export interface AppFailurePageProps {
  variant: AppFailureVariant;
  /** Try again: App.tsx restarts the sign-in bootstrap (session) or reloads the page (workspace). */
  onRetry: () => void;
  /** Sign in again, without a network call: App.tsx purges the stored session and goes to /login. */
  onSignIn: () => void;
  /** Dev preview only (`src/dev/AppFailurePreview.tsx`): the product to show instead of the one read from the address. */
  product?: Product;
  /** Dev preview only: the theme to show instead of the remembered one. */
  dark?: boolean;
}

/** The mark's edge in CSS px, as in the start loader. */
const MARK_PX = 64;
const BOX = EYE_MARK_SIZE;
/** The two halves of the mark; the third shape is the pupil. */
const HALVES = EYE_MARK_SHAPES.slice(0, 2);
const PUPIL = EYE_MARK_SHAPES[2];

/**
 * Entrance, once: the mark arrives inked, as the start loader left it, and
 * dims over a second, the pupil staying in the accent; the words rise 6 px
 * into place behind it. Nothing loops. Written only where motion is allowed
 * (`useMotionAllowed`: not under reduced motion, the Calm choice, jsdom),
 * where the dimmed mark stands at once.
 */
const FAILURE_CSS = [
  '@keyframes af-unlit{from{opacity:1}to{opacity:0}}',
  '.af-unlit{animation:af-unlit 1.1s cubic-bezier(.45,0,.55,1) .15s both}',
  '@keyframes af-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
  '.af-rise{animation:af-rise .42s cubic-bezier(.22,1,.36,1) both}',
].join('\n');

/** The page of each space, as behind the start loader: zinc-50 in light for both. */
const pageOf = (hasOwnMark: boolean): string => (hasOwnMark ? 'bg-vd-bg' : 'bg-as-bg');

/** The pupil: the space's own hint when it registers a mark, the brand violet (#7845FF, #A78BFA on dark) elsewhere. */
const accentOf = (hasOwnMark: boolean): string =>
  hasOwnMark ? 'text-iris' : 'text-secondary dark:text-secondary-light';

/** The two halves, dimmed: the mark is there, not lit. `INK` is how the start loader leaves them. */
const DIM = 'text-zinc-300 dark:text-zinc-700';
const INK = 'text-zinc-900 dark:text-zinc-100';

/** On a phone: full-width buttons, 44 px tall; side by side from 480 px, still 44 px under 768. */
const ACTION = 'max-sm:w-full max-md:h-11 max-md:text-[15px]';

const currentPath = (): string => (typeof window === 'undefined' ? '/' : window.location.pathname);

/**
 * The address the tab was opened at, read when App.tsx loads this module at
 * boot, before any navigation: a failed profile load moves the tab to
 * `/on-boarding` before this page mounts (`appFailureProduct`).
 */
const ENTRY_PATH = currentPath();

/** The header lockup: the space's own when it registers one, the CybeDefend logo otherwise. */
const ProductLockup: React.FC<{ product: Product }> = ({ product }) => {
  const Lockup = spaceOf(product).Lockup;
  return Lockup ? (
    <Lockup className="h-6 w-auto md:h-7" />
  ) : (
    <>
      <img src="/logo.webp" alt="CybeDefend" draggable={false} className="h-6 w-auto md:h-7 dark:hidden" />
      <img src="/logo-white.webp" alt="CybeDefend" draggable={false} className="hidden h-6 w-auto md:h-7 dark:block" />
    </>
  );
};

const StillMark: React.FC<{ product: Product; animate: boolean }> = ({ product, animate }) => {
  const accent = accentOf(spaceOf(product).Mark !== undefined);
  return (
    <svg
      data-testid="app-failure-mark"
      width={MARK_PX}
      height={MARK_PX}
      viewBox={`0 0 ${BOX} ${BOX}`}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <g className={DIM}>
        {HALVES.map((d) => (
          <path key={d} d={d} fill="currentColor" />
        ))}
      </g>
      {animate && (
        <g data-unlit="" className={cn('af-unlit', INK)}>
          {HALVES.map((d) => (
            <path key={d} d={d} fill="currentColor" />
          ))}
        </g>
      )}
      <path d={PUPIL} fill="currentColor" className={accent} />
    </svg>
  );
};

const AppFailurePage: React.FC<AppFailurePageProps> = ({ variant, onRetry, onSignIn, product: productOverride, dark: darkOverride }) => {
  const { t } = useTranslation();
  const animate = useMotionAllowed();
  // Read once: the page is replaced, not navigated, when the app starts again.
  const [path] = useState(currentPath);
  const [rememberedDark] = useState(loaderThemeIsDark);
  const product = productOverride ?? appFailureProduct(variant, path, ENTRY_PATH);
  const dark = darkOverride ?? rememberedDark;
  const hasOwnMark = spaceOf(product).Mark !== undefined;
  const copy = APP_FAILURE_COPY[variant];
  // The words rise in after the mark has begun to draw, one after the other.
  const rise = animate ? 'af-rise' : undefined;
  const after = (ms: number): React.CSSProperties | undefined => (animate ? { animationDelay: `${ms}ms` } : undefined);

  const retryLabel = t('components.appFailure.retry');
  const signInLabel = t('components.appFailure.signIn');
  const retryIcon = <RefreshCw size={16} strokeWidth={1.75} />;

  return (
    <div
      data-testid="app-failure"
      data-variant={variant}
      data-product={product}
      className={cn('flex min-h-screen min-h-[100dvh] flex-col', pageOf(hasOwnMark), dark && 'dark')}
    >
      {animate && <style>{FAILURE_CSS}</style>}

      <header className="flex h-16 shrink-0 items-center px-4 sm:px-6 md:h-[72px] md:px-8">
        <ProductLockup product={product} />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-16 pt-6 text-center sm:px-6 md:pb-24">
        <StillMark product={product} animate={animate} />

        <div role="alert" className="mt-9 max-w-[27rem]">
          <h1
            style={after(250)}
            className={cn(
              'text-balance text-[22px] font-semibold leading-7 tracking-[-0.015em] text-zinc-900 sm:text-2xl sm:leading-8 dark:text-zinc-50',
              rise,
            )}
          >
            {t(copy.titleKey)}
          </h1>
          <p style={after(320)} className={cn('mt-3 text-balance text-[15px] leading-6 text-zinc-600 dark:text-zinc-400', rise)}>
            {t(copy.messageKey)}
          </p>
        </div>

        <div
          style={after(400)}
          className={cn(
            'mt-8 flex w-full max-w-[20rem] flex-col items-stretch gap-2 sm:w-auto sm:max-w-none sm:flex-row sm:items-center sm:justify-center',
            rise,
          )}
        >
          {hasOwnMark ? (
            <>
              <VdButton variant="ink" leadingIcon={retryIcon} className={ACTION} onClick={onRetry}>
                {retryLabel}
              </VdButton>
              <VdButton variant="ghost" className={ACTION} onClick={onSignIn}>
                {signInLabel}
              </VdButton>
            </>
          ) : (
            <>
              <Button variant="primary" icon={retryIcon} className={ACTION} onClick={onRetry}>
                {retryLabel}
              </Button>
              <Button variant="ghost" className={ACTION} onClick={onSignIn}>
                {signInLabel}
              </Button>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default AppFailurePage;

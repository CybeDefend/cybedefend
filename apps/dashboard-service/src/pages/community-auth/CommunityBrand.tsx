import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The brand of the Community sign-in pages: the CybeDefend wordmark and the
 * product name. The CybeDefend name and logo are trademarks (TRADEMARKS.md):
 * the official Community Edition shows them, a fork replaces this component,
 * the only place the sign-in pages name or draw the brand.
 *
 * One accessible name for the logo; its two theme variants (`public/logo.webp`
 * on light, `public/logo-white.webp` on dark) are decorative.
 */
export const CommunityBrand: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center gap-1.5">
      <span role="img" aria-label={t('pages.communityAuth.brand')} className="inline-flex">
        <img src="/logo.webp" alt="" draggable={false} className="h-10 w-auto sm:h-12 dark:hidden" />
        <img src="/logo-white.webp" alt="" draggable={false} className="hidden h-10 w-auto sm:h-12 dark:block" />
      </span>
      <span
        aria-hidden="true"
        className="rounded-md bg-secondary/10 px-2 py-0.5 text-xs font-semibold sm:text-sm uppercase tracking-wider text-secondary dark:bg-secondary/20 dark:text-secondary-light"
      >
        {t('pages.communityAuth.product')}
      </span>
    </div>
  );
};

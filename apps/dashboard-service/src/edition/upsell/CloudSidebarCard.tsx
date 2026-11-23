import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import IconButton from '@/components/atoms/icon-button/IconButton';
import { X } from '@/components/atoms/icon/icons';
import { AS_FOCUS_RAIL } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { dismissCloudCard, useCloudCardDismissed } from './cloudCardDismissal';
import { upsellLink } from './upsellLink';

/** The slot id of this card, which tags its links (`utm_campaign`). */
export const CLOUD_CARD_SLOT_ID = 'upsell-cloud-card';

const LINK = cn(
  'group flex items-center gap-1 rounded-sm text-[12px] font-medium leading-5 text-zinc-200 transition-colors duration-[120ms] hover:text-white',
  AS_FOCUS_RAIL,
);

/** A cloud in the accent token, drawn in place: no asset to ship. */
const CloudGlyph: React.FC = () => (
  <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-secondary/15">
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 stroke-secondary">
      <path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18Z" />
    </svg>
  </span>
);

/**
 * The Community Edition's « CybeDefend Cloud » card in the rail (in the
 * style of Logto's card): what the cloud adds, in one sentence, and two links to the site.
 * Closed, it stays closed in this browser (`cloudCardDismissal`); the editions page, which
 * links to the site, stays reached from the Get started page. It is a `data-rail-section`: on a short window
 * the rail leaves it out before anything else (`useRailFit`), and it never floats over the rail.
 */
const CloudSidebarCard: React.FC = () => {
  const { t } = useTranslation();
  const dismissed = useCloudCardDismissed();
  const titleId = useId();
  if (dismissed) return null;

  const newTab = <span className="sr-only"> {t('components.upsell.opensInNewTab')}</span>;
  return (
    <section
      data-rail-section="cloud"
      data-upsell={CLOUD_CARD_SLOT_ID}
      aria-labelledby={titleId}
      className="relative mt-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 pb-2 pt-2.5"
    >
      <IconButton
        icon={X}
        label={t('components.upsell.cloudCard.dismiss')}
        onClick={dismissCloudCard}
        className="absolute right-1 top-1 size-6 hover:bg-white/[0.06]"
        hoverBgClass="bg-white/[0.06]"
      />
      <div className="flex items-center gap-2 pr-5">
        <CloudGlyph />
        <h3 id={titleId} className="text-[12px] font-medium leading-4 text-zinc-100">
          {t('components.upsell.cloudCard.title')}
        </h3>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">{t('components.upsell.cloudCard.sentence')}</p>
      <div className="mt-1.5 flex flex-col">
        <a href={upsellLink(CLOUD_CARD_SLOT_ID, '/pricing')} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t('components.upsell.cloudCard.tryCloud')}
          <span aria-hidden="true" className="text-zinc-400 group-hover:text-zinc-200">↗</span>
          {newTab}
        </a>
        <a href={upsellLink(CLOUD_CARD_SLOT_ID, '/contact')} target="_blank" rel="noopener noreferrer" className={LINK}>
          {t('components.upsell.cloudCard.enterprise')}
          <span aria-hidden="true" className="text-zinc-400 group-hover:text-zinc-200">↗</span>
          {newTab}
        </a>
      </div>
    </section>
  );
};

export default CloudSidebarCard;

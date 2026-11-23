import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlotContext } from '@/edition/slots';
import { upsellLink } from './upsellLink';

/** The slot id of this panel, which tags its link (`utm_campaign`). */
export const AI_ANALYSIS_UPSELL_SLOT_ID = 'upsell-ai-analysis';

/**
 * The `finding.panels` hosts this panel shows in, one per issue page: the
 * analysis host of the SAST, IaC, secret and CI/CD page, and the overview host
 * of the SCA and container pages.
 */
const SHOWN_AT: Readonly<Record<string, string>> = {
  // That host is unwrapped: the panel takes the page's side padding.
  'issue-analysis': 'mx-4 mb-6 sm:mx-6',
  'issue-overview': 'mb-6',
};

/**
 * The Community Edition's line on a finding: what CybeDefend Cloud
 * and Enterprise add, Cybe Analysis (fewer false positives) and 5,000+ managed
 * rules (clear names and descriptions, deduplication, automatic resolution).
 * One sentence, muted, never in the accent: it informs,
 * it does not compete with the finding.
 *
 * It draws no tab. Its registration makes the page's `finding.panels` non
 * empty, so the page no longer sends a deep link to a tab nobody draws back to
 * the details by itself: at the tab panel host, the panel withdraws that tab
 * (`tabs.hide`), which does.
 */
const AiAnalysisUpsellPanel: React.FC<{ ctx: SlotContext }> = ({ ctx }) => {
  const { t } = useTranslation();
  const withdrawnTab = ctx.host === 'issue-tab-panel' ? ctx.tabs?.active : undefined;
  const hideTab = ctx.tabs?.hide;
  useEffect(() => {
    if (withdrawnTab) hideTab?.(withdrawnTab);
  }, [withdrawnTab, hideTab]);

  const placement = ctx.host ? SHOWN_AT[ctx.host] : undefined;
  if (placement === undefined) return null;
  return (
    <aside
      data-upsell={AI_ANALYSIS_UPSELL_SLOT_ID}
      className={`${placement} flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-zinc-200 px-4 py-3 text-sm text-zinc-500 dark:border-as-line dark:text-zinc-450`}
    >
      <p>{t('components.upsell.aiAnalysis.sentence')}</p>
      <a
        href={upsellLink(AI_ANALYSIS_UPSELL_SLOT_ID, '/pricing')}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        {t('components.upsell.aiAnalysis.link')}
        <span className="sr-only"> {t('components.upsell.opensInNewTab')}</span>
      </a>
    </aside>
  );
};

export default AiAnalysisUpsellPanel;

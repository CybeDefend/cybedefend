import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@/components/atoms/icon/icons';

import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
interface StoredReportTypeLinkProps {
  /** Report kind from StoredReportItem.kind (owasp | cwe | eu_ai_act | …). */
  kind: string;
  /** How many stored reports of this kind the project has. */
  count: number;
  /** Opens the shared stored-reports drawer (the "view all" target). */
  onOpen: () => void;
}

/**
 * Maps a generated-report `kind` to its localized type label key. Aggregated
 * report types use different slugs, but per-project cards only ever surface
 * these three (the EU AI Act card stores its kind as `eu_ai_act`).
 */
const KIND_TO_TYPE_KEY: Record<string, string> = {
  owasp: 'pages.reportsPage.reportTypes.owasp',
  cwe: 'pages.reportsPage.reportTypes.cwe',
  eu_ai_act: 'pages.reportsPage.reportTypes.aiAct',
};

/**
 * Lightweight, per-card "View N stored <type> reports →"
 * link. Rendered under each generator card (OWASP / CWE / EU AI Act) on the
 * project reports page; clicking opens the shared stored-reports drawer. Hidden
 * entirely when the project has no stored report of that kind, so cards stay
 * uncluttered until there is history to show.
 */
const StoredReportTypeLink: React.FC<StoredReportTypeLinkProps> = ({
  kind,
  count,
  onOpen,
}) => {
  const { t } = useTranslation();
  if (!count || count <= 0) return null;

  const typeKey = KIND_TO_TYPE_KEY[kind];
  const typeLabel = typeKey ? t(typeKey) : kind.toUpperCase();

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`stored-reports-link-${kind}`}
      className={`relative mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-secondary dark:text-secondary-light hover:underline ${AS_FOCUS} ${AS_TOUCH}`}
    >
      {t('pages.reportsPage.storedReports.viewTypeReports', {
        count,
        type: typeLabel,
      })}
      <ArrowRight size={14} />
    </button>
  );
};

export default StoredReportTypeLink;

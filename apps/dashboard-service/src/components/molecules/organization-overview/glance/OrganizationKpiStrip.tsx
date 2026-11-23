import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { AlertTriangle, CheckCircle2, PlusCircle, ShieldAlert, type IconProps } from '@/components/atoms/icon/icons';
import { AS_KPI_LABEL, AS_KPI_NOTE, AS_KPI_VALUE, AS_PANEL, AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import type { GetOrganizationOverviewResponse } from '@/server/interfaces/Vulnerability';
import { deltaTone, useFigures } from '@/components/molecules/project-overview/posture/postureTokens';

interface OrganizationKpiStripProps {
  data: GetOrganizationOverviewResponse;
}

interface Tile {
  id: string;
  label: string;
  value: number;
  /** The KPI's own colour, carried by its label (no dot). */
  tone: string;
  /** A quiet glyph in the corner: it names the kind of figure, it carries no colour. */
  glyph: React.ComponentType<IconProps>;
  note?: React.ReactNode;
}

/**
 * The four figures of the organisation, figure first, with a touch of
 * meaning: each label is written in the figure's own
 * colour (open findings in zinc, as the trend draws them in ink; resolved in
 * green; new in amber, as what waits for triage; projects at risk in the
 * critical colour; no dot), the move over seven days is red
 * when it is bad news and green when it is good, the figures in mono and the
 * words in the UI font, and the glyph stays quiet. No sparkline: this view
 * holds no series (the trend is loaded by the Trends tab only). Every
 * figure is a scalar the overview payload already carries.
 */
const OrganizationKpiStrip: React.FC<OrganizationKpiStripProps> = ({ data }) => {
  const { t } = useTranslation();
  const { n, signed } = useFigures();

  const open = (data.criticalIssues ?? 0) + (data.highIssues ?? 0) + (data.mediumIssues ?? 0) + (data.lowIssues ?? 0);
  const newLast7 = data.newIssuesLast7Days ?? 0;
  const solvedLast7 = data.solvedIssuesLast7Days ?? 0;
  const net7 = newLast7 - solvedLast7;
  const atRisk = (data.criticalRiskProjects ?? 0) + (data.highRiskProjects ?? 0);
  const totalProjects = data.totalProjects ?? 0;

  const tiles: Tile[] = [
    {
      id: 'open',
      label: t('pages.organizationOverview.glance.kpi.open'),
      value: open,
      tone: AS_WORD_TONE.neutral,
      glyph: ShieldAlert,
      note: (
        <>
          {/* More open findings than a week ago is bad news. */}
          <span className={cn('font-mono tabular-nums', deltaTone(net7, true))}>{signed(net7)}</span> {t('pages.organizationOverview.glance.kpi.net7')}
        </>
      ),
    },
    {
      id: 'resolved',
      label: t('pages.organizationOverview.glance.kpi.resolved'),
      value: data.solvedIssues ?? 0,
      tone: AS_WORD_TONE.good,
      glyph: CheckCircle2,
      note: (
        <>
          <span className={cn('font-mono tabular-nums', deltaTone(solvedLast7, false))}>{signed(solvedLast7)}</span> {t('pages.organizationOverview.glance.kpi.in7')}
        </>
      ),
    },
    {
      id: 'new',
      label: t('pages.organizationOverview.glance.kpi.new'),
      value: newLast7,
      tone: AS_WORD_TONE.warning,
      glyph: PlusCircle,
      note: t('pages.organizationOverview.glance.kpi.last7'),
    },
    {
      id: 'risk',
      label: t('pages.organizationOverview.glance.kpi.risk'),
      value: atRisk,
      tone: atRisk > 0 ? AS_WORD_TONE.critical : AS_WORD_TONE.neutral,
      glyph: AlertTriangle,
      note: t('pages.organizationOverview.glance.kpi.ofProjects', { count: totalProjects }),
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="organization-kpis">
      {tiles.map((tile) => {
        const Glyph = tile.glyph;
        return (
          <div key={tile.id} className={cn(AS_PANEL, 'min-w-0 p-4 sm:p-5')} data-testid={`kpi-${tile.id}`}>
            <div className="flex items-start justify-between gap-2">
              <p className={cn(AS_KPI_VALUE, 'font-mono')}>{n(tile.value)}</p>
              <Glyph aria-hidden="true" className="mt-1.5 h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
            </div>
            <p className={cn(AS_KPI_LABEL, 'mt-1 min-w-0 leading-5', tile.tone)}>{tile.label}</p>
            {tile.note && <p className={cn(AS_KPI_NOTE, 'mt-1')}>{tile.note}</p>}
          </div>
        );
      })}
    </div>
  );
};

export default OrganizationKpiStrip;

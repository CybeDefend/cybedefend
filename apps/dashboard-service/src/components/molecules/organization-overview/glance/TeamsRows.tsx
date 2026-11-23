import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import SeverityCount from '@/components/atoms/badge/SeverityCount';
import { AS_DIVIDE } from '@/components/atoms/appsec/styles';
import type { TeamSummary } from '@/server/interfaces/Vulnerability';
import PosturePanel from '@/components/molecules/project-overview/posture/PosturePanel';
import { useFigures } from '@/components/molecules/project-overview/posture/postureTokens';

interface TeamsRowsProps {
  teams: TeamSummary[];
  /** How many teams are listed before « and N more ». */
  limit?: number;
  actions?: React.ReactNode;
  testId?: string;
}

/**
 * « Teams »: one compact row per team, the most exposed first: its name and
 * its open findings, its projects and its critical and high counts, and a
 * thin bar of its load. The bar is as long as the team's open findings
 * against the busiest team's, and its first slices are the critical and high
 * ones in the risk colours, so the worst of each team shows at a glance. The
 * tile cards it replaces gave each team an icon tile and two lines for the
 * same two figures.
 */
const TeamsRows: React.FC<TeamsRowsProps> = ({ teams, limit = 6, actions, testId }) => {
  const { t } = useTranslation();
  const { n } = useFigures();

  const sorted = useMemo(() => [...teams].sort((a, b) => b.totalVulnerabilities - a.totalVulnerabilities), [teams]);
  const shown = sorted.slice(0, limit);
  const more = sorted.length - shown.length;
  const max = shown.reduce((acc, team) => Math.max(acc, team.totalVulnerabilities), 0);

  return (
    <PosturePanel
      title={t('pages.organizationOverview.glance.teams.title')}
      meta={t('pages.organizationOverview.glance.teams.meta', { count: teams.length })}
      actions={actions}
      testId={testId}
    >
      {shown.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
          {t('pages.organizationOverview.glance.teams.empty')}
        </p>
      ) : (
        <ul className={AS_DIVIDE}>
          {shown.map((team) => {
            const total = Math.max(0, team.totalVulnerabilities);
            const critical = Math.min(team.criticalCount, total);
            const high = Math.min(team.highCount, total - critical);
            const share = (part: number) => (total > 0 ? `${(part / total) * 100}%` : '0%');
            return (
              <li key={team.teamId} className="py-3 first:pt-0 last:pb-0" data-testid="team-row">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{team.teamName}</span>
                  <span className="shrink-0 font-mono text-sm tabular-nums text-zinc-900 dark:text-zinc-50">{n(total)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t('pages.organizationOverview.glance.teams.projects', { count: team.projectCount })}
                  </span>
                  <span className="inline-flex items-center gap-3">
                    <SeverityCount severity="critical" count={team.criticalCount} label={t('components.issueBadges.critical')} />
                    <SeverityCount severity="high" count={team.highCount} label={t('components.issueBadges.high')} />
                  </span>
                </div>
                {/* The load: length against the busiest team, critical then high in their colours, the rest in zinc. */}
                <div aria-hidden="true" className="mt-2 h-1.5 w-full rounded-full bg-zinc-100 dark:bg-white/[0.06]">
                  <div
                    className="flex h-full gap-px overflow-hidden rounded-full"
                    style={{ width: max > 0 ? `${(total / max) * 100}%` : '0%' }}
                  >
                    {critical > 0 && <span className="h-full shrink-0 bg-critical-risk" style={{ width: share(critical) }} />}
                    {high > 0 && <span className="h-full shrink-0 bg-high-risk" style={{ width: share(high) }} />}
                    <span className="h-full flex-1 bg-zinc-300 dark:bg-zinc-600" />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {more > 0 && (
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {t('pages.organizationOverview.glance.teams.more', { count: more })}
        </p>
      )}
    </PosturePanel>
  );
};

export default TeamsRows;

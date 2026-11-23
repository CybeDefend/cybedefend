import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Button from '@/components/atoms/button/Button';
import SeverityCount from '@/components/atoms/badge/SeverityCount';
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { ArrowRight } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import { projectPath } from '@/utils/product';
import { AS_COUNT_ZERO_VALUE, AS_DIVIDE, AS_THEAD } from '@/components/atoms/appsec/styles';
import type { GetOrganizationOverviewResponse } from '@/server/interfaces/Vulnerability';
import PosturePanel from '@/components/molecules/project-overview/posture/PosturePanel';
import { deltaTone, useFigures } from '@/components/molecules/project-overview/posture/postureTokens';
import { rankProjectsAtRisk, type ProjectAtRisk, type RiskLevel } from './rankProjectsAtRisk';
import { appsecProjectListPath } from '@/utils/appsecProjectList';

interface ProjectsAtRiskProps {
  data: Pick<GetOrganizationOverviewResponse, 'topVulnerableProjects' | 'projectsSummary'>;
  actions?: React.ReactNode;
  testId?: string;
}


const RISK_WORD: Record<RiskLevel, string> = {
  critical: 'pages.organizationOverview.projects.riskLevels.critical',
  high: 'pages.organizationOverview.projects.riskLevels.high',
  medium: 'pages.organizationOverview.projects.riskLevels.medium',
  low: 'pages.organizationOverview.projects.riskLevels.low',
  none: 'pages.organizationOverview.glance.projectsAtRisk.riskNone',
};

/*
  One row, two layouts. From md up a six-column table: rank, project and team,
  open findings, risk, critical and high, the seven days' move. Below md the
  same row stacks: rank, project, open findings on the first line, the rest
  under the name. The wrapper of the last three cells is `md:contents`, so it
  is a line of its own on a phone and three cells of the grid from md up: one
  DOM, read once by a screen reader, found once by a test.
*/
const GRID = 'grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 md:grid-cols-[1.25rem_minmax(0,1fr)_3.5rem_8rem_7rem_4rem] md:gap-x-4';
const HEAD_CELL = 'text-xs font-medium text-zinc-500 dark:text-zinc-400';

/**
 * « Projects at risk »: the five projects with the most open findings, each
 * with its team, its open count, its risk level as a dot and a word, its
 * critical and high counts as dots, and its seven-day move (red when it grew,
 * mint when it shrank). A row opens the project's AppSec page; « See all »
 * goes to the projects list.
 */
const ProjectsAtRisk: React.FC<ProjectsAtRiskProps> = ({ data, actions, testId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { n, signed } = useFigures();

  const rows = useMemo(() => rankProjectsAtRisk(data), [data]);

  const open = (project: ProjectAtRisk) => {
    navigate(projectPath('appsec', project.projectId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const riskWord = (project: ProjectAtRisk) =>
    project.risk ? t(RISK_WORD[project.risk]) : t('pages.organizationOverview.glance.projectsAtRisk.riskUnknown');

  const seeAll = (
    <Button
      variant="ghost"
      size="xs"
      to={appsecProjectListPath()}
      icon={<ArrowRight className="h-3.5 w-3.5" />}
      iconPosition="right"
      className="h-7 px-2 text-[13px]"
    >
      {t('pages.organizationOverview.glance.projectsAtRisk.seeAll')}
    </Button>
  );

  return (
    <PosturePanel
      title={t('pages.organizationOverview.glance.projectsAtRisk.title')}
      meta={t('pages.organizationOverview.glance.projectsAtRisk.meta')}
      actions={
        <>
          {actions}
          {seeAll}
        </>
      }
      flush
      testId={testId}
    >
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-[13px] text-zinc-500 sm:px-5 dark:text-zinc-400">
          {t('pages.organizationOverview.glance.projectsAtRisk.empty')}
        </p>
      ) : (
        <>
          {/* The column heads, from md up, in the order of the cells. */}
          <div aria-hidden="true" className={cn(GRID, AS_THEAD, 'hidden h-9 border-t border-zinc-100 px-5 md:grid dark:border-as-line')}>
            <span className={HEAD_CELL}>{t('pages.organizationOverview.glance.projectsAtRisk.rank')}</span>
            <span className={HEAD_CELL}>{t('pages.organizationOverview.glance.projectsAtRisk.project')}</span>
            <span className={cn(HEAD_CELL, 'text-right')}>{t('pages.organizationOverview.glance.projectsAtRisk.open')}</span>
            <span className={HEAD_CELL}>{t('pages.organizationOverview.glance.projectsAtRisk.risk')}</span>
            <span className={HEAD_CELL}>{t('pages.organizationOverview.glance.projectsAtRisk.priority')}</span>
            <span className={cn(HEAD_CELL, 'text-right')}>{t('pages.organizationOverview.glance.projectsAtRisk.delta')}</span>
          </div>
          <ul className={cn(AS_DIVIDE, 'border-t border-zinc-100 dark:border-as-line')}>
            {rows.map((project, index) => (
              <li key={project.projectId} data-testid="project-at-risk">
                <Button
                  variant="row"
                  size="xs"
                  onClick={() => open(project)}
                  className={cn(
                    GRID,
                    'w-full px-4 py-3 text-left transition-colors duration-[120ms] hover:bg-zinc-50 sm:px-5 dark:hover:bg-white/[0.03]',
                  )}
                >
                  <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-450">{index + 1}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">{project.name}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{project.team}</span>
                  </span>
                  <span className="text-right font-mono text-sm tabular-nums text-zinc-900 dark:text-zinc-50">{n(project.open)}</span>
                  <span className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:contents">
                    {/* The CybeRisk level in its soft chip; an unknown level is a quiet zinc chip. */}
                    <span className="inline-flex">
                      <SeverityChip level={project.risk ?? 'none'}>{riskWord(project)}</SeverityChip>
                    </span>
                    <span className="inline-flex items-center gap-3">
                      <SeverityCount severity="critical" count={project.critical} label={t('components.issueBadges.critical')} />
                      <SeverityCount severity="high" count={project.high} label={t('components.issueBadges.high')} />
                    </span>
                    <span className="font-mono text-xs tabular-nums md:text-right md:text-[13px]">
                      {project.delta7 === null ? (
                        <span className={cn('font-sans', AS_COUNT_ZERO_VALUE)}>{t('components.projectOverview.posture.unavailable')}</span>
                      ) : (
                        <>
                          {/* More open findings than a week ago is bad news. */}
                          <span className={deltaTone(project.delta7, true)}>{signed(project.delta7)}</span>
                          <span className="ml-1 font-sans text-zinc-500 md:hidden dark:text-zinc-400">
                            {t('pages.organizationOverview.glance.projectsAtRisk.delta')}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </PosturePanel>
  );
};

export default ProjectsAtRisk;

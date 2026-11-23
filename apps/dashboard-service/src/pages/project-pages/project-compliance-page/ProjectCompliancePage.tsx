// ============================================================================
// ProjectCompliancePage - Compliance overview for a project
// ============================================================================

import React, { useState, useEffect } from 'react';
import { projectSectionIcon } from '@/components/atoms/icon/projectSectionIcons';
import { useParams, useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';

import { RootState } from '@/server/store';
import { useCompliance } from '@/server/hooks/useCompliance';
import { useViolations } from '@/server/hooks/useViolations';
import { fetchProject } from '@/server/services/projectService';
import { Project } from '@/server/interfaces/Project';
import { cn } from '@/utils/function/utils';
import { productHome } from '@/utils/product';

import ProjectTemplateWrapper from '@/components/molecules/wrapper/ProjectTemplateWrapper';
import Card from '@/components/atoms/card';
import Button from '@/components/atoms/button/Button';
import { FeatureGate } from '@/components/molecules/feature-gate';
import useDisabledFeatures from '@/server/hooks/useDisabledFeatures';

import {
  ComplianceOverview,
  ComplianceHistory,
  EffectivePolicyViewer,
  ViolationList,
} from './components';
import { FileCode, History, ListAlt, ShieldAlt, Sync } from '@/components/atoms/icon/icons';
import { AS_FOCUS_INSET, AS_SECTION_TITLE } from '@/components/atoms/appsec/styles';
import { AS_GLYPH, AS_GLYPH_BOX } from '@/components/atoms/appsec/recipes';
import Badge from '@/components/atoms/badge/Badge';
import { apiErrorKey } from '@/utils/function/apiErrorKey';

type TabType = 'violations' | 'history' | 'effective-policy';

const ProjectCompliancePage: React.FC = () => {
  const { projectId, scanId } = useParams<{ projectId: string; scanId?: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const organizationId = selectedOrganization?.id || '';

  // Feature gating
  const disabledFeatures = useDisabledFeatures();
  const isPoliciesDisabled = disabledFeatures.has('policies');

  // Project State
  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);

  // Tab State
  const [activeTab, setActiveTab] = useState<TabType>('violations');

  // Load project data
  useEffect(() => {
    if (projectId) {
      setProjectLoading(true);
      fetchProject(projectId)
        .then((data: Project) => {
          setProject(data);
        })
        .catch((err: Error) => {
          console.error('Error fetching project:', err);
          toast.error(t('pages.projectCompliance.errorFetchingProject'));
          // An AppSec page: the root would hand the account to the landing rule.
          navigate(productHome('appsec'), { replace: true });
        })
        .finally(() => {
          setProjectLoading(false);
        });
    }
  }, [projectId, navigate, t]);

  // Compliance Hook - disable autoFetch, we'll fetch on tab change
  const {
    effectivePolicy,
    effectivePolicyLoading,
    effectivePolicyError,
    refreshEffectivePolicy,
    fetchEffectivePolicyOnce,
    complianceResult,
    complianceLoading,
    complianceError,
    refreshCompliance,
    complianceHistory,
    historyLoading,
    historyError,
    historyPage,
    setHistoryPage,
    historyPageSize,
    setHistoryPageSize,
    refreshHistory,
    fetchHistoryOnce,
    evaluating,
    evaluationStatus,
    triggerNewEvaluation,
    pollEvaluationStatus,
  } = useCompliance({
    organizationId,
    projectId: projectId || '',
    scanId,
    autoFetch: false, // Disable autoFetch
    autoFetchComplianceResult: !!projectId && !!scanId && !isPoliciesDisabled, // Don't fetch if policies disabled
  });

  // Violations Hook - fetch violations + stats on load (for overview), but history and effective policy on demand
  const {
    violations,
    loading: violationsLoading,
    error: violationsError,
    total: violationsTotal,
    currentPage: violationsPage,
    pageSize: violationsPageSize,
    totalPages: violationsTotalPages,
    setCurrentPage: setViolationsPage,
    refresh: refreshViolations,
    fetchViolationsOnce,
    stats,
    statsLoading,
    fetchStatsOnce,
  } = useViolations({
    organizationId,
    projectId: projectId || '',
    scanId,
    autoFetch: false, // Disable autoFetch
    autoFetchStats: !!projectId && !isPoliciesDisabled, // Don't fetch stats if policies disabled
  });

  // Lazy fetch data based on active tab (skip if policies feature is disabled)
  useEffect(() => {
    if (!projectId || isPoliciesDisabled) return;

    switch (activeTab) {
      case 'violations':
        fetchViolationsOnce();
        fetchStatsOnce();
        break;
      case 'history':
        fetchHistoryOnce();
        break;
      case 'effective-policy':
        fetchEffectivePolicyOnce();
        break;
    }
  }, [activeTab, projectId, fetchViolationsOnce, fetchStatsOnce, fetchHistoryOnce, fetchEffectivePolicyOnce]);

  // Handle triggering a new evaluation
  const handleTriggerEvaluation = async () => {
    try {
      const evaluationId = await triggerNewEvaluation('sast'); // Default to SAST, could be made configurable
      pollEvaluationStatus(evaluationId);
      toast.success(t('pages.projectCompliance.evaluationStarted'));
    } catch (err: any) {
      toast.error(t(apiErrorKey(err, { fallback: 'pages.projectCompliance.evaluationFailed' })));
    }
  };

  const tabs = [
    { id: 'violations' as TabType, label: t('pages.policies.violations.title'), icon: ListAlt },
    { id: 'history' as TabType, label: t('pages.policies.compliance.history'), icon: History },
    { id: 'effective-policy' as TabType, label: t('pages.policies.compliance.effectivePolicy'), icon: FileCode },
  ];

  if (projectLoading) {
    return (
      <ProjectTemplateWrapper
        projectId={projectId}
        projectTitle={t('common.loading')}
        selectedTab="compliance"
      >
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-secondary border-r-transparent" />
        </div>
      </ProjectTemplateWrapper>
    );
  }

  return (
    <ProjectTemplateWrapper
      projectId={projectId}
      projectTitle={project?.name || t('pages.projectCompliance.title')}
      selectedTab="compliance"
    >
      <FeatureGate feature="policies" preview featureLabel={t('pages.projectCompliance.title')} requiredPlan="team_v3">
      {/* Page Title & Action */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          {/* The title glyph keeps its box and loses its tile. */}
          <div className={AS_GLYPH_BOX}>
            {React.createElement(projectSectionIcon('compliance'), { className: AS_GLYPH })}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className={AS_SECTION_TITLE}>
                {t('pages.projectCompliance.title')}
              </h2>
              {/* Compliance Status Badge */}
              {stats?.complianceStatus && (
                // The status as dot + word: the colour on the dot, the word in ink.
                <Badge
                  variant={
                    stats.complianceStatus === 'Compliant'
                      ? 'success'
                      : stats.complianceStatus === 'Pending'
                      ? 'warning'
                      : 'error'
                  }
                  size="sm"
                  appearance="dot"
                >
                  {stats.complianceStatus === 'Compliant'
                    ? t('pages.policies.compliance.compliant')
                    : stats.complianceStatus === 'Pending'
                    ? t('pages.policies.compliance.pending')
                    : t('pages.policies.compliance.nonCompliant')}
                </Badge>
              )}
            </div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t('pages.projectCompliance.description', {
                projectName: project?.name || '',
              })}
            </p>
          </div>
        </div>
        {scanId && (
          <motion.div>
            <Button
              variant="secondary"
              icon={<Sync className={cn('h-4 w-4', evaluating && 'animate-spin')}  />}
              onClick={handleTriggerEvaluation}
              disabled={evaluating}
            >
              {evaluating
                ? t('pages.projectCompliance.evaluating')
                : t('pages.projectCompliance.triggerEvaluation')}
            </Button>
          </motion.div>
        )}
      </div>

      {/* Evaluation Progress */}
      {evaluating && evaluationStatus && (
        <Card variant="default" padding="md" className="mb-6">
          <div className="flex items-center gap-4">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-secondary border-r-transparent" />
            <div className="flex-1">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('pages.projectCompliance.evaluationInProgress')}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {evaluationStatus.message}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium tabular-nums text-secondary dark:text-secondary-light">
                {Math.round(evaluationStatus.progress)}%
              </p>
            </div>
          </div>
          <div className="mt-3 h-1.5 bg-zinc-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-secondary transition-all duration-300"
              style={{ width: `${evaluationStatus.progress}%` }}
            />
          </div>
        </Card>
      )}

      {/* Compliance Overview Stats */}
      <ComplianceOverview
        complianceResult={complianceResult}
        stats={stats}
        loading={complianceLoading || statsLoading}
        error={complianceError}
      />

      {/* Tabs */}
      <div className="mb-6 border-b border-zinc-200 dark:border-as-line">
        <div className="flex gap-5 overflow-x-auto overflow-y-hidden scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'relative flex shrink-0 h-11 md:h-10 items-center gap-1.5 whitespace-nowrap px-0.5 text-[13px] font-medium transition-colors duration-[120ms] border-b-2',
                AS_FOCUS_INSET,
                activeTab === tab.id
                  ? 'border-secondary text-zinc-900 dark:text-zinc-50'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:border-zinc-300 dark:hover:border-white/[0.2]'
              )}
            >
              <tab.icon className="h-4 w-4"  />
              {tab.label}
              {tab.id === 'violations' && violationsTotal > 0 && (
                // A mono zinc figure, no chip.
                <span
                  className={cn(
                    'ml-1 font-mono text-xs tabular-nums',
                    activeTab === tab.id ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-500 dark:text-zinc-450'
                  )}
                >
                  {violationsTotal}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'violations' && (
        <ViolationList
          violations={violations}
          loading={violationsLoading}
          error={violationsError}
          currentPage={violationsPage}
          totalPages={violationsTotalPages}
          totalItems={violationsTotal}
          pageSize={violationsPageSize}
          onPageChange={setViolationsPage}
          onPageSizeChange={() => {}} // Page size is fixed from hook
          onRefresh={refreshViolations}
        />
      )}

      {activeTab === 'history' && (
        <ComplianceHistory
          history={complianceHistory}
          loading={historyLoading}
          error={historyError}
          currentPage={historyPage}
          pageSize={historyPageSize}
          onPageChange={setHistoryPage}
          onPageSizeChange={setHistoryPageSize}
          onRefresh={refreshHistory}
        />
      )}

      {activeTab === 'effective-policy' && (
        <EffectivePolicyViewer
          effectivePolicy={effectivePolicy}
          loading={effectivePolicyLoading}
          error={effectivePolicyError}
          onRefresh={refreshEffectivePolicy}
        />
      )}
      </FeatureGate>
    </ProjectTemplateWrapper>
  );
};

export default ProjectCompliancePage;

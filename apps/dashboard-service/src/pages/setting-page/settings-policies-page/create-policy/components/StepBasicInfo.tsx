// ============================================================================
// StepBasicInfo - Step 1: Basic policy information
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { PolicyScope } from '@/server/interfaces/Policy';
import { cn } from '@/utils/function/utils';
import Input from '@/components/atoms/input/Input';
import Toggle from '@/components/atoms/toggle/Toggle';
import Button from '@/components/atoms/button/Button';
import { PolicyFormData } from '../CreatePolicyPage';
import useOrganizationTeams from '@/server/hooks/useOrganizationTeams';
import useOrganizationProjects from '@/server/hooks/useOrganizationProjects';
import TargetSelectionModal from './TargetSelectionModal';
import { Building, FolderOpen, InfoCircle, Plus, Times, Users } from '@/components/atoms/icon/icons';

import { AS_FOCUS, AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { AS_GLYPH, AS_GLYPH_BOX, AS_NOTICE_BLOCK, AS_NOTICE_FRAME, AS_NOTICE_TITLE } from '@/components/atoms/appsec/recipes';
interface StepBasicInfoProps {
  formData: PolicyFormData;
  onChange: (data: PolicyFormData) => void;
  errors: string[];
  organizationId: string;
  selectedNamesCache: Map<string, string>;
  onUpdateNamesCache: (updater: (prev: Map<string, string>) => Map<string, string>) => void;
  isEditMode?: boolean;
  originalScope?: PolicyScope;
}

const StepBasicInfo: React.FC<StepBasicInfoProps> = ({
  formData,
  onChange,
  errors,
  organizationId,
  selectedNamesCache,
  onUpdateNamesCache,
  isEditMode = false,
  originalScope,
}) => {
  const { t } = useTranslation();

  // Modal states
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  
  // Track if data should be fetched (only when modal has been opened)
  const [shouldFetchTeams, setShouldFetchTeams] = useState(false);
  const [shouldFetchProjects, setShouldFetchProjects] = useState(false);

  // Fetch teams and projects for scope selection - only when needed
  const { teams, loading: teamsLoading, refresh: refreshTeams } = useOrganizationTeams(organizationId, shouldFetchTeams);
  const { 
    projects, 
    loading: projectsLoading,
    currentPage: projectCurrentPage,
    totalPages: projectTotalPages,
    goToPage: setProjectCurrentPage,
  } = useOrganizationProjects(organizationId, 10, projectSearchQuery, shouldFetchProjects);

  // Auto-fetch teams/projects if in edit mode and there are pre-selected targetIds
  useEffect(() => {
    if (isEditMode && formData.targetIds && formData.targetIds.length > 0) {
      if (formData.scope === PolicyScope.TEAM && !shouldFetchTeams) {
        setShouldFetchTeams(true);
      } else if (formData.scope === PolicyScope.PROJECT && !shouldFetchProjects) {
        setShouldFetchProjects(true);
      }
    }
  }, [isEditMode, formData.scope, formData.targetIds, shouldFetchTeams, shouldFetchProjects]);

  // Update parent cache when teams are loaded
  useEffect(() => {
    if (teams.length > 0) {
      onUpdateNamesCache((prev) => {
        const newCache = new Map(prev);
        teams.forEach((t) => {
          newCache.set(t.id, t.name);
        });
        return newCache;
      });
    }
  }, [teams, onUpdateNamesCache]);

  // Update parent cache when projects are loaded
  useEffect(() => {
    if (projects.length > 0) {
      onUpdateNamesCache((prev) => {
        const newCache = new Map(prev);
        projects.forEach((p) => {
          newCache.set(p.projectId, p.name);
        });
        return newCache;
      });
    }
  }, [projects, onUpdateNamesCache]);

  // Get team name from cache or teams list
  const getTeamName = useCallback((teamId: string): string => {
    // First check current teams list
    const team = teams.find((t) => t.id === teamId);
    if (team) return team.name;
    // Then check parent cache
    return selectedNamesCache.get(teamId) || teamId;
  }, [teams, selectedNamesCache]);

  // Get project name from cache or projects list
  const getProjectName = useCallback((projectId: string): string => {
    // First check current projects list
    const project = projects.find((p) => p.projectId === projectId);
    if (project) return project.name;
    // Then check parent cache
    return selectedNamesCache.get(projectId) || projectId;
  }, [projects, selectedNamesCache]);

  const scopeOptions = [
    {
      value: PolicyScope.ORGANIZATION,
      label: t('pages.policies.scope.organization'),
    },
    {
      value: PolicyScope.TEAM,
      label: t('pages.policies.scope.team'),
    },
    {
      value: PolicyScope.PROJECT,
      label: t('pages.policies.scope.project'),
    },
  ];

  const handleScopeChange = (newScope: string) => {
    onChange({
      ...formData,
      scope: newScope as PolicyScope,
      targetId: newScope === PolicyScope.ORGANIZATION ? organizationId : '',
      targetIds: [], // Reset selection when scope changes
    });
  };

  // Toggle team/project selection
  const handleToggleTarget = (id: string) => {
    const currentIds = formData.targetIds || [];
    const newIds = currentIds.includes(id)
      ? currentIds.filter((tid) => tid !== id)
      : [...currentIds, id];
    onChange({ ...formData, targetIds: newIds });
  };

  const scopeDescriptions: Record<PolicyScope, { icon: typeof Building; description: string }> = {
    [PolicyScope.ORGANIZATION]: {
      icon: Building,
      description: t('pages.policies.scopeDescriptions.organization'),
    },
    [PolicyScope.TEAM]: {
      icon: Users,
      description: t('pages.policies.scopeDescriptions.team'),
    },
    [PolicyScope.PROJECT]: {
      icon: FolderOpen,
      description: t('pages.policies.scopeDescriptions.project'),
    },
  };

  return (
    <div className="space-y-6">
      {/* Step Header */}
      <div>
        <h2 className="text-lg font-semibold tracking-[-0.01em] text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
          <InfoCircle className="h-4 w-4 text-secondary dark:text-secondary-light"  />
          {t('pages.policies.steps.basicInfo')}
        </h2>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">
          {t('pages.policies.steps.basicInfoDescription')}
        </p>
      </div>

      {/* Info Card about Policies */}
      <div className={AS_NOTICE_FRAME}>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <h4 className={AS_NOTICE_TITLE}>
              {t('pages.policies.info.whatIsPolicy')}
            </h4>
            <p>
              {t('pages.policies.info.policyExplanation')}
            </p>
          </div>
        </div>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((error, i) => (
            <div key={i} className={AS_NOTICE_BLOCK}>
              <span className={AS_WORD_TONE.bad}>{error}</span>
            </div>
          ))}
        </div>
      )}

      {/* Form Fields */}
      <div className="space-y-6">
        {/* Policy Name */}
        <Input
          label={t('pages.policies.policyName')}
          placeholder={t('pages.policies.policyNamePlaceholder')}
          value={formData.name}
          onChange={(e) => onChange({ ...formData, name: e.target.value })}
          required
        />

        {/* Description */}
        <Input
          label={t('pages.policies.policyDescription')}
          placeholder={t('pages.policies.policyDescriptionPlaceholder')}
          value={formData.description}
          onChange={(e) => onChange({ ...formData, description: e.target.value })}
          textarea
        />

        {/* Scope Selection */}
        <div className="space-y-3">
          <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
            {t('pages.policies.scope.label')} <span className="text-red-600 dark:text-red-400">*</span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(scopeDescriptions).map(([scope, config]) => (
              <button
                key={scope}
                type="button"
                onClick={() => handleScopeChange(scope)}
                // The violet hairline is the only selection cue: no tint, no icon tile, the title in ink.
                aria-pressed={formData.scope === scope}
                className={cn(
                  'p-3 rounded-xl border text-left transition-colors duration-[120ms]', AS_FOCUS,
                  formData.scope === scope
                    ? 'border-secondary dark:border-secondary-light/60'
                    : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.14]'
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={AS_GLYPH_BOX}>
                    <config.icon className={AS_GLYPH} />
                  </div>
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {scopeOptions.find((o) => o.value === scope)?.label}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {config.description}
                </p>
              </button>
            ))}
          </div>

          {/* Team/Project Selector */}
          {formData.scope === PolicyScope.TEAM && (
            <div className="mt-4">
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t('pages.policies.selectTeams')} <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              
              {/* Button to open modal */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShouldFetchTeams(true);
                  setIsTeamModalOpen(true);
                }}
                className="mb-3"
              >
                <Plus className="h-4 w-4 mr-2"  />
                {t('pages.policies.addTeams')}
                {(formData.targetIds?.length || 0) > 0 && (
                  <span className="ml-1.5 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formData.targetIds?.length}
                  </span>
                )}
              </Button>

              {/* Selected teams display */}
              {(formData.targetIds?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.targetIds?.map((teamId) => {
                    const teamName = getTeamName(teamId);
                    return (
                      <span
                        key={teamId}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-as-line px-2 text-[13px] text-zinc-700 dark:text-zinc-200"
                      >
                        <Users className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
                        {teamName}
                        <button
                          type="button"
                          onClick={() => handleToggleTarget(teamId)}
                          className="relative ml-0.5 rounded-sm transition-colors duration-[120ms] hover:text-red-500 max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']"
                        >
                          <Times className="h-4 w-4"  />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Team Selection Modal */}
              <TargetSelectionModal
                isOpen={isTeamModalOpen}
                onClose={() => setIsTeamModalOpen(false)}
                title={t('pages.policies.selectTeams')}
                items={teams.map((t) => ({ id: t.id, name: t.name, description: t.description }))}
                selectedIds={formData.targetIds || []}
                onConfirm={(ids) => onChange({ ...formData, targetIds: ids })}
                loading={teamsLoading}
                searchPlaceholder={t('pages.policies.searchTeams')}
              />
            </div>
          )}

          {formData.scope === PolicyScope.PROJECT && (
            <div className="mt-4">
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t('pages.policies.selectProjects')} <span className="text-red-600 dark:text-red-400">*</span>
              </label>

              {/* Button to open modal */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShouldFetchProjects(true);
                  setIsProjectModalOpen(true);
                }}
                className="mb-3"
              >
                <Plus className="h-4 w-4 mr-2"  />
                {t('pages.policies.addProjects')}
                {(formData.targetIds?.length || 0) > 0 && (
                  <span className="ml-1.5 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formData.targetIds?.length}
                  </span>
                )}
              </Button>

              {/* Selected projects display */}
              {(formData.targetIds?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {formData.targetIds?.map((projectId) => {
                    return (
                      <span
                        key={projectId}
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-as-line px-2 text-[13px] text-zinc-700 dark:text-zinc-200"
                      >
                        <FolderOpen className="h-4 w-4 text-zinc-500 dark:text-zinc-400"  />
                        {getProjectName(projectId)}
                        <button
                          type="button"
                          onClick={() => handleToggleTarget(projectId)}
                          className="relative ml-0.5 rounded-sm transition-colors duration-[120ms] hover:text-red-500 max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-11 max-md:after:w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']"
                        >
                          <Times className="h-4 w-4"  />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Project Selection Modal */}
              <TargetSelectionModal
                isOpen={isProjectModalOpen}
                onClose={() => setIsProjectModalOpen(false)}
                title={t('pages.policies.selectProjects')}
                items={projects.map((p) => ({ id: p.projectId, name: p.name }))}
                selectedIds={formData.targetIds || []}
                onConfirm={(ids, cache) => {
                  // Update parent cache with names from the modal
                  onUpdateNamesCache((prev) => {
                    const newCache = new Map(prev);
                    cache.forEach((name, id) => newCache.set(id, name));
                    return newCache;
                  });
                  onChange({ ...formData, targetIds: ids });
                }}
                loading={projectsLoading}
                searchPlaceholder={t('pages.policies.searchProjects')}
                searchQuery={projectSearchQuery}
                onSearchChange={setProjectSearchQuery}
                currentPage={projectCurrentPage}
                totalPages={projectTotalPages}
                onPageChange={setProjectCurrentPage}
              />
            </div>
          )}
        </div>

        {/* Priority and Enabled */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
              {t('pages.policies.priority')}
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400 ml-1.5">(1-100)</span>
            </label>
            <Input
              type="number"
              value={formData.priority.toString()}
              onChange={(e) =>
                onChange({
                  ...formData,
                  priority: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)),
                })
              }
              min={1}
              max={100}
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t('pages.policies.priorityHint')}
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
              {t('pages.policies.statusLabel')}
            </label>
            <div
              className={cn(
                'flex items-center justify-between px-3 py-2.5 rounded-xl border',
                'border-zinc-200 dark:border-as-line bg-zinc-50 dark:bg-white/[0.03]'
              )}
            >
              <div>
                <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {formData.isEnabled
                    ? t('pages.policies.enabled')
                    : t('pages.policies.disabled')}
                </span>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formData.isEnabled
                    ? t('pages.policies.enabledHint')
                    : t('pages.policies.disabledHint')}
                </p>
              </div>
              <Toggle enabled={formData.isEnabled} onChange={(v) => onChange({ ...formData, isEnabled: v })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StepBasicInfo;

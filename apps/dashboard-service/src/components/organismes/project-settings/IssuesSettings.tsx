

import React from "react";
import Card from "../../atoms/card/Card";
import Toggle from "../../atoms/toggle/Toggle";
import Select, { Option } from "../../atoms/select/Select";
import { useTranslation } from "react-i18next";
import { JiraProject, JiraProjectConfig } from "@/server/services/integrations/jiraIntegrationsService";
import type {
    LinearProjectConfig,
    LinearTeam,
    LinearTeamOptions,
} from "@/server/services/integrations/linearIntegrationsService";
import { Github} from '@/components/atoms/icon/icons';
// GitLab is a trademark, so it keeps its official mark rather than a redrawn one.
import { SiGitlab as Gitlab } from 'react-icons/si';

import { AS_PANEL_TITLE, AS_CHIP, AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { AS_GLYPH, AS_GLYPH_BOX, AS_NOTICE, AS_NOTICE_BLOCK, AS_NOTICE_DOT, AS_NOTICE_DOT_BLOCK, AS_NOTICE_TITLE, AS_TAG, NOTICE_DOT } from '@/components/atoms/appsec/recipes';
import { cn } from '@/utils/function/utils';
import { jiraProjectLabel } from "./jiraProjectLabel";
interface IssuesSettingsProps {
    isProjectLinkedToGithub: boolean;
    isProjectLinkedToGitlab: boolean;
    githubIssueEnabled: boolean;
    onGithubIssueToggle: () => void;
    gitlabIssueEnabled: boolean;
    onGitlabIssueToggle: () => void;
    isJiraConnected: boolean;
    jiraProjects: JiraProject[];
    jiraConfig: JiraProjectConfig | null;
    onJiraProjectChange: (project: JiraProject | null) => void;
    onJiraAllowedBranchesChange: (branches: string[]) => void;
    onJiraAutoCreateToggle: () => void;
    isLinearConnected: boolean;
    /** The workspace's teams. */
    linearTeams: LinearTeam[];
    /** The projects, labels and members of the configured team; null until read (or with no team). */
    linearTeamOptions: LinearTeamOptions | null;
    /** The project's saved Linear config; null when it has none. */
    linearConfig: LinearProjectConfig | null;
    /**
     * True while the project's saved config has not been read: a team chosen now
     * would be saved over the stored branches and auto-create. Absent = false.
     */
    isLinearConfigLoading?: boolean;
    /** A team id, or null to stop creating Linear tickets for the project. */
    onLinearTeamChange: (teamId: string | null) => void;
    /** A Linear project id, or null for none. */
    onLinearProjectChange: (id: string | null) => void;
    onLinearLabelsChange: (ids: string[]) => void;
    onLinearAllowedBranchesChange: (branches: string[]) => void;
    onLinearAutoCreateToggle: () => void;
    issueCreationMode: string;
    onIssueCreationModeChange: (value: string) => void;
    issueCreationBranches: string[];
    onIssueCreationBranchesChange: (branches: string[]) => void;
    /**
     * Current page of branch OPTIONS (sourced from the unified paginated
     * branch list). This is NOT the selection — selected branches live in
     * `issueCreationBranches` / `jiraConfig.allowedBranches`. Selected branches
     * that are off the current page are merged back into the rendered options
     * so they always appear as checked chips and stay deselectable.
     */
    branches: Array<{ name: string; isDefault?: boolean; isProtected?: boolean }>;
    // ── Backend-search / pagination (all opt-in; absent = legacy full-list) ──
    /** Enable backend-driven search + infinite scroll for the branch selects. */
    branchesAsync?: boolean;
    /** Lift the branch search term up (debounced upstream). */
    onBranchSearchChange?: (value: string) => void;
    /** Load the next page of branches. */
    onBranchLoadMore?: () => void;
    /** Whether more branch pages are available. */
    branchesHasMore?: boolean;
    /** True while a new branch search query is in-flight. */
    branchesSearching?: boolean;
    /** True while the next branch page is loading. */
    branchesLoadingMore?: boolean;
}

const IssuesSettings: React.FC<IssuesSettingsProps> = ({
    isProjectLinkedToGithub,
    isProjectLinkedToGitlab,
    githubIssueEnabled,
    onGithubIssueToggle,
    gitlabIssueEnabled,
    onGitlabIssueToggle,
    isJiraConnected,
    jiraProjects,
    jiraConfig,
    onJiraProjectChange,
    onJiraAllowedBranchesChange,
    onJiraAutoCreateToggle,
    isLinearConnected,
    linearTeams,
    linearTeamOptions,
    linearConfig,
    isLinearConfigLoading = false,
    onLinearTeamChange,
    onLinearProjectChange,
    onLinearLabelsChange,
    onLinearAllowedBranchesChange,
    onLinearAutoCreateToggle,
    issueCreationMode,
    onIssueCreationModeChange,
    issueCreationBranches,
    onIssueCreationBranchesChange,
    branches,
    branchesAsync = false,
    onBranchSearchChange,
    onBranchLoadMore,
    branchesHasMore = false,
    branchesSearching = false,
    branchesLoadingMore = false,
}) => {
    const { t } = useTranslation();

    const showGitSettings = githubIssueEnabled || gitlabIssueEnabled;

    const defaultBranchNames = React.useMemo(
        () => new Set(branches.filter((b) => b.isDefault).map((b) => b.name)),
        [branches],
    );

    /**
     * Build the option list for a multi-select as the UNION of the current
     * branch page and the values already selected for THAT select. Without this
     * merge, a selected branch that isn't on the current backend page would
     * vanish from the dropdown (no checkbox to deselect) and from the trigger
     * chip count — the core multi-select correctness requirement. Page branches
     * keep their natural order; selected-but-off-page values are appended.
     */
    const buildBranchOptions = React.useCallback(
        (selected: string[]): Option[] => {
            const seen = new Set<string>();
            const options: Option[] = [];
            for (const branch of branches) {
                if (seen.has(branch.name)) continue;
                seen.add(branch.name);
                options.push({
                    label: `${branch.name}${branch.isDefault ? ' ★' : ''}`,
                    value: branch.name,
                });
            }
            for (const value of selected) {
                if (seen.has(value)) continue;
                seen.add(value);
                options.push({
                    label: `${value}${defaultBranchNames.has(value) ? ' ★' : ''}`,
                    value,
                });
            }
            return options;
        },
        [branches, defaultBranchNames],
    );

    const jiraBranchOptions: Option[] = React.useMemo(
        () => buildBranchOptions(jiraConfig?.allowedBranches || []),
        [buildBranchOptions, jiraConfig?.allowedBranches],
    );
    const linearBranchOptions: Option[] = React.useMemo(
        () => buildBranchOptions(linearConfig?.allowedBranches || []),
        [buildBranchOptions, linearConfig?.allowedBranches],
    );
    const issueCreationBranchOptions: Option[] = React.useMemo(
        () => buildBranchOptions(issueCreationBranches),
        [buildBranchOptions, issueCreationBranches],
    );

    // Async props spread onto each branch multi-select. Only set when async mode
    // is enabled so legacy (full-list) usage stays byte-for-byte identical.
    const asyncSelectProps = branchesAsync
        ? {
              onSearchChange: onBranchSearchChange,
              onLoadMore: onBranchLoadMore,
              hasMore: branchesHasMore,
              searching: branchesSearching,
              loadingMore: branchesLoadingMore,
          }
        : {};

    const jiraProjectOptions: Option[] = jiraProjects.map((project) => ({
        label: jiraProjectLabel(project.key, project.name),
        value: project.projectId,
    }));

    // A Linear team reads like a Jira project: « Engineering (ENG) ».
    const linearConfigured = Boolean(linearConfig?.isConfigured);
    const linearTeamLabel = linearConfig ? jiraProjectLabel(linearConfig.teamKey, linearConfig.teamName) : "";
    const linearTeamSelectOptions: Option[] = [];
    const linearProjectSelectOptions: Option[] = [];
    const linearLabelSelectOptions: Option[] = [];
    if (isLinearConnected) {
        // Leaving the team is a choice of its own: it stops the Linear tickets of the project.
        if (linearConfigured) {
            linearTeamSelectOptions.push({ label: t('components.issuesSettings.linearNoTeam'), value: "" });
        }
        for (const team of linearTeams) {
            linearTeamSelectOptions.push({ label: jiraProjectLabel(team.key, team.name), value: team.id });
        }
        // The saved team, project and labels are always listed, so each keeps its name
        // before the team's options are read (and if it was removed from Linear since).
        if (linearConfig?.teamId && !linearTeams.some((team) => team.id === linearConfig.teamId)) {
            linearTeamSelectOptions.push({ label: linearTeamLabel, value: linearConfig.teamId });
        }

        if (linearConfig?.linearProjectId) {
            linearProjectSelectOptions.push({ label: t('components.issuesSettings.linearNoProject'), value: "" });
        }
        for (const project of linearTeamOptions?.projects ?? []) {
            linearProjectSelectOptions.push({ label: project.name, value: project.id });
        }
        if (
            linearConfig?.linearProjectId &&
            !linearProjectSelectOptions.some((option) => option.value === linearConfig.linearProjectId)
        ) {
            linearProjectSelectOptions.push({
                label: linearConfig.linearProjectName || linearConfig.linearProjectId,
                value: linearConfig.linearProjectId,
            });
        }

        for (const label of linearTeamOptions?.labels ?? []) {
            linearLabelSelectOptions.push({ label: label.name, value: label.id });
        }
        for (const label of linearConfig?.labels ?? []) {
            if (!linearLabelSelectOptions.some((option) => option.value === label.id)) {
                linearLabelSelectOptions.push({ label: label.name, value: label.id });
            }
        }
    }

    const issueCreationModeOptions = [
        {
            value: "per_vulnerability_type",
            label: t('components.issuesSettings.modeOptions.perVulnerabilityType'),
            description: t('components.issuesSettings.modeOptions.perVulnerabilityTypeDesc'),
        },
        {
            value: "per_vulnerability",
            label: t('components.issuesSettings.modeOptions.perVulnerability'),
            description: t('components.issuesSettings.modeOptions.perVulnerabilityDesc'),
        },
        {
            value: "per_file",
            label: t('components.issuesSettings.modeOptions.perFile'),
            description: t('components.issuesSettings.modeOptions.perFileDesc'),
        },
    ];

    return (
        <div className="space-y-8">
            {/* ═══════════════════════════════════════════════════════════
                SECTION JIRA
               ═══════════════════════════════════════════════════════════ */}
            {isJiraConnected && (
                <div className="space-y-4">
                    <h2 className={AS_PANEL_TITLE}>
                        Jira
                    </h2>

                    <Card>
                        <div className="space-y-4">
                            <div className="flex items-start gap-4">
                                <div className={AS_GLYPH_BOX}>
                                    <img src="/image/integrations/jira.png" alt="Jira" className="h-[18px] w-[18px]" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {t('components.issuesSettings.jiraIssues')}
                                    </h3>
                                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                        {t('components.issuesSettings.jiraIssuesDescription')}
                                    </p>
                                </div>
                            </div>

                            {/* Jira Project Selector */}
                            <Select
                                options={jiraProjectOptions}
                                value={jiraConfig?.jiraProjectId || ""}
                                onChange={(value: string) => {
                                    if (!value) {
                                        onJiraProjectChange(null);
                                    } else {
                                        const selected = jiraProjects.find(p => p.projectId === value);
                                        if (selected) onJiraProjectChange(selected);
                                    }
                                }}
                                placeholder={t('components.issuesSettings.jiraProjectPlaceholder')}
                                label={t('components.issuesSettings.jiraProjectLabel')}
                            />

                            {/* Jira Branch Restriction */}
                            {jiraConfig?.isConfigured && jiraBranchOptions.length > 0 && (
                                <div>
                                    <Select
                                        multiple
                                        searchable
                                        options={jiraBranchOptions}
                                        value={jiraConfig.allowedBranches || []}
                                        onChange={onJiraAllowedBranchesChange}
                                        placeholder={t('components.issuesSettings.jiraBranchPlaceholder')}
                                        label={t('components.issuesSettings.jiraBranchLabel')}
                                        {...asyncSelectProps}
                                    />
                                    {(jiraConfig.allowedBranches || []).length > 0 && (
                                        <div className={cn(AS_NOTICE, "mt-2")}>
                                            <span aria-hidden className={cn(AS_NOTICE_DOT, NOTICE_DOT.info)} />
                                            <p>
                                                {t('components.issuesSettings.jiraBranchInfo', {
                                                    count: jiraConfig.allowedBranches.length,
                                                    branches: jiraConfig.allowedBranches.join(', '),
                                                })}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Auto-create toggle */}
                            {jiraConfig?.isConfigured && (
                                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
                                    <div>
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {t('components.issuesSettings.jiraAutoCreate')}
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {t('components.issuesSettings.jiraAutoCreateDescription')}
                                        </p>
                                    </div>
                                    <Toggle enabled={jiraConfig.autoCreateEnabled || false} onChange={onJiraAutoCreateToggle} />
                                </div>
                            )}

                            {jiraConfig?.isConfigured && (
                                <div className={AS_NOTICE}>
                                    {/* The sentence in green: it carries the « configured » status (no dot). */}
                                    <p className={AS_WORD_TONE.good}>
                                        {t('components.issuesSettings.jiraConfigured', {
                                            project: jiraProjectLabel(jiraConfig.jiraProjectKey, jiraConfig.jiraProjectName),
                                        })}
                                    </p>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                SECTION LINEAR
               ═══════════════════════════════════════════════════════════ */}
            {isLinearConnected && (
                <div className="space-y-4">
                    <h2 className={AS_PANEL_TITLE}>
                        Linear
                    </h2>

                    <Card>
                        <div className="space-y-4">
                            <div className="flex items-start gap-4">
                                <div className={AS_GLYPH_BOX}>
                                    <img src="/image/integrations/linear.svg" alt="Linear" className="h-[18px] w-[18px]" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {t('components.issuesSettings.linearIssues')}
                                    </h3>
                                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                        {t('components.issuesSettings.linearIssuesDescription')}
                                    </p>
                                </div>
                            </div>

                            {/* Linear Team Selector */}
                            <Select
                                options={linearTeamSelectOptions}
                                value={linearConfig?.teamId || ""}
                                onChange={(value: string) => onLinearTeamChange(value || null)}
                                placeholder={t('components.issuesSettings.linearTeamPlaceholder')}
                                label={t('components.issuesSettings.linearTeamLabel')}
                                disabled={isLinearConfigLoading}
                            />

                            {/* Linear Project Selector */}
                            {linearConfigured && (
                                <Select
                                    searchable
                                    options={linearProjectSelectOptions}
                                    value={linearConfig?.linearProjectId || ""}
                                    onChange={(value: string) => onLinearProjectChange(value || null)}
                                    placeholder={t('components.issuesSettings.linearProjectPlaceholder')}
                                    label={t('components.issuesSettings.linearProjectLabel')}
                                />
                            )}

                            {/* Linear Labels */}
                            {linearConfigured && (
                                <Select
                                    multiple
                                    searchable
                                    options={linearLabelSelectOptions}
                                    value={(linearConfig?.labels || []).map((label) => label.id)}
                                    onChange={onLinearLabelsChange}
                                    placeholder={t('components.issuesSettings.linearLabelsPlaceholder')}
                                    label={t('components.issuesSettings.linearLabelsLabel')}
                                />
                            )}

                            {/* Linear Branch Restriction */}
                            {linearConfig?.isConfigured && linearBranchOptions.length > 0 && (
                                <div>
                                    <Select
                                        multiple
                                        searchable
                                        options={linearBranchOptions}
                                        value={linearConfig.allowedBranches || []}
                                        onChange={onLinearAllowedBranchesChange}
                                        placeholder={t('components.issuesSettings.linearBranchPlaceholder')}
                                        label={t('components.issuesSettings.linearBranchLabel')}
                                        {...asyncSelectProps}
                                    />
                                    {(linearConfig.allowedBranches || []).length > 0 && (
                                        <div className={cn(AS_NOTICE, "mt-2")}>
                                            <span aria-hidden className={cn(AS_NOTICE_DOT, NOTICE_DOT.info)} />
                                            <p>
                                                {t('components.issuesSettings.linearBranchInfo', {
                                                    count: linearConfig.allowedBranches.length,
                                                    branches: linearConfig.allowedBranches.join(', '),
                                                })}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Auto-create toggle */}
                            {linearConfig?.isConfigured && (
                                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
                                    <div>
                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {t('components.issuesSettings.linearAutoCreate')}
                                        </p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                            {t('components.issuesSettings.linearAutoCreateDescription')}
                                        </p>
                                    </div>
                                    <Toggle enabled={linearConfig.autoCreateEnabled || false} onChange={onLinearAutoCreateToggle} />
                                </div>
                            )}

                            {linearConfig?.isConfigured && (
                                <div className={AS_NOTICE}>
                                    {/* The sentence in green: it carries the « configured » status, as Jira's does. */}
                                    <p className={AS_WORD_TONE.good}>
                                        {linearConfig.linearProjectName
                                            ? t('components.issuesSettings.linearConfiguredInProject', {
                                                team: linearTeamLabel,
                                                project: linearConfig.linearProjectName,
                                            })
                                            : t('components.issuesSettings.linearConfigured', { team: linearTeamLabel })}
                                    </p>
                                </div>
                            )}
                        </div>
                    </Card>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                SECTION GITHUB / GITLAB
               ═══════════════════════════════════════════════════════════ */}
            {(isProjectLinkedToGithub || isProjectLinkedToGitlab) && (
                <div className="space-y-4">
                    <h2 className={AS_PANEL_TITLE}>
                        GitHub / GitLab Issues
                    </h2>

                    {/* GitHub Issues Card */}
                    {isProjectLinkedToGithub && (
                        <Card>
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    <div className={AS_GLYPH_BOX}>
                                        <Github className={AS_GLYPH}  />
                                    </div>
                                    <div className="flex-1 pr-4">
                                        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {t('components.issuesSettings.githubIssues')}
                                        </h3>
                                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                            {t('components.issuesSettings.githubIssuesDescription')}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <Toggle enabled={githubIssueEnabled} onChange={onGithubIssueToggle} />
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* GitLab Issues Card */}
                    {isProjectLinkedToGitlab && (
                        <Card>
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    <div className={AS_GLYPH_BOX}>
                                        <Gitlab className={AS_GLYPH}  />
                                    </div>
                                    <div className="flex-1 pr-4">
                                        <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                            {t('components.issuesSettings.gitlabIssues')}
                                        </h3>
                                        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                            {t('components.issuesSettings.gitlabIssuesDescription')}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-1">
                                    <Toggle enabled={gitlabIssueEnabled} onChange={onGitlabIssueToggle} />
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* Issue Creation Mode — GitHub/GitLab only */}
                    {showGitSettings && (
                        <Card>
                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {t('components.issuesSettings.issueGroupingMode')}
                                    </h3>
                                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                        {t('components.issuesSettings.issueGroupingModeDescription')}
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {issueCreationModeOptions.map((option) => (
                                        <label
                                            key={option.value}
                                            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors duration-[120ms] ${issueCreationMode === option.value
                                                ? "border-secondary bg-secondary/[0.04] dark:border-secondary-light/40 dark:bg-secondary/10"
                                                : "border-zinc-200 hover:border-zinc-300 dark:border-as-line dark:hover:border-white/[0.14]"
                                                }`}
                                        >
                                            <input
                                                type="radio"
                                                name="issueCreationMode"
                                                value={option.value}
                                                checked={issueCreationMode === option.value}
                                                onChange={() => onIssueCreationModeChange(option.value)}
                                                className="mt-0.5 h-4 w-4 accent-secondary"
                                            />
                                            <div className="flex-1">
                                                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                    {option.label}
                                                </div>
                                                <div className="text-[13px] text-zinc-500 dark:text-zinc-400">
                                                    {option.description}
                                                </div>
                                            </div>
                                            {option.value === "per_vulnerability_type" && (
                                                <span className={AS_TAG}>
                                                    {t('common.recommended')}
                                                </span>
                                            )}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* Branch Selection — GitHub/GitLab only */}
                    {showGitSettings && issueCreationBranchOptions.length > 0 && (
                        <Card>
                            <div className="space-y-4">
                                <div>
                                    <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {t('components.issuesSettings.branchSelection.title')}
                                    </h3>
                                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                                        {t('components.issuesSettings.branchSelection.description')}
                                    </p>
                                </div>

                                <Select
                                    multiple
                                    searchable
                                    options={issueCreationBranchOptions}
                                    value={issueCreationBranches}
                                    onChange={onIssueCreationBranchesChange}
                                    placeholder={t('components.issuesSettings.branchSelection.placeholder')}
                                    label={t('components.issuesSettings.branchSelection.label')}
                                    {...asyncSelectProps}
                                />

                                {issueCreationBranches.length > 0 && (
                                    <div className={AS_NOTICE}>
                                        <span aria-hidden className={cn(AS_NOTICE_DOT, NOTICE_DOT.info)} />
                                        <p>
                                            {t('components.issuesSettings.branchSelection.info', {
                                                count: issueCreationBranches.length,
                                            })}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    )}
                </div>
            )}

            {/* Info Card */}
            <Card>
                <div className={AS_NOTICE_BLOCK}>
                    <span aria-hidden className={cn(AS_NOTICE_DOT_BLOCK, NOTICE_DOT.info)} />
                    <div>
                        <p className={AS_NOTICE_TITLE}>{t('components.issuesSettings.infoTitle')}</p>
                        <p className="mt-1">{t('components.issuesSettings.infoDescription')}</p>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default IssuesSettings;

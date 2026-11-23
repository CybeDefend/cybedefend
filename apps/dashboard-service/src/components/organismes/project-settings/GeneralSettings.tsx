import React from "react";
import Button from "../../atoms/button/Button";
import Card from "../../atoms/card/Card";
import Select from "../../atoms/select/Select";
import Toggle from "../../atoms/toggle/Toggle";
import ConfirmationModal from "../../molecules/modal/confirmation-modal/ConfirmationModal";
import Input from "../../atoms/input/Input";
import ProjectIdActions from "../../molecules/project-id-actions/ProjectIdActions";
import { AuthorizedContent } from "react-rebac";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { spaceOf, useProduct } from "@/utils/product";
import { useScansRun } from "@/edition/community/instanceCapabilities";

export interface GeneralSettingsProps {
  projectName: string;
  teamName: string;
  teamId: string;
  projectId: string;
  applicationType: string;
  onApplicationTypeChange: (value: string) => void;
  onDisableProject: () => void;
  onDeleteProject: () => void;
  loading: boolean;

  isProjectLinkedToGithub: boolean;
  onUnlinkGithubProject: () => void;
  isProjectLinkedToGitlab: boolean;
  onUnlinkGitlabProject: () => void;

  branches: Array<{ name: string; isDefault?: boolean; isProtected?: boolean }>;
  // `branches` is one page of /branches/list: the reference-branch field then
  // searches it on the backend and loads the next pages.
  branchesAsync?: boolean;
  onBranchSearchChange?: (value: string) => void;
  onBranchLoadMore?: () => void;
  branchesHasMore?: boolean;
  branchesSearching?: boolean;
  branchesLoadingMore?: boolean;
  referenceBranch: string | null;
  onReferenceBranchChange: (branch: string | null) => void;

  scanOnCommitEnabled: boolean;
  onScanOnCommitToggle: () => void;
}

/** What a space's own General section receives (`ProductSpace.ProjectGeneralSettings`). */
export interface ProjectGeneralSettingsProps extends GeneralSettingsProps {
  organizationId?: string;
}

const GeneralSettings: React.FC<GeneralSettingsProps> = (props) => {
  const {
  projectName,
  teamName,
  teamId,
  projectId,
  applicationType,
  onApplicationTypeChange,
  onDisableProject,
  onDeleteProject,
  isProjectLinkedToGithub,
  onUnlinkGithubProject,
  isProjectLinkedToGitlab,
  onUnlinkGitlabProject,
  branches,
  branchesAsync = false,
  onBranchSearchChange,
  onBranchLoadMore,
  branchesHasMore,
  branchesSearching,
  branchesLoadingMore,
  referenceBranch,
  onReferenceBranchChange,
  scanOnCommitEnabled,
  onScanOnCommitToggle,
  loading,
  } = props;
  const [showConfirmationModal, setShowConfirmationModal] = React.useState(false);
  const { t } = useTranslation();
  // A push starts a scan only where scanners run: an import-only Community
  // instance runs none (results come by import), so it offers no scan
  // on every commit; one that runs scans on a connected cluster does. The cloud
  // always does (useScansRun is true there).
  const scansOnPush = useScansRun();
  // The page is served in every space. A space with its own General section
  // (`ProjectGeneralSettings`) shows it instead; this one is AppSec's.
  const space = spaceOf(useProduct());
  const OwnGeneralSettings = space.ProjectGeneralSettings;
  // A space that scores no findings leaves out what only drives a scan: the
  // application type, the reference branch of the results, the scan on every commit.
  const scanSettings = space.findingSettings !== false;

  const applicationTypeOptions = [
    { value: "web_application", label: "Web Application" },
    { value: "software", label: "Software" },
    { value: "mobile_application", label: "Mobile Application" },
    { value: "iot", label: "IoT" },
    { value: "other", label: "Other" },
  ];

  const handleConfirmDelete = () => {
    onDeleteProject();
    setShowConfirmationModal(false);
  };

  const handleCancelDelete = () => {
    setShowConfirmationModal(false);
  };

  const selectedOrganization = useSelector(
    (state: any) => state.organization.selectedOrganization
  );

  if (OwnGeneralSettings) {
    return <OwnGeneralSettings {...props} organizationId={selectedOrganization?.id} />;
  }

  return (
    <Card>
      {/* The card already pads 24px: on a phone the section adds none. */}
      <div data-testid="project-settings-section-body" className="space-y-6 w-full sm:p-4">
        { }
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t('components.generalSettings.projectName')}
          </h3>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t('components.generalSettings.projectNameDescription')}
          </p>
          <div className="mt-2">
            <Input value={projectName} readOnly width="w-full" />
          </div>
        </div>

        { }
        {scanSettings && (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.generalSettings.applicationType')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.generalSettings.applicationTypeDescription')}
              </p>
              <div className="mt-2">
                <Select
                  options={applicationTypeOptions}
                  value={applicationType}
                  onChange={(value) => onApplicationTypeChange(value)}
                  placeholder={t('components.generalSettings.selectApplicationType')}
                  width="w-full"
                />
              </div>
            </div>
          </AuthorizedContent>
        )}

        { }
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t('components.generalSettings.linkedTeam')}
          </h3>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t('components.generalSettings.linkedTeamDescription')}
          </p>
          <div className="mt-2">
            <Input value={teamName} readOnly width="w-full" />
          </div>
        </div>

        { }
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t('components.generalSettings.projectId')}
          </h3>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t('components.generalSettings.projectIdDescription')}
          </p>
          {/* An identifier you can only read is not a form field. Showing it
              as one invited edits that silently did nothing; it is text with a
              copy action, which is what anyone actually wants from an ID.
              It is shown whole: on a phone it takes two lines (`break-all`)
              rather than lose its end. */}
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-as-line-strong dark:bg-white/[0.03]">
            <code className="min-w-0 flex-1 select-all break-all font-mono text-[13px] text-zinc-700 dark:text-zinc-300">
              {projectId}
            </code>
            <ProjectIdActions projectId={projectId} statePill={false} />
          </div>
        </div>

        {/* Reference Branch Section */}
        {scanSettings && (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.generalSettings.referenceBranch')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.generalSettings.referenceBranchDescription')}
              </p>
              <div className="mt-2">
                <Select
                  options={[
                    { value: '__ALL_BRANCHES__', label: t('components.generalSettings.allBranches') },
                    // Include referenceBranch if it's set but not in branches list
                    ...(referenceBranch && !branches.some(b => b.name === referenceBranch)
                      ? [{ value: referenceBranch, label: referenceBranch }]
                      : []),
                    ...branches.map(branch => ({
                      value: branch.name,
                      label: branch.name + (branch.isDefault ? ` (${t('components.generalSettings.default')})` : ''),
                    })),
                  ]}
                  value={referenceBranch || '__ALL_BRANCHES__'}
                  onChange={(value) => onReferenceBranchChange(value === '__ALL_BRANCHES__' ? null : value)}
                  placeholder={t('components.generalSettings.selectReferenceBranch')}
                  width="w-full"
                  {...(branchesAsync
                    ? {
                        searchable: true,
                        onSearchChange: onBranchSearchChange,
                        onLoadMore: onBranchLoadMore,
                        hasMore: branchesHasMore,
                        searching: branchesSearching,
                        loadingMore: branchesLoadingMore,
                      }
                    : {})}
                />
              </div>
              {referenceBranch && (
                <p className="mt-2 text-[13px] text-amber-700 dark:text-amber-400">
                  {t('components.generalSettings.referenceBranchWarning')}
                </p>
              )}
            </div>
          </AuthorizedContent>
        )}

        {/* No switch of another space here: since the products were split, a
            project is turned on or off in that space's own settings. */}

        {/* Scan on commit — only meaningful for a project whose commits we
            receive, i.e. one linked to a GitHub or GitLab repository. */}
        {scansOnPush && scanSettings && (isProjectLinkedToGithub || isProjectLinkedToGitlab) && (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <div data-testid="scan-on-commit-setting">
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.generalSettings.scanOnCommit.title')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.generalSettings.scanOnCommit.description')}
              </p>
              <div className="mt-2">
                <Toggle
                  id="scan-on-commit-enabled-toggle"
                  enabled={scanOnCommitEnabled}
                  onChange={() => onScanOnCommitToggle()}
                />
              </div>
            </div>
          </AuthorizedContent>
        )}

        { }
        {/* GitHub Integration Section */}
        {isProjectLinkedToGithub && (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.generalSettings.unlinkFromGithub')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.generalSettings.unlinkFromGithubDescription')}
              </p>
              <div className="mt-2">
                <Button variant="secondary" onClick={onUnlinkGithubProject}>
                  {t('components.generalSettings.unlinkProject')}
                </Button>
              </div>
            </div>
          </AuthorizedContent>
        )}

        {/* GitLab Integration Section */}
        {isProjectLinkedToGitlab && (
          <AuthorizedContent
            entities={[
              {
                entityId: selectedOrganization?.id,
                entityType: "organization",
                relationship: ["administrator", "creator"],
              },
              {
                entityId: teamId,
                entityType: "team",
                relationship: ["team_manager"],
              },
            ]}
          >
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.generalSettings.unlinkFromGitlab')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.generalSettings.unlinkFromGitlabDescription')}
              </p>
              <div className="mt-2">
                <Button variant="secondary" onClick={onUnlinkGitlabProject}>
                  {t('components.generalSettings.unlinkProject')}
                </Button>
              </div>
            </div>
          </AuthorizedContent>
        )}

        { }
        <AuthorizedContent
          entities={[
            {
              entityId: selectedOrganization?.id,
              entityType: "organization",
              relationship: ["administrator", "creator"],
            },
            {
              entityId: teamId,
              entityType: "team",
              relationship: ["team_manager"],
            },
          ]}
        >
          <div>
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {t('components.generalSettings.deleteProject')}
            </h3>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t('components.generalSettings.deleteProjectDescription')}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button
                loading={loading}
                variant="destructive"
                onClick={() => setShowConfirmationModal(true)}
              >
                {t('components.generalSettings.deleteProject')}
              </Button>
            </div>
          </div>
        </AuthorizedContent>

        {showConfirmationModal && (
          <ConfirmationModal
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
            animationDirection="none"
            text={t('components.generalSettings.deleteConfirmation')}
          />
        )}
      </div>
    </Card>
  );
};

export default GeneralSettings;

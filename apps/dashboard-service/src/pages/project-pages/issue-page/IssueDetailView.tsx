import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { useTranslation } from "react-i18next";
import { useOnboardingProgress } from "@/server/hooks/useOnboardingProgress";
import NotFoundElement from "../../../components/molecules/not-found-element/NotFoundElement";
import useVulnerability from "../../../server/hooks/useVulnerability";
import useProject from "../../../server/hooks/useProject";
import {
  CicdVulnerabilityResult,
  ContainerVulnerabilityResult,
  IacVulnerabilityResult,
  SastVulnerabilityResult,
  ScaVulnerabilityResult,
  SecretVulnerabilityResult,
  UpdateResultRequestDto,
} from "../../../server/interfaces/Vulnerability";
import { updateVulnerability } from "../../../server/services/resultService";
import IssueSastIacTemplate, { ActiveTab } from "./IssueSastIacTemplate";
import IssueScaTemplate from "./IssueScaTemplate";
import IssueContainerTemplate from "./IssueContainerTemplate";
import BackButton from "@/components/atoms/button/BackButton";
import Card from "@/components/atoms/card/Card";
import { Skeleton } from "@/components/atoms/skeleton/Skeleton";
import { useIssueTracking } from "@/server/hooks/useIssueTracking";

export type IssueDetailType = "sast" | "iac" | "cicd" | "secret" | "sca" | "container";

interface IssueDetailViewProps {
  projectId: string;
  issueId: string;
  type: IssueDetailType;
  /** Renders without the page chrome (back button, full-height background)
   * for use inside the quick-view drawer. */
  embedded?: boolean;
  /** Back/close action used by the loading + error states. */
  onBack?: () => void;
  /**
   * Creation date of the project's latest finished scan for this
   * finding family (from the Results page's `scanInfo`), or null when
   * unknown. Lets the SAST/IaC/CI-CD template flag an agent analysis that
   * dates from a previous scan and offer to re-run it.
   */
  lastScanAt?: string | null;
}

/**
 * Loads a single vulnerability and renders the correct detail template
 * (SAST/IAC/CICD/Secret, SCA or Container) with all of its content and update
 * actions. Shared by the full-page `IssuePage` and the quick-view drawer so
 * the two stay byte-for-byte identical — the drawer is the future home of this
 * view once the dedicated page is retired.
 */
const IssueDetailView: React.FC<IssueDetailViewProps> = ({
  projectId,
  issueId,
  type,
  embedded = false,
  onBack,
  lastScanAt = null,
}) => {
  const { t } = useTranslation();
  const { complete } = useOnboardingProgress();

  const { vulnerability, loading, error, refresh, silentRefresh, isProjectParsed } =
    useVulnerability(projectId, issueId, type);

  const { isAiMergeRequestEnabled, isGithubLinked, isGitlabLinked, isJiraLinked, isLinearLinked } =
    useProject(projectId);

  const selectedOrganization = useSelector(
    (state: any) => state.organization.selectedOrganization,
  );
  const organizationId = selectedOrganization?.id || "";

  // The Jira and Linear tickets of the project, and which tool can take one.
  const issueTracking = useIssueTracking(projectId, { isJiraLinked, isLinearLinked });

  // Mark first vulnerability viewed when data loads.
  useEffect(() => {
    if (vulnerability) complete("first_vuln_viewed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vulnerability]);

  const showAiWidget = isProjectParsed;

  const [showModal, setShowModal] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("details");

  const handleUpdateVulnerability = async ({
    status,
    priority,
    comment,
    exploitabilityVerdict,
    exploitabilityReason,
    dismissalReason,
  }: {
    status?: string;
    priority?: string;
    comment?: string;
    exploitabilityVerdict?: string;
    exploitabilityReason?: string;
    /** Mandatory server-side when `status === 'ignored'`. */
    dismissalReason?: string;
  }) => {
    try {
      if (!status && !priority && !comment && !exploitabilityVerdict) {
        toast.error(t("pages.issuePage.provideFieldError"));
        return;
      }

      const updateData: UpdateResultRequestDto = {
        projectId,
        vulnerabilityId: issueId,
        status,
        priority,
        comment,
        exploitabilityVerdict,
        exploitabilityReason,
        dismissalReason,
      };

      if (updateData.projectId && updateData.vulnerabilityId) {
        await updateVulnerability(updateData.projectId, updateData.vulnerabilityId, updateData);
        toast.success(t("pages.issuePage.updateSuccess"));
        if (comment || status || priority || exploitabilityVerdict) {
          setActiveTab("history");
        }
        // Refresh SILENTLY so `loading` never flips. A non-silent
        // refresh() renders the full-page skeleton, flashing the detail (in the
        // quick-view drawer especially); silentRefresh updates the shown values
        // and history in place after the modal closes.
        silentRefresh();
      } else {
        toast.error(t("pages.issuePage.noIdError"));
      }
    } catch {
      toast.error(t("pages.issuePage.updateError"));
    }
  };

  const handleAutofixSuccess = () => {
    refresh();
    setActiveTab("autofix");
  };

  const handleOpenModal = () => setShowModal(true);
  const handleCloseModal = () => setShowModal(false);

  if (loading) {
    if (embedded) {
      // Skeleton mirroring the embedded drawer layout (IssueSastIacTemplate
      // header → metadata card → code snippet → tab bar → content). Plain
      // container, no Card chrome, every placeholder rounded to match its
      // real counterpart and avoid a bordered/rounded flash on load.
      return (
        <div className="p-4 space-y-4">
          {/* Header: severity pill + title line + chip placeholders */}
          <div className="flex items-start gap-3">
            <Skeleton type="block" width="80px" height="28px" rounded="full" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton type="line" width="66%" height="1.5rem" rounded="lg" />
              <div className="flex gap-2">
                <Skeleton type="block" width="72px" height="20px" rounded="md" />
                <Skeleton type="block" width="60px" height="20px" rounded="md" />
              </div>
            </div>
          </div>
          {/* Action buttons row */}
          <div className="flex gap-2">
            <Skeleton type="button" />
            <Skeleton type="button" />
          </div>
          {/* Metadata card */}
          <Skeleton type="block" height="96px" rounded="xl" />
          {/* CODE VULNERABLE snippet */}
          <Skeleton type="block" height="160px" rounded="xl" />
          {/* Tab bar + tab content */}
          <Skeleton type="line" width="100%" height="2.25rem" rounded="lg" />
          <Skeleton type="block" height="140px" rounded="xl" />
        </div>
      );
    }
    return (
      <div className="mx-auto px-4 py-6">
        <div className="mb-4">
          <BackButton
            text={t("components.analyseWrapper.backToVulnerabilities")}
            onClick={onBack}
          />
        </div>
        <Card className="rounded-2xl">
          <div className="p-4 sm:p-6 space-y-6">
            <div className="flex items-start gap-4">
              <Skeleton type="block" width="96px" height="32px" rounded="full" />
              <div className="flex-1 space-y-3">
                <Skeleton type="line" width="50%" height="2rem" rounded="lg" />
                <Skeleton type="line" width="30%" height="1rem" rounded="md" />
              </div>
            </div>
            <Skeleton type="block" height="96px" rounded="2xl" />
            <Skeleton type="block" height="200px" rounded="2xl" />
            <Skeleton type="line" width="100%" height="2.5rem" rounded="lg" />
            <Skeleton type="block" height="180px" rounded="2xl" />
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <NotFoundElement
        title={t("pages.issuePage.errorLoadingTitle")}
        description={t("pages.issuePage.errorLoadingDescription")}
        buttonText={t("common.back")}
        onShowAll={onBack ?? (() => window.history.back())}
      />
    );
  }

  if (!vulnerability) {
    return (
      <NotFoundElement
        title={t("pages.issuePage.noVulnerabilityTitle")}
        description={t("pages.issuePage.noVulnerabilityDescription")}
        buttonText={t("common.back")}
        onShowAll={onBack ?? (() => window.history.back())}
      />
    );
  }

  if (vulnerability.vulnerabilityType === "container") {
    return (
      <IssueContainerTemplate
        vulnerability={vulnerability as ContainerVulnerabilityResult}
        showModal={showModal}
        onCloseModal={handleCloseModal}
        handleUpdateVulnerability={handleUpdateVulnerability}
        handleOpenModal={handleOpenModal}
        error={error}
        isProjectParsed={showAiWidget}
        projectId={projectId}
        issueTracking={issueTracking}
        embedded={embedded}
      />
    );
  }

  if (vulnerability.vulnerabilityType === "sca") {
    return (
      <IssueScaTemplate
        vulnerability={vulnerability as ScaVulnerabilityResult}
        showModal={showModal}
        onCloseModal={handleCloseModal}
        handleUpdateVulnerability={handleUpdateVulnerability}
        handleOpenModal={handleOpenModal}
        error={error}
        isProjectParsed={showAiWidget}
        projectId={projectId}
        isGithubLinked={isGithubLinked}
        isGitlabLinked={isGitlabLinked}
        issueTracking={issueTracking}
        embedded={embedded}
      />
    );
  }

  return (
    <IssueSastIacTemplate
      vulnerability={
        vulnerability as
          | SastVulnerabilityResult
          | IacVulnerabilityResult
          | CicdVulnerabilityResult
          | SecretVulnerabilityResult
      }
      showModal={showModal}
      onCloseModal={handleCloseModal}
      handleUpdateVulnerability={handleUpdateVulnerability}
      handleOpenModal={handleOpenModal}
      error={error}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      isAiMergeRequestEnabled={isAiMergeRequestEnabled}
      isGithubLinked={isGithubLinked}
      isGitlabLinked={isGitlabLinked}
      projectId={projectId}
      onRefreshVulnerability={refresh}
      onSilentRefreshVulnerability={silentRefresh}
      lastScanAt={lastScanAt}
      onAutofixSuccess={handleAutofixSuccess}
      isProjectParsed={showAiWidget}
      organizationId={organizationId}
      issueTracking={issueTracking}
      embedded={embedded}
    />
  );
};

export default IssueDetailView;

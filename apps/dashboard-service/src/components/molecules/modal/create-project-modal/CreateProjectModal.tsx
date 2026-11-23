import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import Button from "../../../atoms/button/Button";
import Modal from "../../../atoms/modal/Modal";
import {
  generateGitlabInstallUrl,
  linkGitlabRepository,
} from "@/server/services/integrations/gitlabIntegrationsService";
import { linkGithubRepository } from "@/server/services/integrations/githubIntegrationsService";
import { createProjectAndLinkRepository } from "@/server/services/projectService";
import type { Project } from "@/server/interfaces/Project";
import type { IntegrationProvider, Repository } from "@/server/interfaces/IntegrationProvider";
import { rememberIntegrationReturn } from "@/pages/integrations-page/shared/integrationReturn";
import { openGithubAppInstall } from "@/pages/integrations-page/shared/githubAppInstall";
import { RootState } from "@/server/store";
import { useEditionEntitlements } from "@/edition/entitlements";
import { useCombinedIntegrations } from "@/server/hooks/useIntegrationsOverview";
import { Product, projectPath, spaceOf } from "@/utils/product";
import { cn } from "@/utils/function/utils";
import { isProjectLimitError } from "@/utils/function/createProjectWithFeedback";
import StepIndicator from "./components/StepIndicator";
import StepRepoPicker from "./components/StepRepoPicker";
import StepProjectBasics from "./components/StepProjectBasics";
import StepSecurityContext, {
  DEFAULT_SECURITY_CONTEXT,
  SecurityContextState,
} from "./components/StepSecurityContext";
import { coreStepsFor, stepsAfterCreation, type CreateProjectSource } from "./createProjectSteps";
import CreationCoach from "./components/CreationCoach";
import { getGithubAppUrl } from "@/config/runtimeConfig";
import { integrationNotConfiguredOf } from "@/server/services/integrations/integrationNotConfigured";
import IntegrationNotConfiguredMessage from "@/components/molecules/integration-not-configured/IntegrationNotConfiguredMessage";
import { Button as VdButton, SegmentedTabs } from "@/components/molecules/kit/ui";

import { AS_TOOLTIP, AS_FOCUS_INSET } from '@/components/atoms/appsec/styles';
/*
  The wizard of a space drawn on the zinc kit (`skin: 'zinc'`): the shared dialog on the kit's surface (hairline,
  12 px radius, the panel colour, no heavy shadow), the sources as text tabs
  with a sliding ink underline, the steps as 2 px segments, the actions as kit
  buttons — one ink primary, the rest hairline. AppSec renders today's wizard.
*/
const ZINC_DIALOG = cn(
  "border-zinc-200 shadow-[0_24px_48px_-16px_rgb(0_0_0/0.18),0_1px_2px_rgb(0_0_0/0.04)] dark:border-vd-line-strong dark:bg-vd-surface dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_24px_64px_-12px_rgb(0_0_0/0.85)] sm:rounded-xl",
  // The shared dialog paints its footer on its own colour: the kit's panel colour in dark.
  "dark:[&>div:last-child]:bg-vd-surface [&>div:last-child]:border-zinc-200 dark:[&>div:last-child]:border-vd-line",
  "[&>div:nth-last-child(3)]:border-zinc-200 dark:[&>div:nth-last-child(3)]:border-vd-line",
  // Its title at the kit's 15 px / 500 (the kit has no bold).
  "[&>div:nth-last-child(3)_h3]:text-[15px] [&>div:nth-last-child(3)_h3]:font-medium [&>div:nth-last-child(3)_h3]:leading-6 [&>div:nth-last-child(3)_h3]:tracking-[-0.01em]",
);
const ZINC_TOOLTIP =
  "absolute right-0 top-full z-50 mt-2 w-72 rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs leading-5 text-white opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none dark:bg-zinc-100 dark:text-zinc-900";

interface CreateProjectModalProps {
  onClose: () => void;
  /**
   * Creates the project (manual tab). It now RETURNS the created project so
   * the modal can show the space's steps after the creation with the real
   * project id.
   * The return type stays a union with `void` for backward compatibility with
   * the intermediate prop-threading types (HomeTemplate / AnalysisTable still
   * declare `=> void`); at runtime the real Project flows through unchanged.
   */
  onCreateProject: (
    projectName: string,
    teamId: string,
    aiMergeRequestEnabled?: boolean,
    improvingResultsEnabled?: boolean,
    sortsVulnerabilitiesEnabled?: boolean,
    securityChampionEnabled?: boolean,
    securityContext?: Record<string, unknown>,
  ) => void | Promise<void> | Promise<Project | null>;
  /**
   * Called after the modal has successfully created a project AND linked it
   * to the selected GitHub/GitLab repository (github/gitlab tabs). Parents
   * can use it to trigger their post-create side effects (refresh project
   * list, complete onboarding step, navigate, ...). On the manual tab, the
   * modal goes through `onCreateProject` and this callback is not invoked.
   */
  onProjectCreated?: (project: Project) => void | Promise<void>;
  teams: { label: string; value: string }[];
  /**
   * When true, renders the in-modal onboarding coach — a slim, dismissible,
   * Cybe-branded strip at the top of the modal body that guides the user
   * through each phase of project creation. Set by AnalysisTable when the modal
   * is opened from the onboarding tour. Purely additive: when false (default)
   * nothing extra renders and the modal output is unchanged.
   */
  guided?: boolean;
  /**
   * The space the wizard was opened from. Every space opens on GitHub. A
   * space that scores no findings (`findingSettings: false`) has no
   * security-context step: the context keeps its defaults, editable later in
   * the project settings. A space with steps after the creation shows them.
   */
  product?: Product;
  /**
   * The source the wizard opens on: GitHub unless the page was asked for
   * another one, as when the provider's callback brings the account back.
   */
  initialSource?: IntegrationProvider;
}

type CreateMode = CreateProjectSource;
type Step = 1 | 2 | 3;

// The wizard asks nothing about AI: a project starts with every AI feature on,
// each one turned off in the project settings.
const AI_FEATURES_AT_CREATION = {
  aiMergeRequestEnabled: true,
  improvingResultsEnabled: true,
  sortsVulnerabilitiesEnabled: true,
  securityChampionEnabled: true,
} as const;

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  onClose,
  onCreateProject,
  onProjectCreated,
  teams,
  guided = false,
  product = "appsec",
  initialSource = "github",
}) => {
  const { t } = useTranslation();
  const space = spaceOf(product);
  // The space's look: the zinc kit, or today's wizard.
  const zinc = space.skin === "zinc";
  const asksSecurityContext = space.findingSettings !== false;
  const afterSteps = useMemo(() => stepsAfterCreation(space.createProjectSteps), [space]);
  const ImportNotice = space.CreateProjectImportNotice;
  // Both spaces open on GitHub; the « no repository » source is one click away.
  const [createMode, setCreateMode] = useState<CreateMode>(initialSource);
  // The coach can be dismissed for the rest of this modal session (local only —
  // resets when the modal unmounts). Only meaningful when `guided` is true.
  const [coachDismissed, setCoachDismissed] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [projectName, setProjectName] = useState("");
  const [projectNameTouched, setProjectNameTouched] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [securityContext, setSecurityContext] = useState<SecurityContextState>(
    DEFAULT_SECURITY_CONTEXT,
  );
  const [errors, setErrors] = useState<{
    projectName?: string;
    teamId?: string;
    source?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  // Non-null once a project has been created in a space with steps after the
  // creation: the modal switches to them. AppSec closes on create.
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const teamDropdownRef = useRef<HTMLDivElement>(null);
  // The form of the current step. A space's import notice sits above it on the last step and
  // can push its fields under the fold of the dialog: a refused creation brings it back into view.
  const stepFormRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const organization = useSelector((state: RootState) => state.organization);
  const selectedOrganization = organization.selectedOrganization;
  const organizationId = selectedOrganization?.id || "";
  // Creating a project is a shared write (Permify `writable_any`): any active product is enough.
  const writesBlocked = !useEditionEntitlements().writableAny;

  // A space that scores no findings drops the last (security-context) step of each source.
  const baseSteps = coreStepsFor(createMode).length;
  const totalSteps = coreStepsFor(createMode, { securityContext: asksSecurityContext }).length;

  const {
    isGithubLinked,
    isGitlabLinked,
    githubRepositories,
    gitlabRepositories,
    isLoadingGithubRepos: loadingGithubRepos,
    isLoadingGitlabRepos: loadingGitlabRepos,
    isLoadingOverview,
  } = useCombinedIntegrations(organizationId, {
    enabled: createMode !== "manual",
    fetchGithubRepos: createMode === "github",
    fetchGitlabRepos: createMode === "gitlab",
  });

  const effectiveGithubLinked = isGithubLinked ?? false;
  const effectiveGitlabLinked = isGitlabLinked ?? false;

  useEffect(() => {
    if (teams.length === 1) {
      setSelectedTeamId(teams[0].value);
    }
  }, [teams]);

  // Reset the wizard whenever the user switches tab — the step model
  // differs between manual (2 steps, 1 without the security context) and
  // github/gitlab (3 steps, 2 without it), so the current step index is not
  // portable across modes.
  useEffect(() => {
    setStep(1);
    setSelectedRepo(null);
    setErrors({});
  }, [createMode]);

  // Auto-prefill the project name from the selected repository unless the
  // user has manually edited it. We track an explicit "touched" flag so
  // that legitimate edits are never overwritten when the repo selection
  // changes.
  useEffect(() => {
    if (selectedRepo && !projectNameTouched) {
      const display =
        selectedRepo.nameWithNamespace ||
        selectedRepo.fullName ||
        selectedRepo.name;
      setProjectName(display);
    }
  }, [selectedRepo, projectNameTouched]);

  const handleProjectNameChange = (value: string) => {
    setProjectName(value);
    setProjectNameTouched(true);
  };

  const validateRepoStep = (): boolean => {
    if (!selectedRepo) {
      const msg = t("components.modal.createProject.errors.repoRequired");
      setErrors((prev) => ({ ...prev, source: msg }));
      return false;
    }
    setErrors((prev) => ({ ...prev, source: undefined }));
    return true;
  };

  const validateBasicsStep = (): boolean => {
    const next: { projectName?: string; teamId?: string } = {};
    if (!projectName.trim()) {
      next.projectName = t(
        "components.modal.createProject.errors.projectNameRequired",
      );
    }
    if (!selectedTeamId) {
      next.teamId = t("components.modal.createProject.errors.teamRequired");
    }
    setErrors((prev) => ({ ...prev, ...next }));
    return Object.keys(next).length === 0;
  };

  const handleNext = () => {
    // The final step has no Next: it submits (see renderFooter).
    if (step >= totalSteps) return;
    if (createMode === "manual") {
      // step 1 = basics, step 2 = security context
      if (!validateBasicsStep()) return;
      setStep(2);
      return;
    }
    // github/gitlab: step 1 = repo, step 2 = basics, step 3 = security
    if (step === 1) {
      if (!validateRepoStep()) return;
      setStep(2);
      return;
    }
    if (!validateBasicsStep()) return;
    setStep(3);
  };

  const handleBack = () => {
    if (step <= 1) return;
    setStep((prev) => (prev - 1) as Step);
  };

  const resetWizard = () => {
    setSelectedRepo(null);
    setProjectName("");
    setProjectNameTouched(false);
    setSelectedTeamId("");
    setSecurityContext(DEFAULT_SECURITY_CONTEXT);
    setErrors({});
    setStep(1);
    setCreatedProjectId(null);
  };

  // Closes the modal from the steps after the creation (both "Later" and "Done").
  // Preserves the legacy reset behavior that used to run on create success.
  const handleFinish = () => {
    resetWizard();
    onClose();
  };

  const buildSecurityContextPayload = (
    withContext: boolean,
  ): SecurityContextState | undefined => {
    // Always send the (possibly default) context to the backend so that
    // isCustomized is set to true at creation time. The legacy "Skip"
    // button used to send undefined, which left isCustomized=false and
    // triggered the misleading "non configuré" banner on the project page.
    return withContext ? securityContext : DEFAULT_SECURITY_CONTEXT;
  };

  const submit = async (withContext: boolean) => {
    if (submitting) return;
    try {
      setSubmitting(true);
      const securityContextPayload = buildSecurityContextPayload(withContext);

      let created: Project | null = null;

      if (createMode !== "manual" && selectedRepo) {
        const linkFn =
          createMode === "github"
            ? (pid: string, rid: string) =>
                linkGithubRepository(organizationId, pid, {
                  repositoryId: rid,
                  product,
                }).then(() => undefined)
            : (pid: string, rid: string) =>
                linkGitlabRepository(organizationId, pid, {
                  repositoryId: rid,
                  product,
                }).then(() => undefined);

        const createdWithRepo = await createProjectAndLinkRepository({
          teamId: selectedTeamId,
          projectName,
          ...AI_FEATURES_AT_CREATION,
          securityContext: securityContextPayload,
          product,
          repoLink: { repositoryId: selectedRepo.id, link: linkFn },
        });
        created = createdWithRepo;
        if (onProjectCreated) {
          await onProjectCreated(createdWithRepo);
        }
      } else {
        // Manual tab: the parent (HomePage) now returns the created project so
        // the steps after the creation get the real id.
        created =
          ((await onCreateProject(
            projectName,
            selectedTeamId,
            AI_FEATURES_AT_CREATION.aiMergeRequestEnabled,
            AI_FEATURES_AT_CREATION.improvingResultsEnabled,
            AI_FEATURES_AT_CREATION.sortsVulnerabilitiesEnabled,
            AI_FEATURES_AT_CREATION.securityChampionEnabled,
            securityContextPayload as unknown as Record<string, unknown>,
          )) as Project | null | void) || null;
      }

      const newProjectId = created?.projectId ?? null;
      if (afterSteps.length > 0 && newProjectId) {
        // Keep the modal open on the space's steps after the creation. The
        // list refresh already fired inside the parent's create handler.
        setCreatedProjectId(newProjectId);
      } else {
        // A space without steps after the creation closes. Also the fallback
        // when the created id is unknown (a parent that does not return the
        // project).
        resetWizard();
        onClose();
      }
    } catch (err) {
      // Preserve wizard state so the user can retry/correct their inputs.
      // The backend signals "project limit reached" via gRPC RESOURCE_EXHAUSTED
      // mapped to HTTP 429 — surface a localized message in that case so the
      // user understands they hit a plan limit (not a transient failure), even
      // if the parent already raised a generic toast with the raw EN message.
      if (isProjectLimitError(err)) {
        toast.error(t("components.modal.createProject.errors.limitReached"));
      } else if (!(err as { __toastHandled?: boolean })?.__toastHandled) {
        toast.error(t("components.modal.createProject.errors.createFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConnectGithub = () => {
    if (effectiveGithubLinked) return;
    const githubInstallUrl = getGithubAppUrl();
    if (githubInstallUrl) {
      // The callback, in the new tab, brings the account back to this wizard's product.
      rememberIntegrationReturn(product, "github");
      openGithubAppInstall(organizationId, githubInstallUrl).catch((error) => {
        console.error("Error starting the GitHub App installation:", error);
        toast.error(t("pages.integration.github.integration.error"));
      });
    } else {
      // No GitHub App address: GitHub is not set up on this instance.
      toast.error(<IntegrationNotConfiguredMessage provider="github" />);
    }
  };

  const handleConnectGitlab = async () => {
    if (effectiveGitlabLinked) return;
    try {
      const { installUrl } = await generateGitlabInstallUrl(organizationId);
      rememberIntegrationReturn(product, "gitlab");
      window.location.href = installUrl;
    } catch (error) {
      console.error("Error generating GitLab install URL:", error);
      const notConfigured = integrationNotConfiguredOf(error);
      if (notConfigured) toast.error(<IntegrationNotConfiguredMessage provider={notConfigured} />);
    }
  };

  const stepTitles: string[] = useMemo(
    () => coreStepsFor(createMode, { securityContext: asksSecurityContext }).map((step) => t(step.titleKey)),
    [createMode, asksSecurityContext, t],
  );

  const renderStepContent = () => {
    if (createMode === "manual") {
      // manual step 1 = basics, step 2 = security context
      if (step === 1) {
        return (
          <StepProjectBasics
            projectName={projectName}
            onProjectNameChange={handleProjectNameChange}
            teams={teams}
            selectedTeamId={selectedTeamId}
            onTeamChange={setSelectedTeamId}
            errors={errors}
            teamDropdownRef={teamDropdownRef}
            zinc={zinc}
          />
        );
      }
      return (
        <StepSecurityContext
          value={securityContext}
          onChange={setSecurityContext}
        />
      );
    }
    // github / gitlab: step 1 = repo, step 2 = basics, step 3 = context
    if (step === 1) {
      const isGithub = createMode === "github";
      return (
        <StepRepoPicker
          source={isGithub ? "github" : "gitlab"}
          selectedRepo={selectedRepo}
          onRepoChange={setSelectedRepo}
          linked={isGithub ? effectiveGithubLinked : effectiveGitlabLinked}
          repositories={isGithub ? githubRepositories : gitlabRepositories}
          loading={
            (isGithub ? loadingGithubRepos : loadingGitlabRepos) ||
            isLoadingOverview
          }
          onConnect={isGithub ? handleConnectGithub : handleConnectGitlab}
          error={errors.source}
          zinc={zinc}
        />
      );
    }
    if (step === 2) {
      return (
        <StepProjectBasics
          projectName={projectName}
          onProjectNameChange={handleProjectNameChange}
          teams={teams}
          selectedTeamId={selectedTeamId}
          onTeamChange={setSelectedTeamId}
          errors={errors}
          teamDropdownRef={teamDropdownRef}
          zinc={zinc}
        />
      );
    }
    return (
      <StepSecurityContext
        value={securityContext}
        onChange={setSecurityContext}
      />
    );
  };

  // Once a project has been created in a space with steps after the creation,
  // the modal switches to them (tabs + stepper hidden, Later/Done footer).
  const showSuccess = createdProjectId !== null;

  // The bottom bar buttons depend on the current mode + step. We compute
  // a small descriptor for which buttons to render to keep the JSX readable.
  const isFinalStep = step === totalSteps;
  const isFirstStep = step === 1;
  // On step 1 of github/gitlab, suppress Next when the org isn't linked yet —
  // the in-step Connect CTA is the only way forward, and a Next button would
  // just produce a "repo required" error after a redirect to OAuth.
  const isOnRepoStep = createMode !== "manual" && step === 1;
  const repoStepConnectGate =
    isOnRepoStep &&
    !((createMode === "github" && effectiveGithubLinked) ||
      (createMode === "gitlab" && effectiveGitlabLinked));

  // The zinc footer: the same buttons, in the kit. One ink primary.
  const renderZincFooter = () => {
    if (writesBlocked) {
      return (
        <div className="relative group inline-flex" data-testid="create-project-blocked-wrapper">
          <VdButton variant="ink" disabled>
            {t("components.modal.createProject.createProject")}
          </VdButton>
          <div role="tooltip" className={ZINC_TOOLTIP}>
            {t('billing.trial_exhausted_create_project_disabled')}
          </div>
        </div>
      );
    }
    return (
      <>
        {!isFirstStep && (
          <VdButton variant="outline" onClick={handleBack} disabled={submitting}>
            {t("components.modal.createProject.buttons.back")}
          </VdButton>
        )}
        {!isFinalStep && !repoStepConnectGate && (
          <VdButton variant="ink" onClick={handleNext}>
            {t("components.modal.createProject.buttons.next")}
          </VdButton>
        )}
        {isFinalStep && !asksSecurityContext && (
          // Without the security context the wizard ends on the basics: one
          // button, which validates them and creates with the default context
          // (what « Skip and create » sends).
          <VdButton
            variant="ink"
            data-testid="create-project-submit"
            onClick={() => {
              if (!validateBasicsStep()) {
                // The message is written under its field: show the field.
                stepFormRef.current?.scrollIntoView?.({ block: "start" });
                return;
              }
              void submit(false);
            }}
            loading={submitting}
          >
            {t("components.modal.createProject.createProject")}
          </VdButton>
        )}
        {isFinalStep && asksSecurityContext && (
          <>
            <VdButton variant="outline" onClick={() => submit(false)} loading={submitting}>
              {t("components.modal.createProject.buttons.skipAndCreate")}
            </VdButton>
            <VdButton variant="ink" onClick={() => submit(true)} loading={submitting}>
              {t("components.modal.createProject.buttons.create")}
            </VdButton>
          </>
        )}
      </>
    );
  };

  const renderFooter = () => {
    if (zinc) return renderZincFooter();
    if (writesBlocked) {
      return (
        <div
          className="relative group inline-flex"
          data-testid="create-project-blocked-wrapper"
        >
          <Button variant="secondary" disabled onClick={() => {}}>
            {t("components.modal.createProject.createProject")}
          </Button>
          <div
            role="tooltip"
            className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
          >
            {t('billing.trial_exhausted_create_project_disabled')}
          </div>
        </div>
      );
    }

    const buttons: React.ReactNode[] = [];
    if (!isFirstStep) {
      buttons.push(
        <Button
          key="back"
          variant="white"
          onClick={handleBack}
          disabled={submitting}
        >
          {t("components.modal.createProject.buttons.back")}
        </Button>,
      );
    }
    if (!isFinalStep && !repoStepConnectGate) {
      buttons.push(
        <Button key="next" variant="secondary" onClick={handleNext}>
          {t("components.modal.createProject.buttons.next")}
        </Button>,
      );
    }
    if (isFinalStep && !asksSecurityContext) {
      // Without the security context the wizard ends on the basics: one
      // button, which validates them and creates with the default context
      // (what « Skip and create » sends).
      buttons.push(
        <Button
          key="create"
          variant="secondary"
          data-testid="create-project-submit"
          onClick={() => {
            if (!validateBasicsStep()) {
              // The message is written under its field: show the field.
              stepFormRef.current?.scrollIntoView?.({ block: "start" });
              return;
            }
            void submit(false);
          }}
          disabled={submitting}
          loading={submitting}
        >
          {t("components.modal.createProject.createProject")}
        </Button>,
      );
    } else if (isFinalStep) {
      buttons.push(
        <Button
          key="skipAndCreate"
          variant="white"
          onClick={() => submit(false)}
          disabled={submitting}
          loading={submitting}
        >
          {t("components.modal.createProject.buttons.skipAndCreate")}
        </Button>,
        <Button
          key="create"
          variant="secondary"
          onClick={() => submit(true)}
          disabled={submitting}
          loading={submitting}
        >
          {t("components.modal.createProject.buttons.create")}
        </Button>,
      );
    }
    return <>{buttons}</>;
  };

  // « Done » opens, in the space it was created in, the project that was just created.
  const handleDone = () => {
    const projectId = createdProjectId;
    handleFinish();
    if (projectId) navigate(projectPath(product, projectId));
  };

  const showImportNotice = ImportNotice !== undefined && createMode !== "manual";
  const importNotice = ImportNotice ? <ImportNotice /> : null;

  // The chosen source: the accent, and its light shade on the dark dialog. The token at 70 % was
  // about 2.4:1 there, fainter than the two sources that are not chosen.
  const sourceTabClass = (mode: CreateMode) =>
    `relative flex-shrink-0 whitespace-nowrap py-3 px-0.5 border-b-2 text-[13px] font-medium transition-colors duration-[120ms] ${AS_FOCUS_INSET} ${
      createMode === mode
        ? "border-secondary text-secondary dark:border-secondary-light dark:text-secondary-light"
        : "border-transparent text-zinc-500 hover:text-zinc-900 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:border-white/[0.2]"
    }`;

  const renderSuccessFooter = () => (
    <div className="flex gap-2">
      <VdButton variant="outline" onClick={handleFinish} data-testid={`create-project-${space.id}-later`}>
        {t("components.modal.createProject.buttons.later")}
      </VdButton>
      <VdButton variant="ink" onClick={handleDone} data-testid={`create-project-${space.id}-done`}>
        {t("components.modal.createProject.buttons.done")}
      </VdButton>
    </div>
  );

  return (
    <Modal
      title={t("components.modal.createProject.title")}
      onClose={showSuccess ? handleFinish : onClose}
      additionalRefs={[teamDropdownRef]}
      size="lg"
      // 48 px of air above and below instead of the 80vh default: at 1440 x 900 the
      // wizard ran 16 to 40 px past 80vh and scrolled for a few pixels. A short
      // window still scrolls; the phone sheet keeps its own height.
      maxHeight="calc(100vh - 6rem)"
      className={zinc ? ZINC_DIALOG : undefined}
      footerButtons={
        showSuccess ? (
          renderSuccessFooter()
        ) : zinc ? (
          <div className="flex gap-2">
            <VdButton variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </VdButton>
            {renderFooter()}
          </div>
        ) : (
          <div className="flex space-x-2">
            <Button variant="white" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            {renderFooter()}
          </div>
        )
      }
    >
      {guided && !coachDismissed && (
        <div className="mb-4">
          {/* The coach calls the last step of a source « security context »:
              it gets the source's full count, so the basics stay the basics
              in a space where that last step is never reached. */}
          <CreationCoach
            createMode={createMode}
            step={step}
            totalSteps={baseSteps}
            createdProjectId={createdProjectId}
            onDismiss={() => setCoachDismissed(true)}
          />
        </div>
      )}
      {showSuccess && createdProjectId ? (
        <>
          {afterSteps.map(({ id, Component }) => (
            <Component
              key={id}
              projectId={createdProjectId}
              organizationId={organizationId}
              source={createMode}
              onNext={handleDone}
              onBack={handleFinish}
            />
          ))}
        </>
      ) : (
        <div className="space-y-6">
        {zinc ? (
          // Scrolls sideways rather than out of the dialog: the French labels are wider than 320 px.
          <div className="overflow-x-auto overflow-y-hidden">
            <SegmentedTabs<CreateMode>
              variant="underline"
              ariaLabel={t("components.modal.createProject.title")}
              value={createMode}
              onChange={setCreateMode}
              className="min-w-max"
              options={[
                { value: "github", label: t("components.modal.createProject.githubImport") },
                { value: "gitlab", label: t("components.modal.createProject.gitlabImport") },
                { value: "manual", label: t("components.modal.createProject.manualCreation") },
              ]}
            />
          </div>
        ) : (
        <div className="border-b border-zinc-200 dark:border-as-line">
          {/* Scrolls sideways rather than out of the dialog: the three French labels are wider than 320 px. */}
          <nav className="-mb-px flex gap-4 overflow-x-auto overflow-y-hidden scrollbar-hide sm:gap-6" aria-label={t('common.tabs')}>
            <button
              onClick={() => setCreateMode("github")}
              className={sourceTabClass("github")}
            >
              {t("components.modal.createProject.githubImport")}
            </button>
            <button
              onClick={() => setCreateMode("gitlab")}
              className={sourceTabClass("gitlab")}
            >
              {t("components.modal.createProject.gitlabImport")}
            </button>
            <button
              onClick={() => setCreateMode("manual")}
              className={sourceTabClass("manual")}
            >
              {t("components.modal.createProject.manualCreation")}
            </button>
          </nav>
        </div>
        )}

        <div>
          <StepIndicator
            current={step}
            total={totalSteps}
            titles={stepTitles}
            variant={zinc ? "zinc" : undefined}
          />
          {/* A space's import notice: importing a repository starts an analysis — said, with what
              it is charged, before it is spent. On the step whose button sends the import it comes
              first: under the form it sat below the fold of the dialog at every window height,
              while « Create » stayed in reach in the footer. */}
          {showImportNotice && isFinalStep && <div className="mb-5">{importNotice}</div>}
          <div ref={stepFormRef}>{renderStepContent()}</div>
          {/* While the repository is being chosen nothing is sent yet: the list comes first. */}
          {showImportNotice && !isFinalStep && <div className="mt-5">{importNotice}</div>}
        </div>
        </div>
      )}
    </Modal>
  );
};

export default CreateProjectModal;

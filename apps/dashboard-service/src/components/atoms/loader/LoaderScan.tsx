import React from "react";

import { ScanResponseDto } from "../../../server/interfaces/Scan";
import { getScanErrorDetail, getScanErrorI18nKey } from "../../../utils/function/scanErrorMessage";
import { AlertTriangle, Ban, RefreshCw, Times, XCircle } from '@/components/atoms/icon/icons';
import { useTranslation } from "react-i18next";
import { resolveAgentActionLabelKey } from "./loaderScanLogic";
import SpinnerArc from "./SpinnerArc";
import { AS_FOCUS, AS_SECTION_TITLE, AS_TOUCH, AS_TOUCH_SQUARE } from "@/components/atoms/appsec/styles";
import { useMotionAllowed } from "@/components/molecules/kit/motion/useMotionAllowed";
import { cn } from "@/utils/function/utils";

/*
 * The scan loader in the loaders' family: the hairline arc
 * for activity, the steps as plain words over 2 px segments, a thin progress
 * ring, words in the UI font. No ping, no pulse, no bounce, no gradient, no
 * shadow, no filled circle, no dot, no separator. Props and logic unchanged.
 */

/** The backdrop. */
const OVERLAY = "fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/50";
/** The dialog card: hairline, 12 px corners, the surface layer in dark; no shadow. */
const CARD = "rounded-xl border border-zinc-200 bg-white p-6 dark:border-as-line-strong dark:bg-as-surface w-11/12 max-w-md relative animate-fade-in";
/** The glyph of a terminal state: 28 px, in the state's colour, still. */
const STATE_GLYPH = "mb-4 h-7 w-7";
/** The steps grid, by number of steps. */
const STEP_COLUMNS: Record<number, string> = { 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" };
/** The progress ring: a 2 px hairline on a 176 px box. */
const RING_BOX = 176;
/** The current step's segment sweeps slowly while motion is allowed. */
const SWEEP_CSS = "@keyframes ls-sweep{from{transform:translateX(-100%)}to{transform:translateX(250%)}}.ls-sweep{animation:ls-sweep 1.8s cubic-bezier(.45,0,.55,1) infinite}";
/** The close control, 16 px inside the card's corner: 32 px, a 44 px reach on a phone. */
const CLOSE = cn("absolute right-4 top-4 rounded-md p-2 transition-colors duration-[120ms] hover:bg-zinc-100 dark:hover:bg-white/[0.06]", AS_FOCUS, AS_TOUCH_SQUARE);
/** A dialog title. */
const TITLE = cn(AS_SECTION_TITLE, "mb-4");
/** A 32 px action, with a 44 px reach on a phone. */
const ACTION = cn("relative inline-flex h-8 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors duration-[120ms]", AS_FOCUS, AS_TOUCH);

interface LoaderProps {
  scanData: ScanResponseDto | null;
  vulnCount: number;
  showPulse: boolean;
  onClose: () => void;
  onRetry?: () => void;
  uploadProgress?: number; // Upload progress
  isUploading?: boolean;   // Whether a file is uploading
  isContainerScan?: boolean; // Whether this is a container scan
  isGithubScan?: boolean; // Whether this is a GitHub scan
  isGitlabScan?: boolean; // Whether this is a GitLab scan
  onCancel?: () => void;  // Callback to cancel a scan in waiting_for_file or queued state
  // Agentic scanner UI (optional)
  agentPhase?: string;
  agentAction?: string;
  agentMessage?: string;
  agentProgress?: number;
}

const LoaderScan: React.FC<LoaderProps> = ({
  scanData,
  vulnCount,
  showPulse,
  onClose,
  onRetry,
  uploadProgress = 0,
  isUploading = false,
  isContainerScan = false,
  isGithubScan = false,
  isGitlabScan = false,
  onCancel,
  agentPhase,
  agentAction,
  agentMessage,
  agentProgress,
}) => {
  const { t } = useTranslation();
  const animate = useMotionAllowed();
  const dismissLabel = t("components.loaderScan.buttonDismiss");

  // Determine which progress to show: upload or scan
  const isShowingUploadProgress = isUploading;
  const progressPercentage = isShowingUploadProgress
    ? uploadProgress
    : (typeof agentProgress === 'number' ? agentProgress : (scanData?.progress || 0));

  const radius = RING_BOX / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progressPercentage / 100) * circumference;

  // Mapping states to user-friendly text
  const getScanStateText = () => {
    if (isUploading) {
      return t("components.loaderScan.steps.stateUploading");
    }

    if (!scanData) return t("components.loaderScan.stateInitializing");

    // If agent is still progressing, force an in-progress state even if backend scan state is completed
    const agentInProgress = typeof agentProgress === 'number' && agentProgress < 100;
    const state = scanData.state;
    if (agentInProgress && (state === 'completed' || state === 'completed_degraded')) {
      return t("components.loaderScan.stateRunning");
    }

    switch (state) {
      case "completed":
        return t("components.loaderScan.stateCompleted");
      case "failed":
        return t("components.loaderScan.stateFailed");
      case "completed_degraded":
        return t("components.loaderScan.stateDegraded");
      case "queued":
        return t("components.loaderScan.stateQueued");
      case "waiting_for_file":
        return t("components.loaderScan.stateWaitingForFile");
      case "running":
        return t("components.loaderScan.stateRunning");
      case "cancelled":
        return t("components.loaderScan.stateCancelled");
      default:
        return t("components.loaderScan.stateInProgress");
    }
  };

  // Determine current step based on the real process: File Upload → File Preparation → Scanning
  const getCurrentStep = () => {
    // Container scans skip the file steps
    if (isContainerScan) {
      // No scanData while the loader shows: "initializing" (waiting for the API)
      if (!scanData) return 0; // Show the "Scanning" step while waiting

      const agentInProgress = typeof agentProgress === 'number' && agentProgress < 100;
      const state = scanData.state;
      if (agentInProgress && (state === 'completed' || state === 'completed_degraded')) {
        return 0; // keep in scanning while agent works
      }

      switch (state) {
        case "initializing":
        case "queued":
        case "running":
          return 0; // Scanning (first container step)
        case "completed":
        case "completed_degraded":
          return 1; // Completed (second container step)
        default:
          return 0; // Default: show scanning
      }
    }

    // GitHub and GitLab scans skip the upload step
    if (isGithubScan || isGitlabScan) {
      if (!scanData) return -1;

      switch (scanData.state) {
        case "initializing":
          return 1; // File Preparation (first GitHub/GitLab step)
        case "waiting_for_file":
          return 1; // File Preparation
        case "queued":
        case "running":
          return 2; // Scanning
        case "completed":
        case "completed_degraded":
          return 3; // Completed
        default:
          return -1;
      }
    }

    // Other scans (with an upload)
    if (isUploading) {
      return 0; // File Upload step during uploading
    }

    if (!scanData) return -1; // No step active when no scan data

    const agentInProgress = typeof agentProgress === 'number' && agentProgress < 100;
    const state = scanData.state;
    if (agentInProgress && (state === 'completed' || state === 'completed_degraded')) {
      return 2; // keep in scanning while agent works
    }

    switch (state) {
      case "waiting_for_file":
        return 1; // File Preparation
      case "queued":
      case "running":
        return 2; // Scanning (includes queued state)
      case "completed":
      case "completed_degraded":
        return 3; // Completed
      default:
        return -1; // No step active for other states
    }
  };

  const scanStateText = getScanStateText();
  const currentStep = getCurrentStep();
  const stepText = scanData?.step || t("components.loaderScan.stepWaiting");
  const stateText = scanData?.state || t("components.loaderScan.stateInitializing");

  // Harmonize agent action labels -> avoid exposing raw 'in_progress'.
  // 'done'/'decided' are gated on the overall scan state so an agent sub-phase
  // finishing (e.g. "parsing completed") never reads as "Scan Completed" while
  // the scan itself is still running.
  const agentActionText = React.useMemo(() => {
    if (!agentAction) return undefined;
    const labelKey = resolveAgentActionLabelKey(agentAction, scanData?.state);
    return labelKey ? t(labelKey) : agentAction; // unknown action -> raw fallback
  }, [agentAction, scanData?.state, t]);

  // Steps configuration - reflecting the real process
  const steps = isContainerScan ? [
    // Simplified steps for container scans
    {
      label: t("components.loaderScan.steps.scanning"),
      isActive: currentStep === 0,
      isCompleted: currentStep > 0
    },
    {
      label: t("components.loaderScan.steps.completed"),
      isActive: currentStep === 1,
      isCompleted: currentStep >= 1
    }
  ] : isGithubScan || isGitlabScan ? [
    // Steps for GitHub and GitLab scans (no upload)
    {
      label: t("components.loaderScan.steps.filePreparation"),
      isActive: currentStep === 1,
      isCompleted: currentStep > 1
    },
    {
      label: t("components.loaderScan.steps.scanning"),
      isActive: currentStep === 2,
      isCompleted: currentStep > 2
    },
    {
      label: t("components.loaderScan.steps.completed"),
      isActive: currentStep === 3,
      isCompleted: currentStep >= 3
    }
  ] : [
    // Full steps for scans with a file upload
    {
      label: t("components.loaderScan.steps.fileUpload"),
      isActive: currentStep === 0 && isUploading,
      isCompleted: currentStep > 0 || (!isUploading && scanData)
    },
    {
      label: t("components.loaderScan.steps.filePreparation"),
      isActive: currentStep === 1,
      isCompleted: currentStep > 1
    },
    {
      label: t("components.loaderScan.steps.scanning"),
      isActive: currentStep === 2,
      isCompleted: currentStep > 2
    },
    {
      label: t("components.loaderScan.steps.completed"),
      isActive: currentStep === 3,
      isCompleted: currentStep >= 3
    }
  ];

  // Step indicator: each step is its word over a 2 px segment. The current
  // word is in ink, a done one quieter, an upcoming one quieter still; a done
  // segment is in the accent, the current one carries a slow sweep.
  // Called as a function, not mounted as a component: a component defined in
  // render would remount on every progress update and restart the sweep.
  const renderSteps = () => (
    <ol className={cn("mb-8 grid gap-3", STEP_COLUMNS[steps.length])}>
      {steps.map((step, index) => {
        const isActive = step.isActive;
        const isCompleted = Boolean(step.isCompleted);

        return (
          <li key={index} aria-current={isActive ? "step" : undefined} className="flex min-w-0 flex-col justify-end">
            <span
              className={cn(
                "text-xs leading-4 transition-colors duration-[120ms]",
                isActive
                  ? "font-medium text-zinc-900 dark:text-zinc-100"
                  : isCompleted
                    ? "text-zinc-600 dark:text-zinc-400"
                    : "text-zinc-500 dark:text-zinc-450"
              )}
            >
              {step.label}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative mt-2 block h-0.5 overflow-hidden rounded-full",
                isCompleted ? "bg-secondary" : "bg-zinc-200 dark:bg-white/[0.08]"
              )}
            >
              {isActive && !isCompleted && (
                <span className={cn("absolute inset-y-0 left-0 w-2/5 rounded-full bg-secondary", animate && "ls-sweep")} />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );

  // While a NEW scan's file is uploading (isUploading), the loader must show
  // upload progress — never a terminal modal. After cancel→relaunch the old
  // scan's poller/SSE can briefly re-apply `scanData.state === 'cancelled'`
  // (or 'failed'/'completed_degraded') mid-upload; rendering those here used to
  // surface a stale "cancelled" modal titled with the upload label ("Download")
  // that then froze. Gating on `!isUploading` keeps the active
  // upload authoritative.
  if (!isUploading && scanData?.state === "cancelled") {
    return (
      <div className={OVERLAY}>
        <div className={CARD}>
          <button className={CLOSE} onClick={onClose} aria-label={dismissLabel}>
            <Times className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          </button>
          <div className="flex flex-col items-center pt-2 text-center">
            <Ban className={cn(STATE_GLYPH, "text-zinc-500 dark:text-zinc-400")} />
            <h2 className={TITLE}>
              {scanStateText}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {t("components.loaderScan.messageCancelled")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isUploading && scanData?.state === "failed") {
    const errorDetail = getScanErrorDetail(scanData.errorCode, scanData.errorCategory, scanData.errorMessage);
    return (
      <div className={OVERLAY}>
        <div className={CARD}>
          <button className={CLOSE} onClick={onClose} aria-label={dismissLabel}>
            <Times className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          </button>
          <div className="flex flex-col items-center pt-2 text-center">
            <XCircle className={cn(STATE_GLYPH, "text-red-600 dark:text-red-400")} />
            <h2 className={TITLE}>
              {scanStateText}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
              {t(getScanErrorI18nKey(scanData.errorCode, scanData.errorCategory, scanData.errorMessage))}
            </p>
            {/* A plan refusal, or an import failure, is said in words above; its raw code is not a detail. */}
            {errorDetail ? (
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-6">
                {errorDetail}
              </p>
            ) : (
              <div className="mb-6" />
            )}

            {onRetry && (
              <button
                onClick={onRetry}
                // The card's primary action: ink in light, white in dark; red stays on the failure icon.
                className={cn(ACTION, "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200")}
              >
                <RefreshCw className="h-4 w-4" />
                {t("components.loaderScan.buttonRetry")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!isUploading && scanData?.state === "completed_degraded") {
    return (
      <div className={OVERLAY}>
        <div className={CARD}>
          <button className={CLOSE} onClick={onClose} aria-label={dismissLabel}>
            <Times className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
          </button>
          <div className="flex flex-col items-center pt-2 text-center">
            <AlertTriangle className={cn(STATE_GLYPH, "text-medium-risk")} />
            <h2 className={TITLE}>
              {scanStateText}
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">
              {t("components.loaderScan.messageDegraded")}
            </p>
            {scanData.errorMessage && (
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-6">
                {scanData.errorMessage}
              </p>
            )}
            {!scanData.errorMessage && <div className="mb-6" />}
          </div>
        </div>
      </div>
    );
  }

  /** The activity of a step without a figure: the hairline arc, its name, its state. */
  const renderActivity = (label: string, detail: string, slow = false) => (
    <div className="flex h-44 flex-col items-center justify-center text-center">
      <SpinnerArc size="xl" aria-hidden="true" className="text-secondary" style={slow ? { animationDuration: "2.4s" } : undefined} />
      <span className="mt-5 text-[15px] font-medium leading-5 text-zinc-900 dark:text-zinc-100">{label}</span>
      <span className="mt-1 text-[13px] leading-[18px] text-zinc-500 dark:text-zinc-400">{detail}</span>
    </div>
  );

  return (
    <div className={OVERLAY}>
      {animate && <style>{SWEEP_CSS}</style>}
      <div className={CARD}>
        <button className={CLOSE} onClick={onClose} aria-label={dismissLabel}>
          <Times className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
        </button>

        {/* Title, and what the agent is doing */}
        <div className="mb-6 pr-8">
          <h2 className={AS_SECTION_TITLE}>
            {t("components.loaderScan.title")}
          </h2>
          {agentMessage ? (
            <div className="mt-1.5 flex items-center">
              {/* The label as a word, then the message, set apart by space
                  alone: no dot, no separator, no dash. */}
              <span className="inline-flex min-w-0 max-w-full items-center gap-x-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
                <span className="shrink-0 font-medium text-secondary dark:text-zinc-100">{t("components.loaderScan.agentLabel")}</span>
                <span className="min-w-0 truncate">{agentMessage}</span>
              </span>
            </div>
          ) : null}
        </div>

        {renderSteps()}

        <div className="mb-6 flex justify-center">
          {(currentStep === 1 && !isContainerScan) ? (
            renderActivity(t("components.loaderScan.steps.filePreparation"), getScanStateText())
          ) : ((currentStep === 2 && !isContainerScan) || (currentStep === 0 && isContainerScan)) && scanData?.state === "queued" ? (
            renderActivity(t("components.loaderScan.steps.scanning"), t("components.loaderScan.stateWaitingInQueue"), true)
          ) : (
            // A thin ring for the steps with a figure (upload, scan running, completed)
            <div className="relative h-44 w-44">
              <svg viewBox={`0 0 ${RING_BOX} ${RING_BOX}`} className="h-full w-full -rotate-90" aria-hidden="true">
                <circle
                  className="text-zinc-200 dark:text-white/[0.08]"
                  strokeWidth="2"
                  stroke="currentColor"
                  fill="none"
                  r={radius}
                  cx={RING_BOX / 2}
                  cy={RING_BOX / 2}
                />
                {progressPercentage > 0 && (
                  <circle
                    className="text-secondary transition-[stroke-dashoffset] duration-700 ease-in-out"
                    strokeWidth="2"
                    strokeLinecap="round"
                    stroke="currentColor"
                    fill="none"
                    r={radius}
                    cx={RING_BOX / 2}
                    cy={RING_BOX / 2}
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                  />
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span className="text-[32px] font-medium leading-none tabular-nums tracking-[-0.03em] text-zinc-900 dark:text-zinc-50">
                  {progressPercentage}%
                </span>
                <span className="mt-2 text-[13px] leading-[18px] text-zinc-500 dark:text-zinc-400">
                  {isUploading
                    ? t("components.loaderScan.steps.stateUploading")
                    : (agentActionText || getScanStateText())
                  }
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Findings so far: the count in ink, in the accent for a moment when a new one lands */}
        <div className="flex items-baseline justify-between border-t border-zinc-200 pt-4 dark:border-as-line">
          <span className="text-[13px] text-zinc-500 dark:text-zinc-400">
            {t("components.loaderScan.vulnerabilitiesDetected")}
          </span>
          <span
            className={cn(
              "text-xl font-medium tabular-nums transition-colors duration-300",
              showPulse
                ? "text-secondary"
                : vulnCount > 0
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 dark:text-zinc-450"
            )}
          >
            {vulnCount}
          </span>
        </div>

        {/* Cancel button - shown only for cancellable states */}
        {onCancel && scanData && (scanData.state === 'waiting_for_file' || scanData.state === 'queued') && (
          <div className="flex justify-center mt-4">
            <button
              onClick={onCancel}
              className={cn(ACTION, "border border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50 dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:bg-white/[0.09]")}
            >
              <Ban className="h-4 w-4" />
              {t("components.loaderScan.buttonCancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoaderScan;
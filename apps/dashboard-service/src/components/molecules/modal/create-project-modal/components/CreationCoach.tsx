import React from 'react';
import { useTranslation } from 'react-i18next';
import { CybeAvatar } from '@/components/atoms/cybe-avatar/CybeAvatar';
import Callout from '@/components/molecules/callout/Callout';

export type CreationCoachMode = 'manual' | 'github' | 'gitlab' | null;

/**
 * The distinct phases the in-modal coach guides the user through. Each phase
 * maps 1:1 to a translated message. `intro` is the "no mode chosen yet / on the
 * mode tabs" phase — it is reachable when `createMode` is null (the modal keeps
 * a hard default of `github`, so in practice the coach opens on `repoPicker`,
 * but the phase logic stays complete and prop-testable).
 */
export type CreationCoachPhase =
  | 'intro'
  | 'repoPicker'
  | 'basics'
  | 'securityContext'
  | 'success';

interface DerivePhaseArgs {
  createMode: CreationCoachMode;
  step: number;
  totalSteps: number;
  createdProjectId: string | null;
}

/**
 * Pure phase derivation from the wizard's own state. Order matters:
 * 1. A created project always wins → `success` (the space's steps after the creation).
 * 2. No mode chosen → `intro`.
 * 3. Repo modes (github/gitlab) on step 1 → `repoPicker`.
 * 4. The final step (manual step 2 / repo step 3) → `securityContext`.
 * 5. Everything else (manual step 1 / repo step 2) → `basics`.
 */
export function deriveCoachPhase({
  createMode,
  step,
  totalSteps,
  createdProjectId,
}: DerivePhaseArgs): CreationCoachPhase {
  if (createdProjectId) return 'success';
  if (!createMode) return 'intro';
  if ((createMode === 'github' || createMode === 'gitlab') && step === 1) {
    return 'repoPicker';
  }
  if (step >= totalSteps) return 'securityContext';
  return 'basics';
}

export interface CreationCoachProps {
  createMode: CreationCoachMode;
  step: number;
  totalSteps: number;
  createdProjectId: string | null;
  /** Called when the user dismisses the coach with its close button. */
  onDismiss: () => void;
}

/**
 * A slim, dismissible, Cybe-branded accent callout pinned to the top of the
 * CreateProjectModal body. It "follows" the user through project creation:
 * the message updates as the wizard advances (mode → repo → basics → security
 * context → created). Purely presentational + props-driven; the modal owns the
 * dismissed state (this component is controlled, calling `onDismiss`).
 */
export const CreationCoach: React.FC<CreationCoachProps> = ({
  createMode,
  step,
  totalSteps,
  createdProjectId,
  onDismiss,
}) => {
  const { t } = useTranslation();

  const phase = deriveCoachPhase({
    createMode,
    step,
    totalSteps,
    createdProjectId,
  });

  const messages: Record<CreationCoachPhase, string> = {
    intro: t('components.modal.createProject.coach.intro'),
    repoPicker: t('components.modal.createProject.coach.repoPicker'),
    basics: t('components.modal.createProject.coach.basics'),
    securityContext: t('components.modal.createProject.coach.securityContext'),
    success: t('components.modal.createProject.coach.success'),
  };

  return (
    <Callout
      tone="accent"
      data-testid="creation-coach"
      data-phase={phase}
      icon={<CybeAvatar size="sm" showStatus decorative />}
      onDismiss={onDismiss}
      dismissLabel={t('components.modal.createProject.coach.dismiss')}
      dismissTestId="creation-coach-dismiss"
    >
      <p data-testid="creation-coach-message" className="leading-snug">
        {messages[phase]}
      </p>
    </Callout>
  );
};

export default CreationCoach;

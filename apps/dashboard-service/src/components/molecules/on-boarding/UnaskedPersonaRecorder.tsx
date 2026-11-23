import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { updateUserProfile } from "@/server/services/userService";
import type { AppDispatch, RootState } from "@/server/store";
import { selectIsProductChoicePending } from "@/server/store/selectors";
import { setOnboardingPersona } from "@/server/store/userSlice";

/** What « Skip » recorded when the profile was asked: the value the backend allowlist knows. */
export const UNASKED_PERSONA = "unspecified";

/**
 * The profile is still unanswered while the guided tour is not completed. The
 * AppSec tour (OnboardingStep, MobileOnboardingTour) waits for a non-null
 * profile, so the account is recorded `UNASKED_PERSONA`: with the product
 * answer the edition asks for, or on its own (`recordUnaskedPersona`) when
 * there is nothing to answer.
 */
export function arePersonaQuestionsPending(
  isOnboardingCompleted: boolean,
  onboardingPersona: string | null | undefined,
): boolean {
  return !isOnboardingCompleted && onboardingPersona == null;
}

/**
 * Tried once per page load, success or not: a failed save is tried again at
 * the next page load, never in a loop.
 */
let personaRecordedInThisPageLoad = false;

export function resetUnaskedPersonaForTests(): void {
  personaRecordedInThisPageLoad = false;
}

/**
 * Records `UNASKED_PERSONA` for an account with nothing to answer (a member,
 * an organisation already active, an edition that asks no product question),
 * so its guided tour starts. True when it was saved. Silent on failure: the
 * account did nothing it could retry.
 */
export async function recordUnaskedPersona(): Promise<boolean> {
  if (personaRecordedInThisPageLoad) return false;
  personaRecordedInThisPageLoad = true;
  try {
    await updateUserProfile(null, undefined, { onboardingPersona: UNASKED_PERSONA });
    return true;
  } catch {
    return false;
  }
}

/**
 * The shell's profile recorder when the edition asks no product question
 * (`ACTIVE_EXTENSIONS.ShellQuestions` is null): renders nothing, and records
 * the unasked profile once the profile is loaded and the account belongs to
 * an organisation. Nothing is recorded before the profile is loaded: until
 * then the profile reads null, even when it was answered.
 */
const UnaskedPersonaRecorder: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const isProfileLoaded = useSelector((state: RootState) => state.user.isProfileLoaded);
  const isOnboardingCompleted = useSelector((state: RootState) => state.user.isOnboardingCompleted);
  const onboardingPersona = useSelector((state: RootState) => state.user.onboardingPersona);
  const onboardingUsage = useSelector((state: RootState) => state.user.onboardingUsage);
  const hasOrganization = useSelector((state: RootState) => (state.user.myOrganizations?.length ?? 0) > 0);
  const organizationId = useSelector((state: RootState) => state.organization?.selectedOrganization?.id);
  const isProductChoicePending = useSelector(selectIsProductChoicePending);

  const isGateOpen = Boolean(isProfileLoaded && hasOrganization && organizationId);
  const recordAlone =
    isGateOpen && arePersonaQuestionsPending(isOnboardingCompleted === true, onboardingPersona) && !isProductChoicePending;

  useEffect(() => {
    if (!recordAlone) return;
    void recordUnaskedPersona().then((saved) => {
      // The profile turns non-null: the tour gate opens.
      if (saved) {
        dispatch(setOnboardingPersona({ onboardingPersona: UNASKED_PERSONA, onboardingUsage: onboardingUsage ?? [] }));
      }
    });
    // Decided by the gate alone; the usage is the one read when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordAlone, dispatch]);

  return null;
};

export default UnaskedPersonaRecorder;

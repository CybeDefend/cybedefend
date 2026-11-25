/**
 * How many invitations may be created over a rolling 24 hours, per
 * organisation and per inviter. Every invitation counts, whatever became of
 * it (pending, accepted, canceled or expired).
 *
 * A separate, lower limit counts the invitations an organisation CANCELED
 * over the same window: beyond it a new invitation is refused, so inviting
 * then canceling cannot send an unbounded number of invitation e-mails, nor
 * reuse the seat a pending invitation holds over and over.
 *
 * Optional tuning variables, read at each invitation:
 * INVITATIONS_PER_ORGANIZATION_PER_DAY, INVITATIONS_PER_INVITER_PER_DAY and
 * CANCELED_INVITATIONS_PER_ORGANIZATION_PER_DAY. A missing, non-numeric or
 * non-positive value falls back to the default.
 */
export const DEFAULT_INVITATIONS_PER_ORGANIZATION_PER_DAY = 300;
export const DEFAULT_INVITATIONS_PER_INVITER_PER_DAY = 100;
export const DEFAULT_CANCELED_INVITATIONS_PER_ORGANIZATION_PER_DAY = 20;

/** The window the limits count over. */
export const INVITATION_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function invitationLimits(env: NodeJS.ProcessEnv = process.env): {
  perOrganization: number;
  perInviter: number;
  canceledPerOrganization: number;
} {
  return {
    perOrganization: positiveInteger(
      env.INVITATIONS_PER_ORGANIZATION_PER_DAY,
      DEFAULT_INVITATIONS_PER_ORGANIZATION_PER_DAY,
    ),
    perInviter: positiveInteger(
      env.INVITATIONS_PER_INVITER_PER_DAY,
      DEFAULT_INVITATIONS_PER_INVITER_PER_DAY,
    ),
    canceledPerOrganization: positiveInteger(
      env.CANCELED_INVITATIONS_PER_ORGANIZATION_PER_DAY,
      DEFAULT_CANCELED_INVITATIONS_PER_ORGANIZATION_PER_DAY,
    ),
  };
}

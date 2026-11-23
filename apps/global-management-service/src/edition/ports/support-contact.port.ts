/**
 * The support contact port: who a mail tells its reader to contact when they
 * have a question or think someone else is using their account. A
 * self-hosted instance is run by its own administrator, so the community
 * edition points there and names no mailbox.
 */
export const SUPPORT_CONTACT_PORT = 'SUPPORT_CONTACT_PORT';

export interface SupportContact {
  /** The closing sentence of the welcome mail: where a question goes. */
  questionLine(): string;
  /**
   * Whom to contact, as it reads after "change your password and contact",
   * when someone else may be using the account.
   */
  compromisedAccountContact(): string;
}

/**
 * The product-links port (one copy in this service). The addresses a ticket,
 * a comment or an installation callback sends a user to when they name the
 * product itself rather than a finding: a self-hosted instance answers with
 * its own dashboard, never a vendor website.
 */
export const PRODUCT_LINKS_PORT = 'PRODUCT_LINKS_PORT';

// The Community binding reads the instance's public URL through ConfigService
// when the context has it, and from process.env otherwise. The edition module
// is global and is compiled into every Nest context, including contexts and
// tests that do not import the configuration module; a required ConfigService
// would make those fail to boot. Both sources hold the same values, since the
// configuration module reads the process environment.

export interface ProductLinksPort {
  /**
   * The address the « created by CybeDefend » line of a ticket or comment
   * links to. Undefined: the line names the product without a link.
   */
  ticketFooterUrl(): string | undefined;
  /** The address a GitHub App installation callback sends the account back to. */
  githubInstallReturnUri(): string;
}

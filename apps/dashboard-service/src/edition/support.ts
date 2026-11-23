import { activeExtensions } from './active';
import { EDITION, type Edition } from './edition';

/** The public project's issues: where a self-hosted instance's users ask for help. */
export const COMMUNITY_SUPPORT_URL = 'https://github.com/CybeDefend/cybedefend/issues';

/** The public project's security policy: how to report a vulnerability privately. */
export const SECURITY_POLICY_URL = 'https://github.com/CybeDefend/cybedefend/security/policy';

/**
 * Where « Contact support » goes: the edition's own desk when its extensions name one
 * (`supportUrl`), the public project's issues otherwise. Read at render, so every page follows
 * the edition it runs in.
 */
export function supportUrl(edition: Edition = EDITION): string {
  return activeExtensions(edition).supportUrl ?? COMMUNITY_SUPPORT_URL;
}

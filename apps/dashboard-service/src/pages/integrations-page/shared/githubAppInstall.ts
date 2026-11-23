import { createGithubInstallState } from "@/server/services/integrations/githubIntegrationsService";

/** The GitHub App installation URL carrying the given state. */
export function githubAppInstallUrl(baseUrl: string, state: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Opens the GitHub App installation in a new tab, with a single-use state
 * issued by the gateway for this organization and this user. GitHub returns
 * the state to the callback page, and the gateway refuses a callback without
 * it. The tab is opened before the state is requested, while the click still
 * counts as a user gesture, so a popup blocker does not stop it.
 */
export async function openGithubAppInstall(organizationId: string, baseUrl: string): Promise<void> {
  const tab = window.open("", "_blank");
  if (tab) {
    tab.opener = null;
  }
  try {
    const state = await createGithubInstallState(organizationId);
    const url = githubAppInstallUrl(baseUrl, state);
    if (tab) {
      tab.location.href = url;
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch (error) {
    tab?.close();
    throw error;
  }
}

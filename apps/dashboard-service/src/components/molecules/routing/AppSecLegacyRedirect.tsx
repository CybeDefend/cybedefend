import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { appsecPath, projectPath } from '@/utils/product';

interface AppSecLegacyRedirectProps {
  /**
   * `same` (the default): the same page under the AppSec prefix.
   * `project`: the AppSec overview of the matched `:projectId`, for a URL that
   * never had a page of its own (a scan link, the former Jira finding link:
   * `PROJECT_OVERVIEW_ALIASES` in `appsecRoutes.tsx`).
   */
  to?: 'same' | 'project';
}

/**
 * Sends a former AppSec URL (`/project/:id/sast`, `/reports`, …) to its
 * `/appsec` form, replacing it in the history and keeping the query string and
 * the hash. The e-mails, Slack messages, Jira and GitLab integrations,
 * pull-request comments and the CLI print the former URLs.
 *
 * The target is built from the pathname the router matched and the contract's
 * functions only, never from the query string, router state or storage.
 * Repeated slashes are folded into one: under the prefix the target can never
 * start with `//`, but a `//` inside it would read as another host to anything
 * that later strips the prefix.
 */
const AppSecLegacyRedirect: React.FC<AppSecLegacyRedirectProps> = ({ to = 'same' }) => {
  const { pathname, search, hash } = useLocation();
  const { projectId } = useParams<{ projectId: string }>();
  const target =
    to === 'project' && projectId
      ? // The router hands the id decoded: encoded again, a `/` in it stays one segment.
        projectPath('appsec', encodeURIComponent(projectId))
      : appsecPath(pathname.replace(/\/{2,}/g, '/'));
  return <Navigate replace to={{ pathname: target, search, hash }} />;
};

export default AppSecLegacyRedirect;

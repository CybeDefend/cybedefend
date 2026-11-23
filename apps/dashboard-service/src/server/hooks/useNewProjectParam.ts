import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IntegrationProvider } from '@/server/interfaces/IntegrationProvider';
import {
  NEW_PROJECT_PARAM,
  readNewProjectParam,
} from '@/pages/integrations-page/shared/integrationReturn';

/**
 * Opens the page's create-project wizard on the provider named by
 * `?newProject=github|gitlab`, which the GitHub and GitLab callbacks put on the
 * wizard's page (`integrationReturnPath`) after a connection started from it.
 *
 * `canOpen` is undefined while the page cannot tell yet (the role or the teams
 * are loading): the parameter waits. Then it is removed, the history entry
 * replaced so Back and a reload open nothing, and the wizard opens only for a
 * user who may create a project and a provider of the fixed list.
 *
 * One wizard per page reads it: the AppSec home and the page a space names
 * (`ProductSpace.newProjectPath`), never a space's shell, which is mounted on
 * those pages too.
 */
export function useNewProjectParam(
  canOpen: boolean | undefined,
  open: (source: IntegrationProvider) => void,
): void {
  const [params, setParams] = useSearchParams();
  const asked = params.has(NEW_PROJECT_PARAM);
  const source = readNewProjectParam(params);

  const latestOpen = useRef(open);
  useEffect(() => {
    latestOpen.current = open;
  });

  useEffect(() => {
    if (!asked || canOpen === undefined) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(NEW_PROJECT_PARAM);
        return next;
      },
      { replace: true },
    );
    if (canOpen && source) latestOpen.current(source);
  }, [asked, canOpen, source, setParams]);
}

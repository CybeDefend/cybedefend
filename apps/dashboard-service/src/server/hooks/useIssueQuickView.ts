import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isUuid } from "@/utils/uuid";

export interface IssueQuickViewState {
  /** Currently opened issue id (from the `?issue=` search param, when it is a UUID), or null. */
  issueId: string | null;
  /** Open the quick-view drawer for an issue (pushes a history entry). */
  openIssue: (id: string) => void;
  /** Move the open drawer to another issue (replaces the history entry, so
   * Back returns to the pre-drawer list instead of every visited issue). */
  navigateToIssue: (id: string) => void;
  /** Close the drawer, keeping every other search param intact. */
  closeIssue: () => void;
  /** Build a router `To` that opens the drawer — usable as a row link target
   * so middle-click / cmd-click keep working. */
  issueLinkTo: (id: string) => { pathname: string; search: string };
}

/**
 * Quick-view drawer state, stored in the `?issue=` search param of the
 * vulnerability list pages. URL-based so a drawer view is shareable and
 * survives refresh, while the list page underneath never unmounts.
 */
export const useIssueQuickView = (): IssueQuickViewState => {
  const location = useLocation();
  const navigate = useNavigate();

  // The id ends up in request paths: only a UUID opens the drawer, so a link
  // cannot steer a request to another route.
  const rawIssue = new URLSearchParams(location.search).get("issue");
  const issueId = isUuid(rawIssue) ? rawIssue : null;

  const buildSearch = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(location.search);
      if (id === null) params.delete("issue");
      else params.set("issue", id);
      const s = params.toString();
      return s ? `?${s}` : "";
    },
    [location.search],
  );

  const openIssue = useCallback(
    (id: string) => navigate({ pathname: location.pathname, search: buildSearch(id) }),
    [navigate, location.pathname, buildSearch],
  );

  const navigateToIssue = useCallback(
    (id: string) =>
      navigate(
        { pathname: location.pathname, search: buildSearch(id) },
        { replace: true },
      ),
    [navigate, location.pathname, buildSearch],
  );

  const closeIssue = useCallback(
    () =>
      navigate(
        { pathname: location.pathname, search: buildSearch(null) },
        { replace: true },
      ),
    [navigate, location.pathname, buildSearch],
  );

  const issueLinkTo = useCallback(
    (id: string) => ({ pathname: location.pathname, search: buildSearch(id) }),
    [location.pathname, buildSearch],
  );

  return { issueId, openIssue, navigateToIssue, closeIssue, issueLinkTo };
};

export default useIssueQuickView;

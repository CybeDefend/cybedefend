import React from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { productHome, projectPath } from "@/utils/product";

/**
 * The dedicated vulnerability page is no longer reachable — the quick-view
 * drawer replaces it. This redirect keeps every old/deep link working by
 * sending `/appsec/project/:projectId/:type/issue/:issueId` (or its former
 * form without the prefix) to the AppSec list page with the drawer open
 * (`/appsec/project/:projectId/:type?issue=:issueId`).
 *
 * Every former finding link from e-mails, Slack, pull-request comments and
 * Jira goes through this hop, so the rest of its query string (`?branch=`,
 * utm parameters, …) and its hash are kept. The path and the `issue`
 * parameter are built from the matched route's parameters only: an `issue`
 * already in the query string is replaced, never followed.
 *
 * `IssuePage` is intentionally kept in the codebase (just no longer routed) in
 * case the full page is needed again.
 */
const IssueRedirect: React.FC = () => {
  const { projectId, type, issueId } = useParams<{
    projectId: string;
    type: string;
    issueId: string;
  }>();
  const { search, hash } = useLocation();

  // An AppSec page: without a finding to open it falls back to the AppSec
  // home, not to the root, whose landing rule may pick another space.
  if (!projectId || !type || !issueId) {
    return <Navigate to={productHome("appsec")} replace />;
  }

  // `set` drops every `issue` the query string carried and encodes the id as
  // one value, so an id holding `&` or `#` cannot add a parameter or a hash.
  const query = new URLSearchParams(search);
  query.set("issue", issueId);

  // The router hands the parameters decoded: encoded again, each stays one segment.
  const pathname = projectPath("appsec", encodeURIComponent(projectId), encodeURIComponent(type));

  return <Navigate to={{ pathname, search: `?${query.toString()}`, hash }} replace />;
};

export default IssueRedirect;

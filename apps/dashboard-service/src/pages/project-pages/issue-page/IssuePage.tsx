import React from "react";
import { useParams } from "react-router-dom";
import useSmartBack from "../../../server/hooks/useSmartBack";
import { productHome, projectPath } from "@/utils/product";
import { useScrollToTop } from "@/utils/hooks/useScrollToTop";
import IssueDetailView, { IssueDetailType } from "./IssueDetailView";

/**
 * Full-page vulnerability detail. A thin shell around `IssueDetailView`: it
 * resolves the route params, manages page-level scroll + back navigation, and
 * delegates all content/actions to the shared view (which the quick-view
 * drawer also renders). Kept for deep links and "Open full details" until the
 * drawer fully replaces it.
 */
const IssuePage: React.FC = () => {
  const { projectId, issueId, type } = useParams<{
    projectId: string;
    issueId: string;
    type: IssueDetailType;
  }>();

  // History-aware back: the AppSec list page when this page is a deep link,
  // the AppSec home (not the root) when the route names no project.
  const smartBack = useSmartBack(
    projectId && type ? projectPath("appsec", projectId, type) : productHome("appsec"),
  );

  // Reset the window scroll to the top whenever we open (or switch to) a
  // vulnerability detail page, so it never inherits the list's scroll position.
  useScrollToTop(`${type}/${issueId}`);

  return (
    <IssueDetailView
      projectId={projectId || ""}
      issueId={issueId || ""}
      type={type || "sast"}
      onBack={smartBack}
    />
  );
};

export default IssuePage;

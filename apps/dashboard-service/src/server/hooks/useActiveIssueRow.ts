import { useEffect, useRef } from "react";
import useIssueQuickView from "./useIssueQuickView";

/**
 * Helper for vulnerability list tables to highlight the row currently open in
 * the quick-view drawer and keep it scrolled into view as the user steps
 * through issues (next/prev). Returns the active issue id (from the `?issue=`
 * param) plus a ref to assign to the active row.
 *
 * Usage:
 *   const { activeIssueId, activeRowRef } = useActiveIssueRow();
 *   <LinkRow ref={issue.id === activeIssueId ? activeRowRef : undefined}
 *            className={cn(..., issue.id === activeIssueId && "bg-secondary/10 …")} />
 */
export const useActiveIssueRow = () => {
  const { issueId } = useIssueQuickView();
  const activeRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (issueId && activeRowRef.current) {
      activeRowRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [issueId]);

  return { activeIssueId: issueId, activeRowRef };
};

export default useActiveIssueRow;

import { useLocation } from 'react-router-dom';

export interface ReportDeepLink {
  /** The report a `?reportId=` link names, if any. */
  reportId?: string;
  /** The router's key of this navigation: a new one on every click, even to the same URL. */
  key: string;
}

/**
 * The stored report a « View report » link points at. Read from the router,
 * never from `window.location`: the route table holds one element per page,
 * so React re-renders a page that is already on screen only when the page
 * itself reads the location. A page that read `window.location` once showed
 * nothing on a second link to it.
 */
export function useReportDeepLink(): ReportDeepLink {
  const { search, key } = useLocation();
  const reportId = new URLSearchParams(search).get('reportId') || undefined;
  return { reportId, key };
}

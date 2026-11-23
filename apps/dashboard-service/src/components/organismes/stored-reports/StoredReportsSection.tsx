import React from 'react';
import {
  useStoredReports,
  StoredReportsScope,
} from '../../../server/hooks/useStoredReports';
import StoredReportsList from './StoredReportsList';
import { ReportScopeMeta } from './ReportMetadataPopover';

interface StoredReportsSectionProps {
  scope: StoredReportsScope;
  /** From plan entitlements; banner is hidden when undefined. */
  maxStoredReports?: number;
  retentionDays?: number;
  /** Deep-link target (?reportId=…): highlight the row, notice if absent. */
  highlightReportId?: string;
  scopeMeta?: ReportScopeMeta;
}

/**
 * Self-contained stored-report table: owns its own useStoredReports
 * controller and renders the presentational list. Use this where a standalone
 * table is enough; use StoredReportsList directly when a shared controller is
 * needed (e.g. the drawer + per-card history on the report pages).
 */
const StoredReportsSection: React.FC<StoredReportsSectionProps> = ({
  scope,
  maxStoredReports,
  retentionDays,
  highlightReportId,
  scopeMeta,
}) => {
  const controller = useStoredReports(scope);
  return (
    <StoredReportsList
      controller={controller}
      maxStoredReports={maxStoredReports}
      retentionDays={retentionDays}
      highlightReportId={highlightReportId}
      scopeMeta={scopeMeta}
    />
  );
};

export default StoredReportsSection;

import React from "react";
import SeverityStack from "@/components/molecules/project-overview/posture/SeverityStack";
import { OrganizationOverviewFilters } from "@/server/interfaces/Vulnerability";
import { useOrganizationSeverityDistribution } from "@/server/hooks/useOrganizationSeverityDistribution";

interface SeverityTabProps {
  organizationId?: string;
  filters: OrganizationOverviewFilters;
}

/**
 * Lazily loads the severity distribution via its dedicated endpoint.
 * Mounted only when the Severity tab is active, so the fetch fires on tab open
 * rather than at page load. Drawn with the severity block both overview pages
 * share.
 */
const SeverityTab: React.FC<SeverityTabProps> = ({
  organizationId,
  filters,
}) => {
  const { data, loading } = useOrganizationSeverityDistribution(
    organizationId,
    filters,
  );

  if (loading) {
    return (
      <div className="animate-pulse h-64 bg-zinc-100 dark:bg-as-raised rounded-2xl" />
    );
  }

  return <SeverityStack data={data?.totalBySeverity ?? []} />;
};

export default SeverityTab;

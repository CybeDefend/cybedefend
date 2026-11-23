import React from "react";
import { useTranslation } from "react-i18next";
import OpenTrend from "@/components/molecules/project-overview/posture/OpenTrend";
import { OrganizationOverviewFilters } from "@/server/interfaces/Vulnerability";
import { useOrganizationVulnerabilitiesOverTime } from "@/server/hooks/useOrganizationVulnerabilitiesOverTime";

interface TrendsTabProps {
  organizationId?: string;
  filters: OrganizationOverviewFilters;
}

/**
 * Lazily loads the vulnerabilities-over-time trends via its dedicated
 * endpoint. Mounted only when the Trends tab is active, so the fetch fires on
 * tab open rather than at page load. Drawn with the trend both overview pages
 * share, with the period against the previous one that the same
 * answer carries.
 */
const TrendsTab: React.FC<TrendsTabProps> = ({ organizationId, filters }) => {
  const { t } = useTranslation();
  const { data, loading } = useOrganizationVulnerabilitiesOverTime(
    organizationId,
    filters,
  );

  if (loading) {
    return (
      <div className="animate-pulse h-64 bg-zinc-100 dark:bg-as-raised rounded-2xl" />
    );
  }

  return (
    <OpenTrend
      data={data?.vulnerabilitiesOverTime ?? []}
      comparison={data?.totalComparison ?? null}
      meta={t("components.projectOverview.posture.trend.organizationMeta")}
    />
  );
};

export default TrendsTab;

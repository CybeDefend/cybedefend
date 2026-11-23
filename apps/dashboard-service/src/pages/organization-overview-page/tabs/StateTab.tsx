import React from "react";
import { useTranslation } from "react-i18next";
import StateRows from "@/components/molecules/project-overview/posture/StateRows";
import { OrganizationOverviewFilters } from "@/server/interfaces/Vulnerability";
import { useOrganizationStateDistribution } from "@/server/hooks/useOrganizationStateDistribution";

interface StateTabProps {
  organizationId?: string;
  filters: OrganizationOverviewFilters;
}

/**
 * Lazily loads the state distribution via its dedicated endpoint.
 * Mounted only when the State tab is active, so the fetch fires on tab open
 * rather than at page load. Drawn with the state rows both overview pages
 * share; what each state means stays its row's tooltip, as it
 * was the chart's.
 */
const StateTab: React.FC<StateTabProps> = ({ organizationId, filters }) => {
  const { t } = useTranslation();
  const { data, loading } = useOrganizationStateDistribution(
    organizationId,
    filters,
  );

  if (loading) {
    return (
      <div className="animate-pulse h-64 bg-zinc-100 dark:bg-as-raised rounded-2xl" />
    );
  }

  return (
    <StateRows
      data={data?.totalByState ?? []}
      descriptions={{
        resolved: t("pages.organizationOverview.state.descriptions.resolved"),
        to_verify: t("pages.organizationOverview.state.descriptions.toVerify"),
        confirmed: t("pages.organizationOverview.state.descriptions.confirmed"),
        not_exploitable: t("pages.organizationOverview.state.descriptions.notExploitable"),
        proposed_not_exploitable: t("pages.organizationOverview.state.descriptions.proposedNotExploitable"),
      }}
    />
  );
};

export default StateTab;

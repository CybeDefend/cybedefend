import React from "react";
import { useSelector } from "react-redux";
import { RootState } from "@/server/store";
import { useOrganizationOverview } from "@/server/hooks/useOrganizationOverview";
import useAllOrganizationProjects from "@/server/hooks/useAllOrganizationProjects";
import OrganizationOverviewTemplate from "./OrganizationOverviewTemplate";

/**
 * OrganizationOverviewPage - Page component for organization-wide security overview
 * Fetches and displays aggregated statistics across all projects and teams.
 *
 * The aggregated stats come from the (slimmed, server-paginated) overview
 * response, but the project + branch selectors are fed from the COMPLETE org
 * project list via `useAllOrganizationProjects`. `data.projectsSummary` is
 * paginated server-side (default 50 projects per page), so deriving the
 * selectors from it would silently hide every project beyond the first page —
 * a user could not filter the overview on, or pick branches for, those
 * projects. The all-projects hook fetches once per org and stays stable across
 * overview refetches, so its loading flag is true only on the first load (no
 * skeleton flash when selecting a branch refetches the overview).
 */
const OrganizationOverviewPage: React.FC = () => {
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization,
  );

  const organizationId = selectedOrganization?.id || "";

  const {
    data,
    loading,
    error,
    refresh,
    filters,
    setFilters,
    resetFilters,
  } = useOrganizationOverview(selectedOrganization?.id);

  // Selectors are populated from the full org project list, decoupled from
  // the paginated overview payload. See the component docstring above.
  const { projects, loading: projectsLoading } =
    useAllOrganizationProjects(organizationId);

  return (
    <OrganizationOverviewTemplate
      data={data}
      loading={loading}
      error={error}
      onRefresh={refresh}
      organizationId={organizationId}
      organizationName={selectedOrganization?.name}
      filters={filters}
      onFiltersChange={setFilters}
      onResetFilters={resetFilters}
      projects={projects}
      projectsLoading={projectsLoading}
    />
  );
};

export default OrganizationOverviewPage;

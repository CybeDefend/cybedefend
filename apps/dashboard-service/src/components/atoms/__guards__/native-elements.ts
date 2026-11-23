/**
 * Files that still render native `<button>` / `<input>` / `<select>` /
 * `<textarea>` instead of the atoms in `src/components/atoms`, with the count
 * each one owes.
 *
 * This is a ratchet, not a permission list: `native-elements.test.ts` fails if
 * any count grows or a new file appears, so the design system can only gain
 * ground. Migrate a file, drop its count here; empty the list and delete both
 * files.
 *
 * Atoms are wherever a tree keeps its own `components/atoms/` folder: the
 * core's `src/components/atoms/` and the closed extension tree's own `components/atoms/`
 * (`isAtomPath`). Everywhere else, the native tag is debt.
 *
 * Baseline: 466 native elements across 159 files. The closed tree's files
 * owe theirs in that tree's own debt file, which the test adds to
 * this list (absent from the Community Edition, like the files).
 */

/**
 * True for the path of an atom file — `src/components/atoms/…`, or an ee
 * tree's own `components/atoms/…`. Accepts the path with or without
 * the leading `src/`.
 */
export function isAtomPath(file: string): boolean {
  const rel = file.startsWith('src/') ? file.slice('src/'.length) : file;
  if (rel.startsWith('components/atoms/')) return true;
  const ee = rel.match(/^ee\/(.*)$/);
  return ee !== null && /(^|\/)components\/atoms\//.test(ee[1]);
}
export const NATIVE_ELEMENT_DEBT: ReadonlyArray<readonly [string, number]> = [
  ["src/components/molecules/branch-selector/BranchSelector.tsx", 7],
  ["src/components/molecules/column-settings/ColumnSettingsPopover.tsx", 2],
  ["src/components/molecules/dropdown/avatar-dropdown/AvatarDropdown.tsx", 1],
  ["src/components/molecules/filters/ScoringSourceFilter.tsx", 1],
  ["src/components/molecules/issue/history-timeline/HistoryTimeline.tsx", 1],
  ["src/components/molecules/issue/secret-reveal-card/SecretRevealCard.tsx", 3],
  ["src/components/molecules/modal/CursorInstallModal.tsx", 1],
  ["src/components/molecules/modal/create-project-modal/CreateProjectModal.tsx", 3],
  ["src/components/molecules/modal/create-project-modal/components/StepRepoPicker.tsx", 1],
  ["src/components/molecules/onboarding-progress/OnboardingProgress.tsx", 2],
  ["src/components/molecules/option-group/OptionGroup.tsx", 1],
  ["src/components/molecules/organization-branch-selector/OrganizationBranchSelector.tsx", 4],
  ["src/components/molecules/organization-id-display/OrganizationIdDisplay.tsx", 1],
  ["src/components/molecules/pagination/Pagination.tsx", 6],
  ["src/components/molecules/project-id-actions/ProjectIdActions.tsx", 1],
  ["src/components/molecules/project/ProjectRow.tsx", 1],
  ["src/components/molecules/scoring/ScoringExploitabilityTab.tsx", 1],
  ["src/components/molecules/sidebar/bottom-sidebar/BottomSidebar.tsx", 4],
  ["src/components/molecules/sidebar/custom-tabs/CustomTabs.tsx", 2],
  ["src/components/molecules/sidebar/sidebar-content/SidebarContent.tsx", 2],
  ["src/components/molecules/slack/SlackChannelSelector.tsx", 4],
  ["src/components/molecules/team-assignment-section/TeamAssignmentSection.tsx", 1],
  ["src/components/molecules/triage-toggle/TriageToggle.tsx", 1],
  ["src/components/molecules/view-mode-toggle/ViewModeToggle.tsx", 2],
  ["src/components/molecules/wrapper/AnalyseWrapper.tsx", 3],
  ["src/components/organismes/background-tasks/BackgroundTaskRow.tsx", 1],
  ["src/components/organismes/background-tasks/BackgroundTasksHeaderButton.tsx", 1],
  ["src/components/organismes/background-tasks/BackgroundTasksPanel.tsx", 1],
  ["src/components/organismes/issue-drawer/IssueQuickViewDrawer.tsx", 4],
  ["src/components/organismes/project-settings/IssuesSettings.tsx", 1],
  ["src/components/organismes/project-settings/NotificationsSettings.tsx", 1],
  ["src/components/organismes/stored-reports/ReportMetadataPopover.tsx", 1],
  ["src/components/organismes/stored-reports/StoredReportTypeLink.tsx", 1],
  ["src/components/organismes/stored-reports/StoredReportsDrawer.tsx", 2],
  ["src/components/organismes/stored-reports/StoredReportsList.tsx", 2],
  ["src/components/organismes/stored-reports/StoredReportsTrigger.tsx", 1],
  ["src/components/organismes/table/cicd-table/ResultsCicdTable.tsx", 2],
  ["src/components/organismes/table/container-table/ResultsContainerGroupedImagesTable.tsx", 2],
  ["src/components/organismes/table/container-table/ResultsContainerTable.tsx", 2],
  ["src/components/organismes/table/grouped-cicd-table/GroupedResultsCicdTable.tsx", 1],
  ["src/components/organismes/table/grouped-container-table/GroupedResultsContainerTable.tsx", 1],
  ["src/components/organismes/table/grouped-iac-table/GroupedResultsIacTable.tsx", 1],
  ["src/components/organismes/table/grouped-sast-table/GroupedResultsSastTable.tsx", 1],
  ["src/components/organismes/table/grouped-sca-table/GroupedResultsScaTable.tsx", 1],
  ["src/components/organismes/table/grouped-secret-table/GroupedResultsSecretTable.tsx", 1],
  ["src/components/organismes/table/iac-table/ResultsIacTable.tsx", 2],
  ["src/components/organismes/table/sast-table/ResultsSastTable.tsx", 2],
  ["src/components/organismes/table/sca-table/ResultsScaTable.tsx", 2],
  ["src/components/organismes/table/secret-table/ResultsSecretTable.tsx", 2],
  ["src/pages/integrations-page/shared/ProjectIntegrationCreateProjectsPage.tsx", 1],
  ["src/pages/on-boarding-page/OnBoardingPage.tsx", 2],
  ["src/pages/organization-compliance-overview-page/components/ComplianceFilters.tsx", 8],
  ["src/pages/organization-compliance-overview-page/components/ComplianceTrendChart.tsx", 2],
  ["src/pages/organization-overview-page/OrganizationOverviewTemplate.tsx", 8],
  ["src/pages/profile-pages/pat-page/PatTable.tsx", 2],
  ["src/pages/profile-pages/pat-page/PatUsageGuide.tsx", 1],
  ["src/pages/profile-pages/templates/ProfilePageTemplate.tsx", 1],
  ["src/pages/project-pages/analyse-list-page/sca-page/ResultsScaTemplate.tsx", 1],
  ["src/pages/project-pages/issue-page/IssueContainerTemplate.tsx", 2],
  ["src/pages/project-pages/issue-page/IssueSastIacTemplate.tsx", 3],
  ["src/pages/project-pages/issue-page/IssueTabButton.tsx", 1],
  ["src/pages/project-pages/issue-page/IssueScaTemplate.tsx", 5],
  ["src/pages/project-pages/project-compliance-page/ProjectCompliancePage.tsx", 1],
  ["src/pages/project-pages/project-compliance-page/components/EffectivePolicyViewer.tsx", 3],
  ["src/pages/project-pages/project-reports-page/ProjectReportsTemplate.tsx", 1],
  ["src/pages/reports-page/ReportsPageTemplate.tsx", 16],
  ["src/pages/setting-page/settings-licenses-page/SettingsLicensesPage.tsx", 4],
  ["src/pages/setting-page/settings-policies-page/components/PolicyRuleEditor.tsx", 10],
  ["src/pages/setting-page/settings-policies-page/create-policy/CreatePolicyPage.tsx", 2],
  ["src/pages/setting-page/settings-policies-page/create-policy/components/StepBasicInfo.tsx", 3],
  ["src/pages/setting-page/settings-policies-page/create-policy/components/StepIndicator.tsx", 1],
  ["src/pages/setting-page/settings-policies-page/create-policy/components/StepReview.tsx", 1],
  ["src/pages/setting-page/settings-policies-page/create-policy/components/TargetSelectionModal.tsx", 6],
  ["src/pages/setting-page/settings-policies-page/edit-policy/EditPolicyPage.tsx", 1],
];

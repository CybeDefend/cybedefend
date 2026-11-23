// ============================================================================
// OrganizationComplianceOverviewPage - CISO Dashboard for compliance overview
// ============================================================================

import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthorization, useRebac } from 'react-rebac';
import { toast } from 'react-toastify';

import { motion } from 'framer-motion';

import { RootState } from '@/server/store';
import { useOrganizationComplianceOverview } from '@/server/hooks/useOrganizationComplianceOverview';
import { clearScannerStorage, cn } from '@/utils/function/utils';
import { productHome } from '@/utils/product';
import { organizationRolesWith } from '@/utils/data/rolePermissions';
import { useEditionEntitlements } from "@/edition/entitlements";

import { PageContainer } from '@/components/molecules/page-container';
import { PageHeader } from '@/components/molecules/page-header';
import Button from '@/components/atoms/button/Button';

import {
  ComplianceStatsCards,
  ComplianceTrendChart,
  ViolationBreakdownChart,
  ComplianceFilters,
  ProjectsComplianceTable,
} from './components';
import { ArrowLeft, ShieldHalved } from '@/components/atoms/icon/icons';
import { PROJECT_SECTION_ICONS } from '@/components/atoms/icon/projectSectionIcons';
import { AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
import { AS_NOTICE_BLOCK, AS_NOTICE_DOT_BLOCK, AS_NOTICE_TITLE, NOTICE_DOT } from '@/components/atoms/appsec/recipes';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';

/**
 * Error state component
 */
const ErrorState: React.FC<{ error: string; onRetry: () => void }> = ({
  error,
  onRetry,
}) => {
  const { t } = useTranslation();

  return (
    // A hairline notice with a red dot, not a red tile.
    <div className={cn(AS_NOTICE_BLOCK, 'flex-wrap items-center justify-between gap-3 py-3')}>
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0">
          <p className={cn(AS_NOTICE_TITLE, WORD_TONE.bad)}>{t('pages.complianceOverview.error.title')}</p>
          <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{error}</p>
        </div>
      </div>
      <Button variant="white" size="sm" onClick={onRetry}>
        {t('pages.complianceOverview.error.retry')}
      </Button>
    </div>
  );
};

/**
 * All compliant celebration component
 */
const AllCompliantState: React.FC = () => {
  const { t } = useTranslation();

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* A hairline notice with a green dot, in place of the green gradient card. */}
      <div className={AS_NOTICE_BLOCK}>
        <div>
          <p className={cn(AS_NOTICE_TITLE, WORD_TONE.good)}>{t('pages.complianceOverview.allCompliant.title')}</p>
          <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{t('pages.complianceOverview.allCompliant.description')}</p>
        </div>
      </div>
    </motion.div>
  );
};

/**
 * OrganizationComplianceOverviewPage - Main page component
 */
const OrganizationComplianceOverviewPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const user = useSelector((state: RootState) => state.user);
  const isProfileLoaded = user.isProfileLoaded;

  const { userEntities } = useRebac();
  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  // The overview is served behind `manage_policy` (gateway policy.controller,
  // GET organization/:organizationId/compliance-overview), which the schema
  // grants as « writable and (creator or administrator) »: the role AND an
  // organization whose writes are not blocked. This check only spares the
  // account a page that could not load; the gateway is the protection.
  const hasPolicyRole = useAuthorization(
    selectedOrganization?.id || '',
    'organization',
    organizationRolesWith('manage_policy')
  );
  const writesBlocked = useEditionEntitlements().writesBlocked;
  const isAuthorized = hasPolicyRole && !writesBlocked;

  const organizationId = selectedOrganization?.id || '';

  // Compliance Overview Hook
  const {
    stats,
    projects,
    violationBreakdown,
    trend,
    loading,
    error,
    total,
    currentPage,
    pageSize,
    totalPages,
    setCurrentPage,
    setPageSize,
    searchQuery,
    setSearchQuery,
    complianceStatusFilter,
    setComplianceStatusFilter,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    timeframe,
    setTimeframe,
    refresh,
  } = useOrganizationComplianceOverview({
    organizationId,
    pageSize: 10,
    // Nothing is asked for before the account is admitted.
    autoFetch: isAuthorized,
  });

  // Loading States
  const [wrapperLoading, setWrapperLoading] = useState(true);

  // Authorization Check
  useEffect(() => {
    if (isProfileLoaded && areUserEntitiesLoaded) {
      if (!isAuthorized) {
        toast.error(
          hasPolicyRole && writesBlocked
            ? t('billing.read_only_policy_disabled')
            : t('errors.authorization.notAuthorized')
        );
        // A policies page belongs to AppSec even under the settings prefix: the refused account goes to the AppSec home, not to the root the landing rule decides.
        navigate(productHome('appsec'));
      }

      if (isAuthorized && selectedOrganization) {
        setWrapperLoading(false);
      }
    }
  }, [isAuthorized, hasPolicyRole, writesBlocked, selectedOrganization, navigate, isProfileLoaded, areUserEntitiesLoaded, t]);

  useEffect(() => {
    clearScannerStorage();
  }, []);

  // Show loading overlay while checking authorization
  if (wrapperLoading) {
    return (
      <PageContainer background="default" padding="md">
        <div className="animate-pulse space-y-6">
          <div className="h-16 bg-zinc-200 dark:bg-as-raised rounded-xl" />
          <div className="grid grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-24 bg-zinc-200 dark:bg-as-raised rounded-xl" />
            ))}
          </div>
          <div className="h-[400px] bg-zinc-200 dark:bg-as-raised rounded-xl" />
        </div>
      </PageContainer>
    );
  }

  const showAllCompliant =
    !loading &&
    !error &&
    stats &&
    stats.nonCompliantProjects === 0 &&
    stats.totalProjects > 0 &&
    stats.pendingProjects === 0;

  return (
    <PageContainer background="default" padding="md">
      {/* Page Header */}
      <PageHeader
        title={t('pages.complianceOverview.title')}
        description={t('pages.complianceOverview.description')}
        // The compliance glyph of the project tabs, never the Platform shield.
        icon={React.createElement(PROJECT_SECTION_ICONS.compliance, {
          className: 'h-5 w-5 text-zinc-500 dark:text-zinc-400',
        })}
        // The title glyph keeps its box and loses its tile.
        iconBgColor="border-transparent bg-transparent"
        navigation={
          <Link
            to="/organization/settings/policies"
            className={`relative inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors ${AS_FOCUS} ${AS_TOUCH}`}
          >
            <ArrowLeft className="h-4 w-4"  />
            {t('pages.complianceOverview.backToPolicies')}
          </Link>
        }
        actions={
          <Button
            variant="white"
            to="/organization/settings/policies"
            icon={<ShieldHalved className="h-4 w-4"  />}
          >
            {t('pages.complianceOverview.managePolicies')}
          </Button>
        }
      />

      {/* Error State */}
      {error && !loading && (
        <div className="mb-6">
          <ErrorState error={error} onRetry={refresh} />
        </div>
      )}

      {/* Stats Cards */}
      <ComplianceStatsCards stats={stats} loading={loading} trend={trend} />

      {/* All Compliant Celebration */}
      {showAllCompliant && (
        <div className="mb-6">
          <AllCompliantState />
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ComplianceTrendChart
          data={trend}
          loading={loading}
          timeframe={timeframe}
          onTimeframeChange={setTimeframe}
        />
        <ViolationBreakdownChart data={violationBreakdown} loading={loading} />
      </div>

      {/* Projects Table, its search and filters in its own header */}
      <ProjectsComplianceTable
        projects={projects}
        loading={loading}
        error={error}
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
        toolbar={
          <ComplianceFilters
            className="mb-0"
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            complianceStatus={complianceStatusFilter}
            onStatusChange={setComplianceStatusFilter}
            startDate={startDate}
            onStartDateChange={setStartDate}
            endDate={endDate}
            onEndDateChange={setEndDate}
            sortBy={sortBy}
            onSortByChange={setSortBy}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
            onRefresh={refresh}
            loading={loading}
          />
        }
      />
    </PageContainer>
  );
};

export default OrganizationComplianceOverviewPage;

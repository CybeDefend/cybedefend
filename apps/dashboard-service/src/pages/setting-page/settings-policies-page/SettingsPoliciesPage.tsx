// ============================================================================
// Settings Policies Page - Main page for managing organization policies
// ============================================================================

import React, { useState, useEffect } from 'react';
import { destinationIcon } from '@/components/atoms/icon/destinationIcons';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthorization, useRebac } from 'react-rebac';
import { toast } from 'react-toastify';

import { motion } from 'framer-motion';

import { RootState } from '@/server/store';
import { usePolicies } from '@/server/hooks/usePolicies';
import { Policy, PolicyScope } from '@/server/interfaces/Policy';
import { exportPolicyYaml } from '@/server/services/policyService';
import { useEditionEntitlements } from "@/edition/entitlements";
import { clearScannerStorage, cn } from '@/utils/function/utils';
import { apiErrorKey } from '@/utils/function/apiErrorKey';
import { productHome } from '@/utils/product';
import { organizationRolesWith } from '@/utils/data/rolePermissions';

import { PageContainer } from '@/components/molecules/page-container';
import { PageHeader } from '@/components/molecules/page-header';
import Button from '@/components/atoms/button/Button';
import { FeatureGate } from '@/components/molecules/feature-gate';

import {
  PolicyList,
  PolicyFilters,
  DeletePolicyModal,
} from './components';
import { ChartPie, Plus, ShieldAlt } from '@/components/atoms/icon/icons';

import { AS_TOOLTIP } from '@/components/atoms/appsec/styles';
import { useDisabledFeatures } from "@/server/hooks/useDisabledFeatures";
const SettingsPoliciesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization
  );
  const user = useSelector((state: RootState) => state.user);
  const isProfileLoaded = user.isProfileLoaded;
  const writesBlocked = useEditionEntitlements().writesBlocked;

  const { userEntities } = useRebac();
  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  const isAuthorized = useAuthorization(
    selectedOrganization?.id || '',
    'organization',
    ['creator', 'administrator', 'manager']
  );

  // The compliance overview needs `manage_policy` (« writable and (creator or
  // administrator) »), which a manager reading this list does not hold, nor
  // anyone in an organization whose writes are blocked: the link is only
  // offered to who may open it.
  const hasPolicyRole = useAuthorization(
    selectedOrganization?.id || '',
    'organization',
    organizationRolesWith('manage_policy')
  );
  const canOpenComplianceOverview = hasPolicyRole && !writesBlocked;

  const organizationId = selectedOrganization?.id || '';
  const disabledFeatures = useDisabledFeatures();
  const isPoliciesDisabled = disabledFeatures.has('policies');

  // Policies Hook
  const {
    policies,
    loading,
    error,
    total,
    currentPage,
    pageSize,
    totalPages,
    searchQuery,
    setSearchQuery,
    scopeFilter: serverScopeFilter,
    setScopeFilter: setServerScopeFilter,
    enabledFilter,
    setEnabledFilter,
    setCurrentPage,
    remove,
    toggle,
  } = usePolicies({ organizationId, autoFetch: !isPoliciesDisabled });

  // Filters: applied by the server, so the pages and the total are those of
  // the filtered list, not of the page being looked at.
  const scopeFilter: PolicyScope | 'all' = serverScopeFilter ?? 'all';
  const statusFilter: 'all' | 'enabled' | 'disabled' =
    enabledFilter === undefined ? 'all' : enabledFilter ? 'enabled' : 'disabled';
  const handleScopeFilterChange = (next: PolicyScope | 'all') => {
    setServerScopeFilter(next === 'all' ? undefined : next);
  };
  const handleStatusFilterChange = (next: 'all' | 'enabled' | 'disabled') => {
    setEnabledFilter(next === 'all' ? undefined : next === 'enabled');
  };

  // Modal State
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<Policy | null>(null);

  // Loading States
  const [wrapperLoading, setWrapperLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Authorization Check
  useEffect(() => {
    if (isProfileLoaded && areUserEntitiesLoaded) {
      if (!isAuthorized) {
        toast.error(t('errors.authorization.notAuthorized'));
        // A policies page belongs to AppSec even under the settings prefix: the refused account goes to the AppSec home, not to the root the landing rule decides.
        navigate(productHome('appsec'));
      }

      if (isAuthorized && selectedOrganization) {
        setWrapperLoading(false);
      }
    }
  }, [isAuthorized, selectedOrganization, navigate, isProfileLoaded, areUserEntitiesLoaded, t]);

  useEffect(() => {
    clearScannerStorage();
  }, []);

  // Navigate to create policy page
  const handleCreateClick = () => {
    navigate('/organization/settings/policies/create');
  };

  const handleDeletePolicy = async () => {
    if (!selectedPolicy) return;

    setDeletingId(selectedPolicy.id);
    try {
      await remove(selectedPolicy.id);
      toast.success(t('pages.policies.messages.deleteSuccess'));
      setShowDeleteModal(false);
      setSelectedPolicy(null);
    } catch (err: any) {
      toast.error(t(apiErrorKey(err, { fallback: 'errors.generic.operationFailed' })));
    } finally {
      setDeletingId(null);
    }
  };

  const handleExportYaml = async (policy: Policy) => {
    setExportingId(policy.id);
    try {
      const response = await exportPolicyYaml(organizationId, policy.id);
      
      // Create and download file
      const blob = new Blob([response.yamlContent], { type: 'text/yaml' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Use policy.name from the passed policy object
      const fileName = policy.name.replace(/\s+/g, '-').toLowerCase();
      a.download = `${fileName}.yaml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(t('pages.policies.messages.exportSuccess'));
    } catch (err: any) {
      toast.error(t(apiErrorKey(err, { fallback: 'errors.generic.operationFailed' })));
    } finally {
      setExportingId(null);
    }
  };

  const handleToggleEnabled = async (policy: Policy) => {
    try {
      await toggle(policy.id, !policy.isEnabled);
      toast.success(
        policy.isEnabled
          ? t('pages.policies.messages.disabledSuccess')
          : t('pages.policies.messages.enabledSuccess')
      );
    } catch (err: any) {
      toast.error(t(apiErrorKey(err, { fallback: 'errors.generic.operationFailed' })));
    }
  };

  const handleEditClick = (policy: Policy) => {
    navigate(`/organization/settings/policies/${policy.id}/edit`);
  };

  const handleDeleteClick = (policy: Policy) => {
    setSelectedPolicy(policy);
    setShowDeleteModal(true);
  };

  if (wrapperLoading) {
    return (
      <PageContainer background="default" padding="md">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-secondary" />
        </div>
      </PageContainer>
    );
  }

  return (
    <FeatureGate feature="policies" preview featureLabel="Security Policies" requiredPlan="team_v3">
    <PageContainer background="default" padding="md">
      {/* Page Header */}
      <PageHeader
        title={t('pages.policies.title')}
        description={t('pages.policies.description')}
        icon={React.createElement(destinationIcon('/organization/settings/policies'), {
          className: 'h-6 w-6 text-zinc-500 dark:text-zinc-400',
        })}
        iconBgColor="border-transparent bg-transparent"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canOpenComplianceOverview && (
            <motion.div>
              <Button
                variant="white"
                icon={<ChartPie className="h-4 w-4"  />}
                to="/organization/settings/policies/overview"
              >
                {t('pages.policies.complianceOverview')}
              </Button>
            </motion.div>
            )}
            {/* Hidden while the list is empty: the empty state below already
                offers this exact action, and two identical primary buttons on
                one screen is a choice the user does not have. */}
            {policies.length > 0 && (
            <motion.div>
              {writesBlocked ? (
                <div
                  className="relative group inline-flex"
                  data-testid="create-policy-blocked-wrapper"
                >
                  <Button
                    variant="secondary"
                    icon={<Plus className="h-4 w-4"  />}
                    disabled
                    onClick={() => {}}
                  >
                    {t('pages.policies.addPolicy')}
                  </Button>
                  <div
                    role="tooltip"
                    className={cn(AS_TOOLTIP, "absolute right-0 top-full mt-2 w-72 px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50")}
                  >
                    {t('billing.read_only_policy_disabled')}
                  </div>
                </div>
              ) : (
                <Button
                  variant="secondary"
                  icon={<Plus className="h-4 w-4"  />}
                  onClick={handleCreateClick}
                >
                  {t('pages.policies.addPolicy')}
                </Button>
              )}
            </motion.div>
            )}
          </div>
        }
      />

      {/* Policies List, its filters at the top of its panel */}
      <PolicyList
        toolbar={
          <PolicyFilters
            bare
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            scopeFilter={scopeFilter}
            onScopeChange={handleScopeFilterChange}
            statusFilter={statusFilter}
            onStatusChange={handleStatusFilterChange}
          />
        }
        policies={policies}
        loading={loading}
        error={error}
        onEdit={handleEditClick}
        onDelete={handleDeleteClick}
        onExport={handleExportYaml}
        onToggleEnabled={handleToggleEnabled}
        exportingId={exportingId}
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onCreateClick={handleCreateClick}
      />

      {/* Delete Policy Modal */}
      {showDeleteModal && selectedPolicy && (
        <DeletePolicyModal
          policy={selectedPolicy}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedPolicy(null);
          }}
          onConfirm={handleDeletePolicy}
          isLoading={deletingId === selectedPolicy.id}
        />
      )}
    </PageContainer>
    </FeatureGate>
  );
};

export default SettingsPoliciesPage;

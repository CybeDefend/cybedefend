import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';
import { useAuthorization, useRebac } from 'react-rebac';

import { RootState } from '../../../server/store';
import {
  fetchLicenseClassifications,
  updateLicenseClassifications,
  resetLicenseClassifications,
  deleteLicenseOverride,
  LicenseClassificationItem,
} from '../../../server/services/licenseService';
import Select from '../../../components/atoms/select/Select';
import Card from '../../../components/atoms/card/Card';
import Button from '../../../components/atoms/button/Button';
import Modal from '../../../components/atoms/modal/Modal';
import { Skeleton } from '../../../components/atoms/skeleton/Skeleton';
import Badge from '../../../components/atoms/badge/Badge';
import { clearScannerStorage } from '../../../utils/function/utils';
import { ArrowLeft, Plus } from '@/components/atoms/icon/icons';

import { AS_FOCUS, AS_TOUCH, AS_SECTION_TITLE, AS_FIELD, AS_FIELD_FOCUS, AS_THEAD, AS_TH, AS_TR, AS_TD } from '@/components/atoms/appsec/styles';
import { AS_STATUS_WORD } from '@/components/atoms/appsec/recipes';
import { cn } from '@/utils/function/utils';
import { WORD_TONE } from '@/components/molecules/card/kpi/wordTone';
const CATEGORIES = ['PERMISSIVE', 'WEAK_COPYLEFT', 'STRONG_COPYLEFT', 'UNKNOWN'] as const;

const CATEGORY_LABELS: Record<string, { en: string; fr: string }> = {
  PERMISSIVE: { en: 'Permissive', fr: 'Permissive' },
  WEAK_COPYLEFT: { en: 'Weak Copyleft', fr: 'Copyleft faible' },
  STRONG_COPYLEFT: { en: 'Strong Copyleft', fr: 'Copyleft fort' },
  UNKNOWN: { en: 'Unknown', fr: 'Inconnue' },
};

/** The licence category written in its own colour (no dot). */
const CATEGORY_TONE: Record<string, string> = {
  PERMISSIVE: WORD_TONE.good,
  WEAK_COPYLEFT: WORD_TONE.warning,
  STRONG_COPYLEFT: WORD_TONE.bad,
  UNKNOWN: WORD_TONE.neutral,
};

const SettingsLicensesPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization,
  );
  const user = useSelector((state: RootState) => state.user);
  const isProfileLoaded = user.isProfileLoaded;
  const { userEntities } = useRebac();
  const areUserEntitiesLoaded = userEntities && userEntities.length > 0;

  const isAuthorized = useAuthorization(
    selectedOrganization?.id || '',
    'organization',
    ['creator', 'administrator', 'manager'],
  );

  const organizationId = selectedOrganization?.id || '';

  const [licenses, setLicenses] = useState<LicenseClassificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [deletingLicenseId, setDeletingLicenseId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSpdxId, setNewSpdxId] = useState('');
  const [newCategory, setNewCategory] = useState<string>('UNKNOWN');
  const [addingLicense, setAddingLicense] = useState(false);
  const savingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (isProfileLoaded && areUserEntitiesLoaded) {
      if (!isAuthorized) {
        toast.error(t('errors.authorization.notAuthorized'));
        navigate('/');
      }
    }
  }, [isAuthorized, selectedOrganization, navigate, isProfileLoaded, areUserEntitiesLoaded, t]);

  useEffect(() => {
    clearScannerStorage();
  }, []);

  const loadLicenses = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const data = await fetchLicenseClassifications(organizationId);
      setLicenses(data.licenses || []);
    } catch {
      toast.error(t('pages.settingsLicenses.toast.loadError'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, t]);

  useEffect(() => {
    if (organizationId) {
      loadLicenses();
    }
  }, [organizationId, loadLicenses]);

  const handleCategoryChange = async (spdxId: string, newCat: string) => {
    if (!organizationId) return;
    const license = licenses.find((l) => l.spdxId === spdxId);
    if (!license || newCat === license.currentCategory) return;
    if (savingRef.current.has(spdxId)) return;

    // Optimistic update
    setLicenses((prev) =>
      prev.map((l) =>
        l.spdxId === spdxId
          ? { ...l, currentCategory: newCat, isOverridden: true }
          : l,
      ),
    );

    savingRef.current.add(spdxId);
    try {
      await updateLicenseClassifications(organizationId, [{ spdxId, category: newCat }]);
    } catch {
      // Revert on error
      setLicenses((prev) =>
        prev.map((l) =>
          l.spdxId === spdxId
            ? { ...l, currentCategory: license.currentCategory, isOverridden: license.isOverridden }
            : l,
        ),
      );
      toast.error(t('pages.settingsLicenses.toast.saveError'));
    } finally {
      savingRef.current.delete(spdxId);
    }
  };

  const handleResetAll = async () => {
    if (!organizationId) return;
    try {
      await resetLicenseClassifications(organizationId);
      toast.success(t('pages.settingsLicenses.toast.resetSuccess'));
      await loadLicenses();
    } catch {
      toast.error(t('pages.settingsLicenses.toast.resetError'));
    }
  };

  const handleAddCustomLicense = async () => {
    const spdxId = newSpdxId.trim();
    if (!spdxId || !organizationId) return;
    if (licenses.some((l) => l.spdxId.toLowerCase() === spdxId.toLowerCase())) {
      toast.error(t('pages.settingsLicenses.toast.alreadyExists'));
      return;
    }
    setAddingLicense(true);
    try {
      await updateLicenseClassifications(organizationId, [{ spdxId, category: newCategory }]);
      toast.success(t('pages.settingsLicenses.toast.saveSuccess'));
      setNewSpdxId('');
      setNewCategory('UNKNOWN');
      setShowAddModal(false);
      await loadLicenses();
    } catch {
      toast.error(t('pages.settingsLicenses.toast.saveError'));
    } finally {
      setAddingLicense(false);
    }
  };

  const handleDeleteCustomLicense = async (spdxId: string) => {
    const license = licenses.find((l) => l.spdxId === spdxId);
    if (!license?.isOverridden) {
      setLicenses((prev) => prev.filter((l) => l.spdxId !== spdxId));
      return;
    }
    setDeletingLicenseId(spdxId);
    try {
      await deleteLicenseOverride(organizationId, spdxId);
      toast.success(t('pages.settingsLicenses.toast.deleteSuccess'));
      await loadLicenses();
    } catch {
      toast.error(t('pages.settingsLicenses.toast.deleteError'));
    } finally {
      setDeletingLicenseId(null);
    }
  };

  const lang = i18n.language?.startsWith('fr') ? 'fr' : 'en';

  const getCategoryLabel = (category: string) =>
    CATEGORY_LABELS[category]?.[lang] || category;

  const hasAnyOverrides = licenses.some((l) => l.isOverridden);

  const filteredLicenses = useMemo(() => {
    let result = [...licenses];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          l.spdxId.toLowerCase().includes(q) ||
          l.name.toLowerCase().includes(q),
      );
    }
    if (filterCategory !== 'all') {
      result = result.filter((l) => l.currentCategory === filterCategory);
    }
    return result;
  }, [licenses, searchQuery, filterCategory]);

  return (
    <div className="max-w-6xl mx-auto py-4 px-4 space-y-4">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className={cn("relative -ml-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-zinc-500 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100", AS_FOCUS, AS_TOUCH)}
      >
        <ArrowLeft className="h-4 w-4"  />
        {t('pages.settingsLicenses.back')}
      </button>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className={AS_SECTION_TITLE}>
            {t('pages.settingsLicenses.title')}
          </h2>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-1">
            {t('pages.settingsLicenses.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasAnyOverrides && (
            <Button
              variant="outline"
              onClick={handleResetAll}
              size="sm"
            >
              {t('pages.settingsLicenses.resetAll')}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => setShowAddModal(true)}
            size="sm"
            icon={<Plus className="h-4 w-4"  />}
          >
            {t('pages.settingsLicenses.addCustom')}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder={t('pages.settingsLicenses.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(AS_FIELD, AS_FIELD_FOCUS, "flex-1 h-8 px-3 text-[13px] max-md:h-11 max-md:min-h-11")}
          />
          <div className="w-48">
            <Select
              options={[
                { value: 'all', label: t('pages.settingsLicenses.allCategories') },
                ...CATEGORIES.map((cat) => ({
                  value: cat,
                  label: getCategoryLabel(cat),
                })),
              ]}
              value={filterCategory}
              onChange={(value) => setFilterCategory(value)}
              compact
            />
          </div>
        </div>
      </Card>

      {/* License Table */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <Skeleton key={i} type="text" rows={1} />
            ))}
          </div>
        ) : filteredLicenses.length === 0 ? (
          <div className="text-center py-8 text-[13px] text-zinc-500 dark:text-zinc-400">
            {t('pages.settingsLicenses.noResults')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className={AS_THEAD}>
                <tr className="border-b border-zinc-200 dark:border-as-line">
                  <th className={AS_TH}>
                    {t('pages.settingsLicenses.table.license')}
                  </th>
                  <th className={AS_TH}>
                    {t('pages.settingsLicenses.table.name')}
                  </th>
                  <th className={AS_TH}>
                    {t('pages.settingsLicenses.table.defaultCategory')}
                  </th>
                  <th className={AS_TH}>
                    {t('pages.settingsLicenses.table.classification')}
                  </th>
                  <th className={AS_TH} />
                </tr>
              </thead>
              <tbody>
                {filteredLicenses.map((lic) => (
                  <tr
                    key={lic.spdxId}
                    className={cn("border-b border-zinc-100 dark:border-as-line last:border-b-0", AS_TR)}
                  >
                    <td className={cn(AS_TD, "font-mono text-xs text-zinc-900 dark:text-zinc-100")}>
                      {lic.spdxId}
                    </td>
                    <td className={cn(AS_TD, "text-zinc-700 dark:text-zinc-300")}>
                      {lic.name}
                    </td>
                    <td className={cn(AS_TD, "py-2")}>
                      <span className={cn(AS_STATUS_WORD, CATEGORY_TONE[lic.defaultCategory] || CATEGORY_TONE.UNKNOWN)}>
                        {getCategoryLabel(lic.defaultCategory)}
                      </span>
                    </td>
                    <td className={cn(AS_TD, "py-2")}>
                      <div className="w-40">
                        <Select
                          options={CATEGORIES.map((c) => ({
                            value: c,
                            label: getCategoryLabel(c),
                          }))}
                          value={lic.currentCategory}
                          onChange={(value) => handleCategoryChange(lic.spdxId, value)}
                          compact
                        />
                      </div>
                    </td>
                    <td className={cn(AS_TD, "py-2")}>
                      <div className="flex items-center gap-2">
                        {lic.isOverridden && (
                          <Badge variant="info" size="sm">
                            {t('pages.settingsLicenses.customized')}
                          </Badge>
                        )}
                        {lic.isCustom && (
                          <button
                            onClick={() => handleDeleteCustomLicense(lic.spdxId)}
                            disabled={deletingLicenseId === lic.spdxId}
                            className={cn("relative text-xs font-medium text-red-600 transition-colors duration-[120ms] hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50", AS_FOCUS, AS_TOUCH)}
                            title={t('pages.settingsLicenses.deleteCustom')}
                          >
                            {deletingLicenseId === lic.spdxId
                              ? t('pages.settingsLicenses.deleting')
                              : t('pages.settingsLicenses.deleteCustom')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Stats footer: one phrase, each category in its own colour (no dot, no separator) */}
      {!loading && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('pages.settingsLicenses.total')}{' '}
          <span className="font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">{licenses.length}</span>
          {CATEGORIES.map((category) => (
            <React.Fragment key={category}>
              {', '}
              <span className={CATEGORY_TONE[category]}>{getCategoryLabel(category)}</span>{' '}
              <span className="font-mono font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                {licenses.filter((l) => l.currentCategory === category).length}
              </span>
            </React.Fragment>
          ))}
        </p>
      )}

      {/* Add License Modal */}
      {showAddModal && (
        <Modal
          title={t('pages.settingsLicenses.addModal.title')}
          description={t('pages.settingsLicenses.addModal.description')}
          size="sm"
          onClose={() => {
            setShowAddModal(false);
            setNewSpdxId('');
            setNewCategory('UNKNOWN');
          }}
          footerButtons={
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowAddModal(false);
                  setNewSpdxId('');
                  setNewCategory('UNKNOWN');
                }}
              >
                {t('pages.settingsLicenses.addModal.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleAddCustomLicense}
                disabled={!newSpdxId.trim() || addingLicense}
                loading={addingLicense}
              >
                {t('pages.settingsLicenses.addModal.confirm')}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t('pages.settingsLicenses.addModal.spdxLabel')}
              </label>
              <input
                type="text"
                placeholder={t('pages.settingsLicenses.addModal.spdxPlaceholder')}
                value={newSpdxId}
                onChange={(e) => setNewSpdxId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newSpdxId.trim()) handleAddCustomLicense();
                }}
                className={cn(AS_FIELD, AS_FIELD_FOCUS, "w-full h-9 px-3 text-sm max-md:h-11")}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                {t('pages.settingsLicenses.addModal.categoryLabel')}
              </label>
              <Select
                options={CATEGORIES.map((c) => ({
                  value: c,
                  label: getCategoryLabel(c),
                }))}
                value={newCategory}
                onChange={(value) => setNewCategory(value)}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default SettingsLicensesPage;

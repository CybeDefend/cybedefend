import React, { useEffect, useState } from "react";

import { useTranslation } from "react-i18next";
import Button from "../../../atoms/button/Button";
import Modal from "../../../atoms/modal/Modal";
import Toggle from "../../../atoms/toggle/Toggle";
import OptionGroup from "../../option-group/OptionGroup";
import Checkbox from "../../../atoms/checkbox/Checkbox";
import { AGENT_CATEGORIES_SAST, AGENT_CATEGORIES_IAC, AGENT_CATEGORIES_CICD, CICD_CATEGORY_NAMES, AgentCategoryDefinition } from "@/utils/data/agentCategoriesData";
import { ArrowUp, CodeBranch, EyeSlash, Link, ListCheck, Users } from '@/components/atoms/icon/icons';
import { AS_NOTICE_FRAME } from '@/components/atoms/appsec/recipes';
import { AS_WORD_TONE } from '@/components/atoms/appsec/styles';
import { EDITION } from '@/edition/edition';

// The Community Edition has no Cybe analysis: no analysis category to
// pick, whatever the project's flag says. Reachability comes from the cloud's
// SCA scanner, and a SARIF import carries none: no reachability switch either.
// Its scanners (opengrep, trivy-fs) take no fast scan mode and no development
// or transitive dependencies switch, and an import carries none either: the
// Community Edition hides those, with or without a cluster.
const COMMUNITY = EDITION === 'community';

interface ConfigurationScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  isSast: boolean;
  isSca?: boolean;
  isIac?: boolean;
  improvingResultsEnabled?: boolean;
  initialConfig: {
    fastScan?: boolean;
    severities: string[];
    isDevDependenciesEnabled?: boolean;
    isTransitiveDependenciesEnabled?: boolean;
    isReachabilityPriorityEnabled?: boolean;
    isReachabilityStatusEnabled?: boolean;
    agentCategories?: string[]; // lower snake case (optional => all)
  };
  onSubmit: (config: {
    fastScan: boolean;
    severities: string[];
    isDevDependenciesEnabled?: boolean;
    isTransitiveDependenciesEnabled?: boolean;
    isReachabilityPriorityEnabled?: boolean;
    isReachabilityStatusEnabled?: boolean;
    agentCategories?: string[];
  }) => void;
}

const ConfigurationScanModal: React.FC<ConfigurationScanModalProps> = ({
  isOpen,
  onClose,
  isSast,
  isSca = false,
  isIac = false,
  improvingResultsEnabled: improvingResultsFlag = true,
  initialConfig,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const improvingResultsEnabled = !COMMUNITY && improvingResultsFlag;
  const [fastScanEnabled, setFastScanEnabled] = useState<boolean>(false);
  const [isDevDependenciesEnabled, setIsDevDependenciesEnabled] = useState<boolean>(false);
  const [isTransitiveDependenciesEnabled, setIsTransitiveDependenciesEnabled] = useState<boolean>(false);
  const [isReachabilityPriorityEnabled, setIsReachabilityPriorityEnabled] = useState<boolean>(true);
  const [isReachabilityStatusEnabled, setIsReachabilityStatusEnabled] = useState<boolean>(true);
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([]);
  const [selectedAgentCategories, setSelectedAgentCategories] = useState<string[]>([]);
  const [agentCategoriesError, setAgentCategoriesError] = useState<string | null>(null);

  // Determine which agent categories to use based on scanner type
  // For SAST: pure SAST categories + CICD categories (displayed in separate visual sections)
  const AGENT_CATEGORIES_PURE_SAST = AGENT_CATEGORIES_SAST.filter(c => !CICD_CATEGORY_NAMES.has(c.name));
  const AGENT_CATEGORIES = isSast ? [...AGENT_CATEGORIES_PURE_SAST, ...AGENT_CATEGORIES_CICD] : (isIac ? AGENT_CATEGORIES_IAC : []);

  useEffect(() => {
    if (!isOpen || !initialConfig) return;
    setFastScanEnabled(isSast ? initialConfig.fastScan ?? false : false);
    setIsDevDependenciesEnabled(isSca ? initialConfig.isDevDependenciesEnabled ?? false : false);
    setIsTransitiveDependenciesEnabled(isSca ? initialConfig.isTransitiveDependenciesEnabled ?? false : false);
    setIsReachabilityPriorityEnabled(isSca ? initialConfig.isReachabilityPriorityEnabled ?? true : true);
    setIsReachabilityStatusEnabled(isSca ? initialConfig.isReachabilityStatusEnabled ?? true : true);
    setSelectedSeverities(initialConfig.severities ?? []);
    if (isSast || isIac) {
      if (initialConfig.agentCategories && initialConfig.agentCategories.length) {
        setSelectedAgentCategories(initialConfig.agentCategories);
      } else {
        // Use the imported constant directly to avoid dependency issues
        const categories = isSast ? [...AGENT_CATEGORIES_SAST.filter(c => !CICD_CATEGORY_NAMES.has(c.name)), ...AGENT_CATEGORIES_CICD] : AGENT_CATEGORIES_IAC;
        setSelectedAgentCategories(categories.map(c => c.name));
      }
    } else {
      setSelectedAgentCategories([]);
    }
    setAgentCategoriesError(null);
    // Only depend on primitive values and stable references
  }, [isOpen, isSast, isSca, isIac, (initialConfig as any)?.fastScan, (initialConfig as any)?.isDevDependenciesEnabled, (initialConfig as any)?.isTransitiveDependenciesEnabled, (initialConfig as any)?.isReachabilityPriorityEnabled, (initialConfig as any)?.isReachabilityStatusEnabled, initialConfig?.severities, (initialConfig as any)?.agentCategories]);

  const severityOptions = [
    { label: t('components.modal.configurationScan.severities.critical'), value: 'critical' },
    { label: t('components.modal.configurationScan.severities.high'), value: 'high' },
    { label: t('components.modal.configurationScan.severities.medium'), value: 'medium' },
    { label: t('components.modal.configurationScan.severities.low'), value: 'low' },
  ];

  const handleSubmit = () => {
    if (improvingResultsEnabled && (isSast || isIac) && selectedAgentCategories.length === 0) {
      setAgentCategoriesError(t('components.modal.configurationScan.agentCategories.validationRequired'));
      return;
    }
    onSubmit({
      fastScan: fastScanEnabled,
      severities: selectedSeverities,
      ...(isSca && {
        isDevDependenciesEnabled,
        isTransitiveDependenciesEnabled,
        isReachabilityPriorityEnabled,
        isReachabilityStatusEnabled,
      }),
      ...((isSast || isIac) && improvingResultsEnabled && selectedAgentCategories.length > 0 && { agentCategories: selectedAgentCategories }),
    });
    onClose();
  };

  const renderCategoryCard = (cat: AgentCategoryDefinition) => {
    const checked = selectedAgentCategories.includes(cat.name);
    return (
      <div
        key={cat.name}
        className={`border rounded-xl p-3 transition-colors duration-[120ms] min-h-[100px] flex flex-col justify-between cursor-pointer select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${checked
          ? 'border-secondary bg-secondary/[0.04] dark:border-secondary-light/40 dark:bg-secondary/10'
          : 'border-zinc-200 dark:border-as-line hover:border-zinc-300 dark:hover:border-white/[0.14]'
          }`}
        onClick={() => {
          setSelectedAgentCategories(prev =>
            checked ? prev.filter(p => p !== cat.name) : [...prev, cat.name]
          );
          setAgentCategoriesError(null);
        }}
        tabIndex={0}
        role="button"
        aria-pressed={checked}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            setSelectedAgentCategories(prev =>
              checked ? prev.filter(p => p !== cat.name) : [...prev, cat.name]
            );
            setAgentCategoriesError(null);
          }
        }}
      >
        <div className="flex-1 mb-3">
          <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100 mb-1 break-words">
            {t(cat.displayNameKey)}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed break-words">
            {t(cat.shortDescKey)}
          </div>
        </div>
        <div className="flex justify-end pointer-events-none">
          <Checkbox
            name="agentCategories"
            value={cat.name}
            checked={checked}
            onChange={() => { }}
            label=""
          />
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <Modal
      title={
        isSast
          ? t('components.modal.configurationScan.title')
          : isIac
            ? t('components.modal.configurationScan.iacTitle')
            : t('components.modal.configurationScan.generalConfiguration')
      }
      onClose={onClose}
      width="max-w-4xl"
      customMaxWidth="80vw"
      footerButtons={
        <>
          <Button variant="white" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="secondary" onClick={handleSubmit}>{t('components.modal.configurationScan.updateConfiguration')}</Button>
        </>
      }
    >
      <div className="space-y-6">
        {isSca && !COMMUNITY && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
            <div className="flex items-center">
              <CodeBranch className="text-zinc-400 dark:text-zinc-500 w-4 h-4 mr-3 flex-shrink-0"  />
              <div>
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('components.modal.configurationScan.scaDevDependencies.title')}</h4>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">{t('components.modal.configurationScan.scaDevDependencies.description')}</p>
              </div>
            </div>
            <Toggle enabled={isDevDependenciesEnabled} onChange={setIsDevDependenciesEnabled} />
          </div>
        )}
        {isSca && !COMMUNITY && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
            <div className="flex items-center">
              <Link className="text-zinc-400 dark:text-zinc-500 w-4 h-4 mr-3 flex-shrink-0"  />
              <div>
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('components.modal.configurationScan.scaTransitiveDependencies.title')}</h4>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">{t('components.modal.configurationScan.scaTransitiveDependencies.description')}</p>
              </div>
            </div>
            <Toggle enabled={isTransitiveDependenciesEnabled} onChange={setIsTransitiveDependenciesEnabled} />
          </div>
        )}
        {isSca && !COMMUNITY && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
            <div className="flex items-center">
              <ArrowUp className="text-zinc-400 dark:text-zinc-500 w-4 h-4 mr-3 flex-shrink-0"  />
              <div>
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('components.modal.configurationScan.scaReachability.priorityTitle')}</h4>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">{t('components.modal.configurationScan.scaReachability.priorityDescription')}</p>
              </div>
            </div>
            <Toggle enabled={isReachabilityPriorityEnabled} onChange={setIsReachabilityPriorityEnabled} />
          </div>
        )}
        {isSca && !COMMUNITY && (
          <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
            <div className="flex items-center">
              <EyeSlash className="text-zinc-400 dark:text-zinc-500 w-4 h-4 mr-3 flex-shrink-0"  />
              <div>
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('components.modal.configurationScan.scaReachability.statusTitle')}</h4>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">{t('components.modal.configurationScan.scaReachability.statusDescription')}</p>
              </div>
            </div>
            <Toggle enabled={isReachabilityStatusEnabled} onChange={setIsReachabilityStatusEnabled} />
          </div>
        )}
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-as-line">
          <div className="flex items-center">
            <Users className="text-zinc-400 dark:text-zinc-500 w-4 h-4 mr-3 flex-shrink-0"  />
            <div>
              <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('components.modal.configurationScan.severities.title')}</h4>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">{t('components.modal.configurationScan.severities.description')}</p>
            </div>
          </div>
          <div className="mt-4">
            <OptionGroup
              name="severities"
              selectedValues={selectedSeverities}
              options={severityOptions}
              onChange={setSelectedSeverities}
              type="checkbox"
            />
          </div>
        </div>
        {improvingResultsEnabled && (isSast || isIac) && (
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-as-line">
            <div className="flex items-center">
              <ListCheck className="text-zinc-400 dark:text-zinc-500 w-4 h-4 mr-3 flex-shrink-0"  />
              <div className="flex-1">
                <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('components.modal.configurationScan.agentCategories.title')}</h4>
                <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">{t('components.modal.configurationScan.agentCategories.description')}</p>
              </div>
              <div className="text-[13px] tabular-nums text-zinc-600 dark:text-zinc-400 ml-4 whitespace-nowrap">
                {t('components.modal.configurationScan.agentCategories.counter', { count: selectedAgentCategories.length })}
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <Button
                  variant="white"
                  onClick={() => {
                    if (selectedAgentCategories.length === AGENT_CATEGORIES.length) {
                      setSelectedAgentCategories([]);
                    } else {
                      setSelectedAgentCategories(AGENT_CATEGORIES.map(c => c.name));
                    }
                    setAgentCategoriesError(null);
                  }}
                >
                  {selectedAgentCategories.length === AGENT_CATEGORIES.length
                    ? t('components.modal.configurationScan.agentCategories.unselectAll')
                    : t('components.modal.configurationScan.agentCategories.selectAll')}
                </Button>
              </div>
              {isSast && (
                <>
                  <h5 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mt-3">{t('components.modal.configurationScan.agentCategories.sastSectionTitle')}</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-1">
                    {AGENT_CATEGORIES_PURE_SAST.map(cat => renderCategoryCard(cat))}
                  </div>
                  <h5 className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mt-4">{t('components.modal.configurationScan.agentCategories.cicdSectionTitle')}</h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-1">
                    {AGENT_CATEGORIES_CICD.map(cat => renderCategoryCard(cat))}
                  </div>
                </>
              )}
              {!isSast && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pr-1">
                  {AGENT_CATEGORIES.map(cat => renderCategoryCard(cat))}
                </div>
              )}
              {agentCategoriesError && (
                <div className={`${AS_NOTICE_FRAME} mt-3`}>
                  <div className="flex items-center gap-2">
                    {/* The error in red: the sentence carries the status (no dot). */}
                    <p className={`font-medium ${AS_WORD_TONE.bad}`}>{agentCategoriesError}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default ConfigurationScanModal;



import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { useAuthorization } from "react-rebac";
import { RootState } from "../../../server/store";
import Button from "../../atoms/button/Button";
import Card from "../../atoms/card/Card";
import Toggle from "../../atoms/toggle/Toggle";
import ComingSoonOverlay from "../../molecules/coming-soon-overlay/ComingSoonOverlay";
import OptionGroup from "../../molecules/option-group/OptionGroup";
import Badge from "../../atoms/badge/Badge";
import ConfigurationScanModal from "@/components/molecules/modal/sast-configuration-modal/ConfigurationScanModal";
import { useTranslation } from "react-i18next";
import { ChevronDown, Gavel } from '@/components/atoms/icon/icons';

import { AS_PANEL_TITLE } from '@/components/atoms/appsec/styles';
import { Slot, useSlotEntries } from '@/edition/slots';
import { EDITION } from '@/edition/edition';
import { useScansRun } from '@/edition/community/instanceCapabilities';
import { AS_NOTICE } from '@/components/atoms/appsec/recipes';

/** One setting of the Scanning tab's first card: a title, its badges, its description and its switch. */
export interface ScanningSettingRowFeature {
  id: string;
  title: string;
  description: string;
  badges: Array<{ label: string; bgColor: string; textColor: string; darkBgColor: string; darkTextColor: string }>;
  toggleEnabled: boolean;
  onToggle: () => void;
  comingSoon: boolean;
}

/**
 * A setting row of the Scanning tab's first card, shared with the settings an
 * edition's `project.settings.sections` registration adds there (host
 * `scanning-settings`), so every row looks the same.
 */
export const ScanningSettingRow: React.FC<{ feature: ScanningSettingRowFeature }> = ({ feature }) => {
  const content = (
    <div
      key={feature.id}
      data-testid={`ai-setting-${feature.id}`}
      className="flex items-start justify-between"
    >
      <div className="min-w-0 flex-1 pr-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {feature.title}
          </h3>
          {feature.badges.map((badge, index) => (
            <Badge
              key={index}
              label={badge.label}
              bgColor={badge.bgColor}
              textColor={badge.textColor}
              darkBgColor={badge.darkBgColor}
              darkTextColor={badge.darkTextColor}
            />
          ))}
        </div>
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
          {feature.description}
        </p>
      </div>
      <div className="mt-1 flex-shrink-0">
        <Toggle
          enabled={feature.toggleEnabled}
          onChange={feature.onToggle}
        />
      </div>
    </div>
  );
  return feature.comingSoon ? (
    <ComingSoonOverlay key={feature.id}>{content}</ComingSoonOverlay>
  ) : (
    content
  );
};
interface ScanningSettingsProps {
  analysisFrequency: string;
  onAnalysisFrequencyChange: (value: string) => void;
  aiMergeRequestEnabled: boolean;
  onAiMergeRequestToggle: () => void;
  /**
   * The flag that starts the findings' analysis: the setting an edition adds
   * to the first card shows it (`project.settings.sections`).
   */
  improvingResultsEnabled: boolean;
  /** Sets both flags of the findings' analysis (improving results, sorting) to the new value. */
  onCybeAnalysisToggle: () => void;
  scanTypes: {
    sast: boolean;
    dast: boolean;
    sca: boolean;
    container: boolean;
    api: boolean;
    iac: boolean;
    secret: boolean;
    aibom: boolean;
  };
  configurationSast: {
    fastScan: boolean;
    severities: string[];
    agentCategories?: string[]; // UI lower snake case list (includes SAST + CICD categories)
  };
  configurationIac: {
    severities: string[];
    agentCategories?: string[];
  };
  configurationSca: {
    isDevDependenciesEnabled: boolean;
    isTransitiveDependenciesEnabled: boolean;
    isReachabilityPriorityEnabled: boolean;
    isReachabilityStatusEnabled: boolean;
    severities: string[];
  };
  configurationContainer: {
    severities: string[];
  };
  configurationSecret: {
    severities: string[];
  };
  onScanTypeToggle: (type: keyof ScanningSettingsProps["scanTypes"]) => void;
  onConfigureSast: (config: {
    fastScan: boolean;
    severities: string[];
    agentCategories?: string[];
  }) => void;
  onConfigureSca: (config: {
    isDevDependenciesEnabled: boolean;
    isTransitiveDependenciesEnabled: boolean;
    isReachabilityPriorityEnabled: boolean;
    isReachabilityStatusEnabled: boolean;
    severities: string[];
  }) => void;
  onConfigureIac: (config: {
    severities: string[];
    agentCategories?: string[];
  }) => void;
  onConfigureContainer: (config: { severities: string[] }) => void;
  onConfigureSecret: (config: { severities: string[] }) => void;
  isProjectLinkedToGithub: boolean;
  isProjectLinkedToGitlab: boolean;
}

const ScanningSettings: React.FC<ScanningSettingsProps> = ({
  analysisFrequency,
  onAnalysisFrequencyChange,
  aiMergeRequestEnabled,
  onAiMergeRequestToggle,
  improvingResultsEnabled,
  onCybeAnalysisToggle,
  scanTypes,
  configurationIac,
  configurationSast,
  configurationSca,
  configurationContainer,
  configurationSecret,
  onScanTypeToggle,
  onConfigureSast,
  onConfigureSca,
  onConfigureIac,
  onConfigureContainer,
  onConfigureSecret,
  isProjectLinkedToGithub,
  isProjectLinkedToGitlab,
}) => {
  const { t } = useTranslation();
  // An import-only Community instance says how to run scans here (text only);
  // one that runs scans on a connected cluster does not.
  const scansRun = useScansRun();
  const showClusterHint = EDITION === "community" && !scansRun;
  const navigate = useNavigate();
  const selectedOrganization = useSelector(
    (state: RootState) => state.organization.selectedOrganization,
  );
  const canManageLicenses = useAuthorization(
    selectedOrganization?.id || '',
    'organization',
    ['creator', 'administrator', 'manager'],
  );
  const [isSastModalOpen, setIsSastModalOpen] = useState(false);
  const [isIacModalOpen, setIsIacModalOpen] = useState(false);
  const [isScaModalOpen, setIsScaModalOpen] = useState(false);
  const [isContainerModalOpen, setIsContainerModalOpen] = useState(false);
  const [isSecretModalOpen, setIsSecretModalOpen] = useState(false);

  const openSastModal = () => setIsSastModalOpen(true);
  const closeSastModal = () => setIsSastModalOpen(false);
  const openIacModal = () => setIsIacModalOpen(true);
  const closeIacModal = () => setIsIacModalOpen(false);
  const openScaModal = () => setIsScaModalOpen(true);
  const closeScaModal = () => setIsScaModalOpen(false);
  const openContainerModal = () => setIsContainerModalOpen(true);
  const closeContainerModal = () => setIsContainerModalOpen(false);
  const openSecretModal = () => setIsSecretModalOpen(true);
  const closeSecretModal = () => setIsSecretModalOpen(false);

  // The settings an edition adds to the first card read the analysis and
  // merge-request flags (and whether the project is linked to a repository)
  // and switch each through its handler.
  const editionSettings = {
    values: {
      improvingResultsEnabled,
      aiMergeRequestEnabled,
      repositoryLinked: isProjectLinkedToGithub || isProjectLinkedToGitlab,
    },
    onChange: (values: Record<string, boolean>) => {
      if (values.improvingResultsEnabled !== improvingResultsEnabled) onCybeAnalysisToggle();
      if (values.aiMergeRequestEnabled !== aiMergeRequestEnabled) onAiMergeRequestToggle();
    },
  };
  const hasEditionSettings = useSlotEntries('project.settings.sections').length > 0;

  const analysisFrequencyOptions = [
    { label: t('components.scanningSettings.analysisFrequency.options.daily'), value: "daily" },
    { label: t('components.scanningSettings.analysisFrequency.options.weekly'), value: "weekly" },
    { label: t('components.scanningSettings.analysisFrequency.options.never'), value: "never" },
  ];

  return (
    <div className="space-y-8 w-full">
      {hasEditionSettings && (
      <Card>
        <div className="space-y-6">
          {/* <div>
            <h3 className="text-lg font-medium text-black dark:text-gray-300">
              {t('components.scanningSettings.analysisFrequency.title')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('components.scanningSettings.analysisFrequency.description')}
            </p>
            <div className="mt-4">
              <OptionGroup
                name="analysisFrequency"
                selectedValues={[analysisFrequency]}
                options={analysisFrequencyOptions}
                onChange={(values) => onAnalysisFrequencyChange(values[0])}
                type="radio"
              />
            </div>
          </div> */}
          {/* The findings' analysis and merge-request settings are
              `project.settings.sections` registrations of the active edition. */}
          <Slot
            name="project.settings.sections"
            context={{ host: "scanning-settings", settings: editionSettings }}
          />
        </div>
      </Card>
      )}
      <Card>
        <div className="space-y-6">
          <h3 className={AS_PANEL_TITLE}>
            {t('components.scanningSettings.typesOfAnalyzes.title')}
          </h3>
          {showClusterHint && (
            <p className={AS_NOTICE} data-testid="cluster-scans-hint">
              {t('components.clusterScans.hint')}
            </p>
          )}
          {[
            {
              id: "sast",
              title: t('components.scanningSettings.typesOfAnalyzes.sast.title'),
              description: t('components.scanningSettings.typesOfAnalyzes.sast.description'),
              imgSrc: "/image/scanner/sast.png",
              comingSoon: false,
              onConfigure: openSastModal,
            },
            {
              id: "iac",
              title: t('components.scanningSettings.typesOfAnalyzes.iac.title'),
              description: t('components.scanningSettings.typesOfAnalyzes.iac.description'),
              imgSrc: "/image/scanner/iac.png",
              comingSoon: false,
              onConfigure: openIacModal,
            },
            {
              id: "sca",
              title: t('components.scanningSettings.typesOfAnalyzes.sca.title'),
              description: t('components.scanningSettings.typesOfAnalyzes.sca.description'),
              imgSrc: "/image/scanner/sca.png",
              comingSoon: false,
              onConfigure: openScaModal,
            },
            {
              id: "container",
              title: t('components.scanningSettings.typesOfAnalyzes.container.title'),
              description: t('components.scanningSettings.typesOfAnalyzes.container.description'),
              imgSrc: "/image/scanner/container.png",
              comingSoon: false,
              onConfigure: openContainerModal,
            },
            {
              id: "secret",
              title: t('components.scanningSettings.typesOfAnalyzes.secret.title'),
              description: t('components.scanningSettings.typesOfAnalyzes.secret.description'),
              imgSrc: "/image/scanner/secret.svg",
              comingSoon: false,
              onConfigure: openSecretModal,
            },
            {
              id: "aibom",
              title: t('components.scanningSettings.typesOfAnalyzes.aibom.title'),
              description: t('components.scanningSettings.typesOfAnalyzes.aibom.description'),
              imgSrc: "/image/scanner/aibom.svg",
              comingSoon: false,
              onConfigure: undefined,
            },
          // AI-BOM and the EU AI Act report are closed: the Community
          // Edition neither runs nor imports one.
          ].filter((analysis) => EDITION !== "community" || analysis.id !== "aibom").map((analysis) => {
            const content = (
              <div
                className="flex items-start justify-between"
                key={analysis.id}
              >
                <div className="flex min-w-0 flex-1 items-start pr-4">
                  <img
                    src={analysis.imgSrc}
                    alt={analysis.title}
                    className="w-8 h-8 mr-3 mt-0.5 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {analysis.title}
                    </h4>
                    <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {analysis.description}
                    </p>
                  </div>
                </div>
                <div className="mt-1 flex-shrink-0">
                  <Toggle
                    enabled={scanTypes[analysis.id as keyof typeof scanTypes]}
                    onChange={() =>
                      onScanTypeToggle(analysis.id as keyof typeof scanTypes)
                    }
                  />
                </div>
              </div>
            );
            const actions = (
              <div className="mt-4 flex gap-2 flex-wrap">
                {/* Only show Configure button if the scanner is enabled AND has a config modal */}
                {scanTypes[analysis.id as keyof typeof scanTypes] && analysis.onConfigure && (
                  <Button variant="white" onClick={analysis.onConfigure}>
                    {t('components.scanningSettings.configure')}{" "}
                    <ChevronDown className="h-4 w-4 ml-1"  />
                  </Button>
                )}
                {/* Licence management is the cloud's. */}
                {analysis.id === "sca" && scanTypes.sca && canManageLicenses && EDITION !== "community" && (
                  <Button variant="white" to="/organization/settings/licenses">
                    <Gavel className="h-4 w-4 mr-1"  />
                    {t('components.scanningSettings.manageLicenses')}
                  </Button>
                )}
              </div>
            );
            return analysis.comingSoon ? (
              <ComingSoonOverlay key={analysis.id}>
                <div>
                  {content}
                  {actions}
                </div>
              </ComingSoonOverlay>
            ) : (
              <div key={analysis.id}>
                {content}
                {actions}
              </div>
            );
          })}
        </div>
      </Card>
      <ConfigurationScanModal
        isOpen={isSastModalOpen}
        onClose={closeSastModal}
        isSast={true}
        initialConfig={configurationSast}
        improvingResultsEnabled={improvingResultsEnabled}
        onSubmit={(config) => {
          onConfigureSast(config);
        }}
      />
      <ConfigurationScanModal
        isOpen={isIacModalOpen}
        onClose={closeIacModal}
        isSast={false}
        isIac={true}
        initialConfig={configurationIac}
        improvingResultsEnabled={improvingResultsEnabled}
        onSubmit={(config) => {
          onConfigureIac({
            severities: config.severities,
            agentCategories: config.agentCategories,
          });
        }}
      />
      <ConfigurationScanModal
        isOpen={isScaModalOpen}
        onClose={closeScaModal}
        isSast={false}
        isSca={true}
        initialConfig={{
          severities: configurationSca.severities,
          isDevDependenciesEnabled: configurationSca.isDevDependenciesEnabled,
          isTransitiveDependenciesEnabled: configurationSca.isTransitiveDependenciesEnabled,
          isReachabilityPriorityEnabled: configurationSca.isReachabilityPriorityEnabled,
          isReachabilityStatusEnabled: configurationSca.isReachabilityStatusEnabled,
        }}
        onSubmit={(config) => {
          onConfigureSca({
            severities: config.severities,
            isDevDependenciesEnabled: config.isDevDependenciesEnabled || false,
            isTransitiveDependenciesEnabled: config.isTransitiveDependenciesEnabled || false,
            isReachabilityPriorityEnabled: config.isReachabilityPriorityEnabled ?? true,
            isReachabilityStatusEnabled: config.isReachabilityStatusEnabled ?? true,
          });
        }}
      />
      <ConfigurationScanModal
        isOpen={isContainerModalOpen}
        onClose={closeContainerModal}
        isSast={false}
        initialConfig={configurationContainer}
        onSubmit={(config) => {
          onConfigureContainer({ severities: config.severities });
        }}
      />
      <ConfigurationScanModal
        isOpen={isSecretModalOpen}
        onClose={closeSecretModal}
        isSast={false}
        initialConfig={configurationSecret}
        onSubmit={(config) => {
          onConfigureSecret({ severities: config.severities });
        }}
      />
    </div>
  );
};

export default ScanningSettings;

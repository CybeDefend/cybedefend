import React from "react";
import Card from "../../atoms/card/Card";
import Select from "../../atoms/select/Select";
import Toggle from "../../atoms/toggle/Toggle";
import { useTranslation } from "react-i18next";
import { Checkbox, Panel } from "@/components/molecules/kit/ui";
import { toggleFramework } from "./toggleFramework";

/**
 * The compliance frameworks alone, on the zinc kit: one hairline panel, the question in 13 px words,
 * then one 40 px row per framework with a kit checkbox. Every framework is in
 * sight and one click away, where a multi-select hid them behind a menu. The
 * whole row is the label.
 */
const ComplianceOnlySettings: React.FC<{
  options: { value: string; label: string }[];
  value: string[];
  onChange: (value: string[]) => void;
}> = ({ options, value, onChange }) => {
  const { t } = useTranslation();
  const titleId = React.useId();
  const descriptionId = React.useId();
  const rowId = React.useId();
  const toggle = (framework: string, on: boolean) =>
    onChange(toggleFramework(value, options.map((o) => o.value), framework, on));

  return (
    <Panel as="div" padded={false} className="p-4 shadow-none sm:p-1">
      <div data-testid="project-settings-section-body" className="w-full sm:p-4">
        <h3 id={titleId} className="text-[13px] font-medium leading-5 text-zinc-900 dark:text-zinc-100">
          {t('components.securityContextSettings.fields.complianceFrameworks.label')}
        </h3>
        <p id={descriptionId} className="mt-0.5 max-w-xl text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">
          {t('components.securityContextSettings.fields.complianceFrameworks.tooltip')}
        </p>
        <div
          role="group"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="mt-4 divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 dark:divide-vd-line dark:border-vd-line xl:grid xl:grid-cols-2 xl:divide-y-0"
        >
          {options.map((option) => {
            const checked = value.includes(option.value);
            const id = `${rowId}-${option.value}`;
            return (
              // From xl two frameworks a line: a hairline above every row but the first, one between the columns.
              <div
                key={option.value}
                className="border-zinc-100 dark:border-vd-line xl:border-t xl:odd:border-r xl:[&:nth-child(-n+2)]:border-t-0"
              >
                <label
                  htmlFor={id}
                  className="flex h-10 cursor-pointer select-none items-center gap-3 px-3 text-[13px] text-zinc-700 transition-colors duration-[120ms] hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-vd-raised"
                >
                  <Checkbox
                    id={id}
                    checked={checked}
                    onCheckedChange={(next) => toggle(option.value, next === true)}
                  />
                  <span className={checked ? "text-zinc-900 dark:text-zinc-100" : undefined}>{option.label}</span>
                </label>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
};

interface SecurityContextSettingsProps {
  environment: string;
  internetExposure: string;
  deploymentType: string;
  dataClassification: string;
  handlesPii: boolean;
  handlesPaymentData: boolean;
  businessCriticality: string;
  userBaseSize: string;
  complianceFrameworks: string[];
  safetyCritical: boolean;
  networkSegmentation: string;
  onFieldChange: (field: string, value: any) => void;
  loading: boolean;
  /**
   * Shows the compliance frameworks only: a space that scores no findings
   * (`findingSettings: false`) reads the frameworks a project declares, and
   * has no findings to score with the rest of the context.
   */
  complianceOnly?: boolean;
}

const SecurityContextSettings: React.FC<SecurityContextSettingsProps> = ({
  environment,
  internetExposure,
  deploymentType,
  dataClassification,
  handlesPii,
  handlesPaymentData,
  businessCriticality,
  userBaseSize,
  complianceFrameworks,
  safetyCritical,
  networkSegmentation,
  onFieldChange,
  loading,
  complianceOnly = false,
}) => {
  const { t } = useTranslation();

  const environmentOptions = [
    { value: "production", label: t('components.securityContextSettings.fields.environment.options.production') },
    { value: "staging", label: t('components.securityContextSettings.fields.environment.options.staging') },
    { value: "development", label: t('components.securityContextSettings.fields.environment.options.development') },
  ];

  const internetExposureOptions = [
    { value: "public", label: t('components.securityContextSettings.fields.internetExposure.options.public') },
    { value: "internal", label: t('components.securityContextSettings.fields.internetExposure.options.internal') },
    { value: "airgapped", label: t('components.securityContextSettings.fields.internetExposure.options.airgapped') },
  ];

  const deploymentTypeOptions = [
    { value: "saas", label: t('components.securityContextSettings.fields.deploymentType.options.saas') },
    { value: "onprem", label: t('components.securityContextSettings.fields.deploymentType.options.onprem') },
    { value: "embedded", label: t('components.securityContextSettings.fields.deploymentType.options.embedded') },
    { value: "mobile", label: t('components.securityContextSettings.fields.deploymentType.options.mobile') },
  ];

  const dataClassificationOptions = [
    { value: "public", label: t('components.securityContextSettings.fields.dataClassification.options.public') },
    { value: "internal", label: t('components.securityContextSettings.fields.dataClassification.options.internal') },
    { value: "confidential", label: t('components.securityContextSettings.fields.dataClassification.options.confidential') },
    { value: "regulated", label: t('components.securityContextSettings.fields.dataClassification.options.regulated') },
  ];

  const businessCriticalityOptions = [
    { value: "low", label: t('components.securityContextSettings.fields.businessCriticality.options.low') },
    { value: "medium", label: t('components.securityContextSettings.fields.businessCriticality.options.medium') },
    { value: "high", label: t('components.securityContextSettings.fields.businessCriticality.options.high') },
    { value: "mission_critical", label: t('components.securityContextSettings.fields.businessCriticality.options.mission_critical') },
  ];

  const userBaseSizeOptions = [
    { value: "small", label: t('components.securityContextSettings.fields.userBaseSize.options.small') },
    { value: "medium", label: t('components.securityContextSettings.fields.userBaseSize.options.medium') },
    { value: "large", label: t('components.securityContextSettings.fields.userBaseSize.options.large') },
  ];

  const networkSegmentationOptions = [
    { value: "flat", label: t('components.securityContextSettings.fields.networkSegmentation.options.flat') },
    { value: "segmented", label: t('components.securityContextSettings.fields.networkSegmentation.options.segmented') },
    { value: "microsegmented", label: t('components.securityContextSettings.fields.networkSegmentation.options.microsegmented') },
  ];

  const complianceFrameworkOptions = [
    { value: "SOC2", label: "SOC 2" },
    { value: "HIPAA", label: "HIPAA" },
    { value: "PCI_DSS", label: "PCI DSS" },
    { value: "GDPR", label: "GDPR" },
    { value: "ISO27001", label: "ISO 27001" },
  ];

  // A space that scores no findings asks for the compliance frameworks only, on the zinc kit.
  if (complianceOnly) {
    return (
      <ComplianceOnlySettings
        options={complianceFrameworkOptions}
        value={complianceFrameworks ?? []}
        onChange={(value) => onFieldChange('complianceFrameworks', value)}
      />
    );
  }

  return (
    <Card>
      {/* The card already pads 24px: on a phone the section adds none. */}
      <div data-testid="project-settings-section-body" className="space-y-8 w-full sm:p-4">
        {!complianceOnly && (
          <>
            {/* Section: Runtime Environment */}
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.securityContextSettings.sections.runtimeEnvironment.title')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.securityContextSettings.sections.runtimeEnvironment.description')}
              </p>

              <div className="mt-4 space-y-4">
                {/* Environment */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('components.securityContextSettings.fields.environment.label')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('components.securityContextSettings.fields.environment.tooltip')}
                  </p>
                  <div className="mt-2">
                    <Select
                      options={environmentOptions}
                      value={environment}
                      onChange={(value) => onFieldChange('environment', value)}
                      placeholder={t('components.securityContextSettings.fields.environment.placeholder')}
                      width="w-full"
                    />
                  </div>
                </div>

                {/* Internet Exposure */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('components.securityContextSettings.fields.internetExposure.label')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('components.securityContextSettings.fields.internetExposure.tooltip')}
                  </p>
                  <div className="mt-2">
                    <Select
                      options={internetExposureOptions}
                      value={internetExposure}
                      onChange={(value) => onFieldChange('internetExposure', value)}
                      placeholder={t('components.securityContextSettings.fields.internetExposure.placeholder')}
                      width="w-full"
                    />
                  </div>
                </div>

                {/* Deployment Type */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('components.securityContextSettings.fields.deploymentType.label')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('components.securityContextSettings.fields.deploymentType.tooltip')}
                  </p>
                  <div className="mt-2">
                    <Select
                      options={deploymentTypeOptions}
                      value={deploymentType}
                      onChange={(value) => onFieldChange('deploymentType', value)}
                      placeholder={t('components.securityContextSettings.fields.deploymentType.placeholder')}
                      width="w-full"
                    />
                  </div>
                </div>

                {/* Network Segmentation */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('components.securityContextSettings.fields.networkSegmentation.label')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('components.securityContextSettings.fields.networkSegmentation.tooltip')}
                  </p>
                  <div className="mt-2">
                    <Select
                      options={networkSegmentationOptions}
                      value={networkSegmentation}
                      onChange={(value) => onFieldChange('networkSegmentation', value)}
                      placeholder={t('components.securityContextSettings.fields.networkSegmentation.placeholder')}
                      width="w-full"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Data Sensitivity */}
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.securityContextSettings.sections.dataSensitivity.title')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.securityContextSettings.sections.dataSensitivity.description')}
              </p>

              <div className="mt-4 space-y-4">
                {/* Data Classification */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('components.securityContextSettings.fields.dataClassification.label')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('components.securityContextSettings.fields.dataClassification.tooltip')}
                  </p>
                  <div className="mt-2">
                    <Select
                      options={dataClassificationOptions}
                      value={dataClassification}
                      onChange={(value) => onFieldChange('dataClassification', value)}
                      placeholder={t('components.securityContextSettings.fields.dataClassification.placeholder')}
                      width="w-full"
                    />
                  </div>
                </div>

                {/* Handles PII */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {t('components.securityContextSettings.fields.handlesPii.label')}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('components.securityContextSettings.fields.handlesPii.tooltip')}
                    </p>
                  </div>
                  <Toggle enabled={handlesPii} onChange={(v) => onFieldChange('handlesPii', v)} />
                </div>

                {/* Handles Payment Data */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {t('components.securityContextSettings.fields.handlesPaymentData.label')}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('components.securityContextSettings.fields.handlesPaymentData.tooltip')}
                    </p>
                  </div>
                  <Toggle enabled={handlesPaymentData} onChange={(v) => onFieldChange('handlesPaymentData', v)} />
                </div>
              </div>
            </div>

            {/* Section: Business Context */}
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.securityContextSettings.sections.businessContext.title')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.securityContextSettings.sections.businessContext.description')}
              </p>

              <div className="mt-4 space-y-4">
                {/* Business Criticality */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('components.securityContextSettings.fields.businessCriticality.label')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('components.securityContextSettings.fields.businessCriticality.tooltip')}
                  </p>
                  <div className="mt-2">
                    <Select
                      options={businessCriticalityOptions}
                      value={businessCriticality}
                      onChange={(value) => onFieldChange('businessCriticality', value)}
                      placeholder={t('components.securityContextSettings.fields.businessCriticality.placeholder')}
                      width="w-full"
                    />
                  </div>
                </div>

                {/* User Base Size */}
                <div>
                  <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t('components.securityContextSettings.fields.userBaseSize.label')}
                  </h3>
                  <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {t('components.securityContextSettings.fields.userBaseSize.tooltip')}
                  </p>
                  <div className="mt-2">
                    <Select
                      options={userBaseSizeOptions}
                      value={userBaseSize}
                      onChange={(value) => onFieldChange('userBaseSize', value)}
                      placeholder={t('components.securityContextSettings.fields.userBaseSize.placeholder')}
                      width="w-full"
                    />
                  </div>
                </div>

                {/* Safety Critical */}
                <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-4 py-3 dark:border-as-line">
                  <div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {t('components.securityContextSettings.fields.safetyCritical.label')}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {t('components.securityContextSettings.fields.safetyCritical.tooltip')}
                    </p>
                  </div>
                  <Toggle enabled={safetyCritical} onChange={(v) => onFieldChange('safetyCritical', v)} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Section: Compliance */}
        <div>
          <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t('components.securityContextSettings.sections.compliance.title')}
          </h3>
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {t('components.securityContextSettings.sections.compliance.description')}
          </p>

          <div className="mt-4">
            {/* Compliance Frameworks */}
            <div>
              <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t('components.securityContextSettings.fields.complianceFrameworks.label')}
              </h3>
              <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                {t('components.securityContextSettings.fields.complianceFrameworks.tooltip')}
              </p>
              <div className="mt-2">
                <Select
                  multiple
                  options={complianceFrameworkOptions}
                  value={complianceFrameworks}
                  onChange={(value) => onFieldChange('complianceFrameworks', value)}
                  placeholder={t('components.securityContextSettings.fields.complianceFrameworks.placeholder')}
                  width="w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default SecurityContextSettings;

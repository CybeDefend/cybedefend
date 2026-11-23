import React from "react";
import { useTranslation } from "react-i18next";
import Select from "../../../../atoms/select/Select";
import Toggle from "../../../../atoms/toggle/Toggle";

export interface SecurityContextState {
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
}

export const DEFAULT_SECURITY_CONTEXT: SecurityContextState = {
  environment: "production",
  internetExposure: "public",
  deploymentType: "saas",
  dataClassification: "confidential",
  handlesPii: false,
  handlesPaymentData: false,
  businessCriticality: "medium",
  userBaseSize: "medium",
  complianceFrameworks: [],
  safetyCritical: false,
  networkSegmentation: "flat",
};

export function isSecurityContextCustomized(
  ctx: SecurityContextState,
): boolean {
  return (
    ctx.environment !== DEFAULT_SECURITY_CONTEXT.environment ||
    ctx.internetExposure !== DEFAULT_SECURITY_CONTEXT.internetExposure ||
    ctx.deploymentType !== DEFAULT_SECURITY_CONTEXT.deploymentType ||
    ctx.dataClassification !== DEFAULT_SECURITY_CONTEXT.dataClassification ||
    ctx.handlesPii !== DEFAULT_SECURITY_CONTEXT.handlesPii ||
    ctx.handlesPaymentData !== DEFAULT_SECURITY_CONTEXT.handlesPaymentData ||
    ctx.businessCriticality !== DEFAULT_SECURITY_CONTEXT.businessCriticality ||
    ctx.userBaseSize !== DEFAULT_SECURITY_CONTEXT.userBaseSize ||
    ctx.complianceFrameworks.length > 0 ||
    ctx.safetyCritical !== DEFAULT_SECURITY_CONTEXT.safetyCritical ||
    ctx.networkSegmentation !== DEFAULT_SECURITY_CONTEXT.networkSegmentation
  );
}

interface StepSecurityContextProps {
  value: SecurityContextState;
  onChange: (next: SecurityContextState) => void;
}

const StepSecurityContext: React.FC<StepSecurityContextProps> = ({
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const patch = (patch: Partial<SecurityContextState>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t("components.modal.createProject.step3.description")}
      </p>
      <Select
        label={t("components.securityContextSettings.fields.environment.label")}
        options={[
          { value: "production", label: t("components.securityContextSettings.fields.environment.options.production") },
          { value: "staging", label: t("components.securityContextSettings.fields.environment.options.staging") },
          { value: "development", label: t("components.securityContextSettings.fields.environment.options.development") },
        ]}
        value={value.environment}
        onChange={(v) => patch({ environment: v })}
        width="w-full"
      />
      <Select
        label={t("components.securityContextSettings.fields.internetExposure.label")}
        options={[
          { value: "public", label: t("components.securityContextSettings.fields.internetExposure.options.public") },
          { value: "internal", label: t("components.securityContextSettings.fields.internetExposure.options.internal") },
          { value: "airgapped", label: t("components.securityContextSettings.fields.internetExposure.options.airgapped") },
        ]}
        value={value.internetExposure}
        onChange={(v) => patch({ internetExposure: v })}
        width="w-full"
      />
      <Select
        label={t("components.securityContextSettings.fields.deploymentType.label")}
        options={[
          { value: "saas", label: t("components.securityContextSettings.fields.deploymentType.options.saas") },
          { value: "onprem", label: t("components.securityContextSettings.fields.deploymentType.options.onprem") },
          { value: "embedded", label: t("components.securityContextSettings.fields.deploymentType.options.embedded") },
          { value: "mobile", label: t("components.securityContextSettings.fields.deploymentType.options.mobile") },
        ]}
        value={value.deploymentType}
        onChange={(v) => patch({ deploymentType: v })}
        width="w-full"
      />
      <Select
        label={t("components.securityContextSettings.fields.dataClassification.label")}
        options={[
          { value: "public", label: t("components.securityContextSettings.fields.dataClassification.options.public") },
          { value: "internal", label: t("components.securityContextSettings.fields.dataClassification.options.internal") },
          { value: "confidential", label: t("components.securityContextSettings.fields.dataClassification.options.confidential") },
          { value: "regulated", label: t("components.securityContextSettings.fields.dataClassification.options.regulated") },
        ]}
        value={value.dataClassification}
        onChange={(v) => patch({ dataClassification: v })}
        width="w-full"
      />
      <Select
        label={t("components.securityContextSettings.fields.businessCriticality.label")}
        options={[
          { value: "low", label: t("components.securityContextSettings.fields.businessCriticality.options.low") },
          { value: "medium", label: t("components.securityContextSettings.fields.businessCriticality.options.medium") },
          { value: "high", label: t("components.securityContextSettings.fields.businessCriticality.options.high") },
          { value: "mission_critical", label: t("components.securityContextSettings.fields.businessCriticality.options.mission_critical") },
        ]}
        value={value.businessCriticality}
        onChange={(v) => patch({ businessCriticality: v })}
        width="w-full"
      />
      <Select
        label={t("components.securityContextSettings.fields.userBaseSize.label")}
        options={[
          { value: "small", label: t("components.securityContextSettings.fields.userBaseSize.options.small") },
          { value: "medium", label: t("components.securityContextSettings.fields.userBaseSize.options.medium") },
          { value: "large", label: t("components.securityContextSettings.fields.userBaseSize.options.large") },
        ]}
        value={value.userBaseSize}
        onChange={(v) => patch({ userBaseSize: v })}
        width="w-full"
      />
      <Select
        label={t("components.securityContextSettings.fields.networkSegmentation.label")}
        options={[
          { value: "flat", label: t("components.securityContextSettings.fields.networkSegmentation.options.flat") },
          { value: "segmented", label: t("components.securityContextSettings.fields.networkSegmentation.options.segmented") },
          { value: "microsegmented", label: t("components.securityContextSettings.fields.networkSegmentation.options.microsegmented") },
        ]}
        value={value.networkSegmentation}
        onChange={(v) => patch({ networkSegmentation: v })}
        width="w-full"
      />
      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-as-line">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t("components.securityContextSettings.fields.handlesPii.label")}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("components.securityContextSettings.fields.handlesPii.tooltip")}
          </p>
        </div>
        <Toggle
          enabled={value.handlesPii}
          onChange={(v) => patch({ handlesPii: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-as-line">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t("components.securityContextSettings.fields.handlesPaymentData.label")}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("components.securityContextSettings.fields.handlesPaymentData.tooltip")}
          </p>
        </div>
        <Toggle
          enabled={value.handlesPaymentData}
          onChange={(v) => patch({ handlesPaymentData: v })}
        />
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-as-line">
        <div>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {t("components.securityContextSettings.fields.safetyCritical.label")}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("components.securityContextSettings.fields.safetyCritical.tooltip")}
          </p>
        </div>
        <Toggle
          enabled={value.safetyCritical}
          onChange={(v) => patch({ safetyCritical: v })}
        />
      </div>
      <Select
        label={t("components.securityContextSettings.fields.complianceFrameworks.label")}
        multiple
        options={[
          { value: "SOC2", label: "SOC 2" },
          { value: "HIPAA", label: "HIPAA" },
          { value: "PCI_DSS", label: "PCI DSS" },
          { value: "GDPR", label: "GDPR" },
          { value: "ISO27001", label: "ISO 27001" },
        ]}
        value={value.complianceFrameworks}
        onChange={(v) => patch({ complianceFrameworks: v })}
        width="w-full"
      />
    </div>
  );
};

export default StepSecurityContext;

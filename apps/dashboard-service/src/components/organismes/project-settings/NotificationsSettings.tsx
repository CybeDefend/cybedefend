import React from "react";
import Card from "../../atoms/card/Card";
import Toggle from "../../atoms/toggle/Toggle";
import Checkbox from "../../atoms/checkbox/Checkbox";
import { useTranslation } from "react-i18next";
import SlackChannelSelector from "../../molecules/slack/SlackChannelSelector";
import { Slot } from "@/edition/slots";

import { AS_PANEL_TITLE, AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SCANNER_TYPES = ["sast", "sca", "iac", "container"] as const;

interface NotificationsSettingsProps {
  // Project & Slack connection
  projectId: string;
  isSlackConnected: boolean;
  slackChannelName: string;
  onConfigureSlackChannel: () => void;
  onSlackChannelChange: (channelName: string) => void;

  // Severity threshold
  notifSeverityThreshold: string[];
  onSeverityThresholdChange: (severities: string[]) => void;

  // Scanner types filter
  notifScannerTypes: string[];
  onScannerTypesChange: (types: string[]) => void;

  /** The project payload the settings page loaded, handed to the notifications the active edition adds. */
  project?: unknown;

  // Scan complete
  scanCompleteEmailEnabled: boolean;
  onScanCompleteEmailToggle: () => void;
  scanCompleteSlackEnabled: boolean;
  onScanCompleteSlackToggle: () => void;

  // Reports
  weeklyReportEnabled: boolean;
  onWeeklyReportToggle: () => void;
  weeklyReportSlackEnabled: boolean;
  onWeeklyReportSlackToggle: () => void;

  monthlyReportEnabled: boolean;
  onMonthlyReportToggle: () => void;
  monthlyReportSlackEnabled: boolean;
  onMonthlyReportSlackToggle: () => void;
}

const SeverityChips: React.FC<{
  selected: string[];
  onChange: (severities: string[]) => void;
}> = ({ selected, onChange }) => {
  const severityColors: Record<string, string> = {
    critical: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-400/30",
    high: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-400/30",
    medium: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-300 dark:border-yellow-400/30",
    low: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-400/30",
  };

  const toggle = (severity: string) => {
    if (selected.includes(severity)) {
      onChange(selected.filter((s) => s !== severity));
    } else {
      onChange([...selected, severity]);
    }
  };

  return (
    <div className="flex gap-2 flex-wrap">
      {SEVERITIES.map((severity) => {
        const isSelected = selected.includes(severity);
        return (
          <button
            key={severity}
            type="button"
            onClick={() => toggle(severity)}
            className={`relative inline-flex h-7 items-center rounded-md px-2.5 text-[13px] font-medium border transition-colors duration-[120ms] ${AS_FOCUS} ${AS_TOUCH} ${
              isSelected
                ? severityColors[severity]
                : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-300 dark:bg-as-raised dark:text-zinc-400 dark:border-as-line-strong dark:hover:border-white/[0.2]"
            }`}
          >
            {severity.charAt(0).toUpperCase() + severity.slice(1)}
          </button>
        );
      })}
    </div>
  );
};

const ChannelToggleRow: React.FC<{
  label: string;
  emailEnabled: boolean;
  onEmailToggle: () => void;
  slackEnabled: boolean;
  onSlackToggle: () => void;
  isSlackConnected: boolean;
}> = ({
  label,
  emailEnabled,
  onEmailToggle,
  slackEnabled,
  onSlackToggle,
  isSlackConnected,
}) => {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-zinc-800 dark:text-zinc-200">{label}</span>
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Email</span>
          <Toggle enabled={emailEnabled} onChange={onEmailToggle} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Slack</span>
          <div className={!isSlackConnected ? "opacity-50 pointer-events-none" : ""}>
            <Toggle enabled={slackEnabled} onChange={onSlackToggle} />
          </div>
        </div>
      </div>
    </div>
  );
};

const NotificationsSettings: React.FC<NotificationsSettingsProps> = ({
  projectId,
  isSlackConnected,
  slackChannelName,
  onConfigureSlackChannel,
  onSlackChannelChange,

  notifSeverityThreshold,
  onSeverityThresholdChange,

  notifScannerTypes,
  onScannerTypesChange,

  project,

  scanCompleteEmailEnabled,
  onScanCompleteEmailToggle,
  scanCompleteSlackEnabled,
  onScanCompleteSlackToggle,

  weeklyReportEnabled,
  onWeeklyReportToggle,
  weeklyReportSlackEnabled,
  onWeeklyReportSlackToggle,

  monthlyReportEnabled,
  onMonthlyReportToggle,
  monthlyReportSlackEnabled,
  onMonthlyReportSlackToggle,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Slack Channel */}
      <Card>
        <div className="space-y-4">
          <h3 className={AS_PANEL_TITLE}>
            {t("components.notificationsSettings.slackChannel")}
          </h3>
          {isSlackConnected ? (
            <SlackChannelSelector
              projectId={projectId}
              currentChannelName={slackChannelName}
              onChannelChange={onSlackChannelChange}
            />
          ) : (
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t("components.notificationsSettings.connectSlackHint")}
            </p>
          )}
        </div>
      </Card>

      {/* Filters */}
      <Card>
        <div className="space-y-6">
          <h3 className={AS_PANEL_TITLE}>
            {t("components.notificationsSettings.filters")}
          </h3>

          {/* Severity threshold */}
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
              {t("components.notificationsSettings.severityThreshold")}
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("components.notificationsSettings.severityThresholdDescription")}
            </p>
            <SeverityChips
              selected={notifSeverityThreshold}
              onChange={onSeverityThresholdChange}
            />
          </div>

          {/* Scanner types */}
          <div className="space-y-2">
            <label className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
              {t("components.notificationsSettings.scannerTypes")}
            </label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("components.notificationsSettings.scannerTypesDescription")}
            </p>
            <div className="flex gap-4 flex-wrap">
              {SCANNER_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  name="scannerTypes"
                  value={type}
                  checked={notifScannerTypes.includes(type)}
                  onChange={() => {
                    if (notifScannerTypes.includes(type)) {
                      onScannerTypesChange(
                        notifScannerTypes.filter((t) => t !== type)
                      );
                    } else {
                      onScannerTypesChange([...notifScannerTypes, type]);
                    }
                  }}
                  label={type.toUpperCase()}
                />
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* The notifications the active edition adds (the cloud's zero-day alerts). */}
      <Slot
        name="project.settings.notifications"
        context={{ projectId, project, isSlackConnected }}
      />

      {/* Scan Complete */}
      <Card>
        <div className="space-y-4">
          <div>
            <h3 className={AS_PANEL_TITLE}>
              {t("components.notificationsSettings.scanComplete")}
            </h3>
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t("components.notificationsSettings.scanCompleteDescription")}
            </p>
          </div>
          <ChannelToggleRow
            label={t("components.notificationsSettings.scanComplete")}
            emailEnabled={scanCompleteEmailEnabled}
            onEmailToggle={onScanCompleteEmailToggle}
            slackEnabled={scanCompleteSlackEnabled}
            onSlackToggle={onScanCompleteSlackToggle}
            isSlackConnected={isSlackConnected}
          />
        </div>
      </Card>

      {/* Reports */}
      <Card>
        <div className="space-y-4">
          <h3 className={AS_PANEL_TITLE}>
            {t("components.notificationsSettings.reports")}
          </h3>
          <ChannelToggleRow
            label={t("components.notificationsSettings.weeklyReport")}
            emailEnabled={weeklyReportEnabled}
            onEmailToggle={onWeeklyReportToggle}
            slackEnabled={weeklyReportSlackEnabled}
            onSlackToggle={onWeeklyReportSlackToggle}
            isSlackConnected={isSlackConnected}
          />
          <ChannelToggleRow
            label={t("components.notificationsSettings.monthlyReport")}
            emailEnabled={monthlyReportEnabled}
            onEmailToggle={onMonthlyReportToggle}
            slackEnabled={monthlyReportSlackEnabled}
            onSlackToggle={onMonthlyReportSlackToggle}
            isSlackConnected={isSlackConnected}
          />
        </div>
      </Card>
    </div>
  );
};

export default NotificationsSettings;

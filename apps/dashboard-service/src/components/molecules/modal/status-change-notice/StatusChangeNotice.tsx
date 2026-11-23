import React from "react";
import { AlertTriangle, Info } from "../../../atoms/icon/icons";

const VARIANTS = {
  warning: {
    role: "alert",
    Icon: AlertTriangle,
    box: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-900/20 dark:text-amber-300",
    icon: "text-amber-600 dark:text-amber-400",
  },
  info: {
    role: "status",
    Icon: Info,
    box: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/20 dark:bg-blue-900/20 dark:text-blue-300",
    icon: "text-blue-600 dark:text-blue-400",
  },
};

interface StatusChangeNoticeProps {
  /** `warning` is announced at once (`role="alert"`), `info` politely (`role="status"`). */
  variant: keyof typeof VARIANTS;
  children: React.ReactNode;
}

/**
 * Shown under the status select of the vulnerability update modals: what the
 * picked status means for the next scans. A warning for `resolved` (reopened
 * when detected again), information for `ignored` (kept).
 */
const StatusChangeNotice: React.FC<StatusChangeNoticeProps> = ({ variant, children }) => {
  const { role, Icon, box, icon } = VARIANTS[variant];
  return (
    <div role={role} className={`mt-2 flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${box}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${icon}`} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
};

export default StatusChangeNotice;

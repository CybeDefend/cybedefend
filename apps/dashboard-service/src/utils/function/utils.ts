
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isIP } from "is-ip";
import { formatDistanceToNow, isPast } from "date-fns";
// The app's default i18next instance (initialised by src/i18n at boot): importing
// '@/i18n' here would pull react-i18next's init into every test that mocks it.
import i18n from 'i18next';

export const getSeverityColor = (severity: string) => {
  const severityLower = severity.toLowerCase();
  switch (severityLower) {
    case "critical":
      return {
        bgColor: "bg-red-100",
        textColor: "text-red-800",
        darkBgColor: "dark:bg-red-900",
        darkTextColor: "dark:text-red-200",
      };
    case "high":
      return {
        bgColor: "bg-orange-100",
        textColor: "text-orange-800",
        darkBgColor: "dark:bg-orange-900",
        darkTextColor: "dark:text-orange-200",
      };
    case "medium":
      return {
        bgColor: "bg-yellow-100",
        textColor: "text-yellow-800",
        darkBgColor: "dark:bg-yellow-900",
        darkTextColor: "dark:text-yellow-200",
      };
    default:
      return {
        bgColor: "bg-blue-100",
        textColor: "text-blue-800",
        darkBgColor: "dark:bg-blue-900",
        darkTextColor: "dark:text-blue-300",
      };
  }
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isExpiringIn = (expirationDate: Date): { message: string, expired: boolean } => {
  if (isPast(expirationDate)) {
    return { message: "This key has expired", expired: true };
  }

  const timeLeft = formatDistanceToNow(expirationDate, { addSuffix: true });

  return { message: `Expires ${timeLeft}`, expired: false };
};

export const getSeverityLabel = (severity: string) => {
  switch (severity.toLowerCase()) {
    case "critical":
      return "C";
    case "high":
      return "H";
    case "medium":
      return "M";
    default:
      return "L";
  }
};

/**
 * The Badge variant of a severity string (`CRITICAL` → `critical`). Anything
 * unknown reads as low, the same fallback `getSeverityColor` applies.
 */
export const getSeverityVariant = (severity: string): 'critical' | 'high' | 'medium' | 'low' => {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      return 'low';
  }
};

export const getStatusLabel = (status: string) => {
  if (!status) return '';
  const key = status.toLowerCase();
  const translationKey = `components.analyseWrapper.status.labels.${key}`;
  const translated = i18n.t(translationKey);
  if (translated && translated !== translationKey) return translated;
  // Fallback static (previous logic) if translation fragment missing
  switch (key) {
    case 'to_verify': return 'To Verify';
    case 'not_exploitable': return 'Not Exploitable';
    case 'resolved': return 'Resolved';
    case 'confirmed': return 'Confirmed';
    case 'proposed_not_exploitable': return 'Proposed Not Exploitable';
    case 'waiting_for_file': return 'Waiting for File';
    case 'ignored': return 'Ignored';
    case 'failed': return 'Failed';
    case 'completed': return 'Completed';
    case 'completed_degraded': return 'Completed (Degraded)';
    case 'running': return 'Running';
    case 'queued': return 'Queued';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
};

/** The locale keys of the five priorities, which the issue page's scoring card also prints. */
const PRIORITY_LABEL_KEYS: Record<string, string> = {
  critical_urgent: 'pages.issuePage.scoring.decomposition.priority.criticalUrgent',
  urgent: 'pages.issuePage.scoring.decomposition.priority.urgent',
  normal: 'pages.issuePage.scoring.decomposition.priority.normal',
  low: 'pages.issuePage.scoring.decomposition.priority.low',
  very_low: 'pages.issuePage.scoring.decomposition.priority.veryLow',
};

/**
 * A priority in the interface language. A value the API adds later is shown
 * as it came, never as a dotted key.
 */
export const getPriorityLabel = (priority: string) => {
  const key = Object.prototype.hasOwnProperty.call(PRIORITY_LABEL_KEYS, priority.toLowerCase())
    ? PRIORITY_LABEL_KEYS[priority.toLowerCase()]
    : null;
  return key ? i18n.t(key) : priority;
};

/** « 8 October 2026 » / « 8 octobre 2026 »: in the interface language. */
export const convertDate = (date: string) => {
  const locale = (i18n.language || 'en').toLowerCase().startsWith('fr') ? 'fr-FR' : 'en-GB';
  return new Date(date).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

export const clearScannerStorage = () => {
  Object.keys(localStorage).forEach((key) => {
    if (
      key.startsWith("selectedSeveritySast_") ||
      key.startsWith("selectedStatusSast_") ||
      key.startsWith("selectedPrioritySast_") ||
      key.startsWith("selectedOrderSast_") ||
      key.startsWith("selectedOrderDirectionSast_") ||
      key.startsWith("pageSizeSast_") ||
      key.startsWith("currentPageSast_") ||
      key.startsWith("selectedSeverityIac_") ||
      key.startsWith("selectedStatusIac_") ||
      key.startsWith("selectedPriorityIac_") ||
      key.startsWith("selectedOrderIac_") ||
      key.startsWith("selectedOrderDirectionIac_") ||
      key.startsWith("pageSizeIac_") ||
      key.startsWith("currentPageIac_") ||
      key.startsWith("selectedSeveritySca_") ||
      key.startsWith("selectedStatusSca_") ||
      key.startsWith("selectedPrioritySca_") ||
      key.startsWith("selectedOrderSca_") ||
      key.startsWith("selectedOrderDirectionSca_") ||
      key.startsWith("pageSizeSca_") ||
      key.startsWith("currentPageSca_")
    ) {
      localStorage.removeItem(key);
    }
  });
};

export const isValidIpOrCidr = (input: string): boolean => {
  
  if (isIP(input)) {
    return true;
  }

  
  if (!input.includes('/')) {
    return false;
  }

  
  const [ipPart, cidrPart] = input.split('/');
  
  
  const cidrNum = parseInt(cidrPart, 10);
  if (isNaN(cidrNum) || cidrPart !== cidrNum.toString()) {
    return false;
  }

  
  if (!isIP(ipPart)) {
    return false;
  }

  
  if (ipPart.includes('.')) {
    return cidrNum >= 0 && cidrNum <= 32;
  }

  
  if (ipPart.includes(':')) {
    return cidrNum >= 0 && cidrNum <= 128;
  }

  return false;
};

/**
 * Resolve the worst exploitability verdict from a list of
 * occurrences. The ordering matches the visual severity of the verdicts
 * (red > amber > green > gray) so a group with at least one actively
 * exploited finding renders in red even if its other occurrences are
 * non-exploitable. Returns null when no occurrence has been evaluated.
 */
export const getWorstExploitabilityVerdict = (
  occurrences: Array<{ exploitabilityVerdict?: string | null }> | undefined,
): 'malicious' | 'actively_exploited' | 'proven' | 'theoretical' | 'not_exploitable' | null => {
  if (!occurrences || occurrences.length === 0) return null;
  // 'malicious' (malware) outranks every other verdict.
  const order: Array<
    'malicious' | 'actively_exploited' | 'proven' | 'theoretical' | 'not_exploitable'
  > = ['malicious', 'actively_exploited', 'proven', 'theoretical', 'not_exploitable'];
  for (const verdict of order) {
    if (occurrences.some((o) => o.exploitabilityVerdict === verdict)) {
      return verdict;
    }
  }
  return null;
};
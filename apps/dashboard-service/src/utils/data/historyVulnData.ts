export const statusOptions = [
  {
    value: "to_verify",
    label: "TO VERIFY",
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  {
    value: "not_exploitable",
    label: "NOT EXPLOITABLE",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
  {
    value: "proposed_not_exploitable",
    label: "PROPOSED NOT EXPLOITABLE",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
  {
    value: "confirmed",
    label: "CONFIRMED",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  {
    value: "ignored",
    label: "IGNORED",
    color: "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300",
  },
  {
    value: "resolved",
    label: "RESOLVED",
    color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  },
];

// The two values derived from exploitability, removed from editing AND from
// filtering. Kept in `statusOptions` (above) ONLY to display badges
// (HistoryTimeline + status column), since the immutable history may still
// refer to them.
const LEGACY_EXPLOITABILITY_STATUSES = [
  "not_exploitable",
  "proposed_not_exploitable",
];

/**
 * Statuses offered for EDITING (update popup + batch update).
 * `not_exploitable` / `proposed_not_exploitable` were removed: they belong to
 * the exploitability verdict, not the lifecycle. The legacy values stay in
 * `statusOptions` (above) for display.
 */
export const settableStatusOptions = statusOptions.filter((o) =>
  ["to_verify", "confirmed", "ignored", "resolved"].includes(o.value),
);

/**
 * Statuses offered for FILTERING (the vulnerability lists' dropdown).
 * The displayed ones minus the statuses derived from exploitability: no
 * detection carries `not_exploitable` / `proposed_not_exploitable` as its
 * `currentState` any more, so offering them as a filter makes no sense.
 * Exploitability is filtered through `exploitabilityOptions`.
 */
export const filterStatusOptions = statusOptions.filter(
  (o) => !LEGACY_EXPLOITABILITY_STATUSES.includes(o.value),
);

const VALID_STATUS_FILTER_VALUES = filterStatusOptions.map((o) => o.value);

/**
 * Keeps only the statuses still valid as a filter. Required for persisted
 * values (localStorage) or `?status=` deep links that may still carry
 * `not_exploitable` / `proposed_not_exploitable`: the gateway DTO refuses them
 * with a 400. The input order is kept.
 */
export const sanitizeStatusFilter = (values: string[]): string[] =>
  Array.isArray(values)
    ? values.filter((v) => VALID_STATUS_FILTER_VALUES.includes(v))
    : [];

export const priorityOptions = [
  {
    value: "critical_urgent",
    label: "CRITICAL URGENT",
    color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  {
    value: "urgent",
    label: "URGENT",
    color:
      "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  },
  {
    value: "normal",
    label: "NORMAL",
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  },
  {
    value: "low",
    label: "LOW",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
  {
    value: "very_low",
    label: "VERY LOW",
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  },
];

/**
 * The billing feature key that covers the issue trackers Jira and Linear.
 *
 * Plans disable it under `features_disabled` (billing's
 * `getMinPlanForFeature`), and there is one key for both trackers: a plan that
 * has no Jira has no Linear either. Linear has no key of its own on purpose,
 * since billing would have to learn it before any plan could turn it off.
 *
 * Checked on the calls that create or link a ticket (Jira and Linear
 * CreateIssues, LinkExistingIssue), never on the reads and syncs.
 */
export const ISSUE_TRACKER_FEATURE = 'jira';

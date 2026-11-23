/**
 * Pure recipient-resolution for consolidated report emails.
 *
 * Given the (user, project) access pairs for an organization's report-enabled
 * projects, produce one recipient per user who:
 *   - has the user-level "Email Notifications" toggle enabled, AND
 *   - can access at least one of the report's projects,
 * each carrying only the subset of projects they can access (so the email's
 * overview reflects exactly what that user is allowed to see).
 *
 * Kept dependency-free so it can be unit-tested without a database.
 */
export interface ProjectAccessPair {
  userId: string;
  email: string;
  notification: boolean;
  projectId: string;
}

export interface ReportRecipient<T> {
  userId: string;
  email: string;
  projects: T[];
}

export function buildReportRecipients<T extends { projectId: string }>(
  accessPairs: ProjectAccessPair[],
  projects: T[],
): ReportRecipient<T>[] {
  const reportProjectIds = new Set(projects.map((p) => p.projectId));

  const byUser = new Map<
    string,
    { email: string; notification: boolean; projectIds: Set<string> }
  >();

  for (const pair of accessPairs) {
    // Ignore access to projects that aren't part of this report.
    if (!reportProjectIds.has(pair.projectId)) continue;

    let entry = byUser.get(pair.userId);
    if (!entry) {
      entry = {
        email: pair.email,
        notification: pair.notification,
        projectIds: new Set<string>(),
      };
      byUser.set(pair.userId, entry);
    }
    entry.projectIds.add(pair.projectId);
  }

  const recipients: ReportRecipient<T>[] = [];
  for (const [userId, entry] of byUser) {
    if (!entry.notification) continue;
    // Preserve the report's project order, deduplicated by the Set above.
    const subset = projects.filter((p) => entry.projectIds.has(p.projectId));
    if (subset.length === 0) continue;
    recipients.push({ userId, email: entry.email, projects: subset });
  }

  return recipients;
}

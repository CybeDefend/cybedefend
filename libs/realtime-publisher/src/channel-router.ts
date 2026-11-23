type Env = {
  type: string;
  scope: {
    organizationId?: string;
    projectId?: string;
    teamId?: string;
    userId?: string;
    vulnerabilityId?: string;
    jobId?: string;
  };
};

export function resolveChannels(env: Env): string[] {
  const o = env.scope.organizationId, p = env.scope.projectId, t = env.scope.teamId;
  const v = env.scope.vulnerabilityId;
  const j = env.scope.jobId;
  switch (env.type) {
    case 'SCAN_STATUS_CHANGED':
      return [
        `cybe:event:org:${o}:projects`,
        `cybe:event:project:${p}:issues`,
        `cybe:event:project:${p}:stats`,
        `cybe:event:org:${o}:overview`,
      ];
    case 'VULNERABILITY_BATCH_APPENDED':
      return [
        `cybe:event:project:${p}:issues`,
        `cybe:event:project:${p}:stats`,
        ...(o ? [`cybe:event:org:${o}:overview`] : []),
      ];
    case 'PROJECT_STATE_CHANGED':
      return [
        `cybe:event:org:${o}:projects`,
        `cybe:event:org:${o}:overview`,
      ];
    case 'POLICY_EVALUATION_COMPLETED':
      return [
        `cybe:event:project:${p}:policies`,
        `cybe:event:project:${p}:issues`,
        `cybe:event:project:${p}:stats`,
        ...(o ? [`cybe:event:org:${o}:overview`] : []),
      ];
    case 'ZERO_DAY_DETECTED': {
      const channels: string[] = [];
      if (o) {
        channels.push(`cybe:event:org:${o}:projects`);
        channels.push(`cybe:event:org:${o}:overview`);
      }
      if (p) {
        channels.push(`cybe:event:project:${p}:issues`);
        channels.push(`cybe:event:project:${p}:stats`);
      }
      return channels;
    }
    case 'VULNERABILITY_UPDATED':
      // Single-vulnerability detail page subscribes to a per-vuln channel that
      // is nested under the vulnerability's project, like every other project
      // stream: the gateway builds it from the Permify-authorized :projectId, so
      // a vulnerability id of another project never matches a published
      // channel. Never emit an unscoped per-vulnerability channel, even without
      // a projectId (then there is no per-vuln channel at all). The issues list also wants to
      // refresh because a status/priority change affects the visible row.
      return [
        ...(p && v ? [`cybe:event:project:${p}:vuln:${v}`] : []),
        ...(p ? [`cybe:event:project:${p}:issues`] : []),
      ];
    case 'REPORT_READY':
      // Report generation finished (async, worker side). The project
      // Reports page subscribes to this channel and refetches a fresh signed
      // download URL by report id.
      return p ? [`cybe:event:project:${p}:reports`] : [];
    case 'AGGREGATED_REPORT_READY':
      // Aggregated report generation finished. Team scope routes to the team
      // reports channel; org + batch route to the org reports channel. The
      // dashboard subscribes to the scope it generated for and matches by
      // reportId.
      return t
        ? [`cybe:event:team:${t}:reports`]
        : o
          ? [`cybe:event:org:${o}:reports`]
          : [];
    case 'AGENT_STEP_CHANGED':
    // Refetch trigger for the Results page's scan pipeline (scanner lane, AI
    // queue, analysis progress); same Permify-scoped channel as the agent step.
    case 'SCAN_PIPELINE_CHANGED':          return p ? [`cybe:event:project:${p}:issues`] : [];
    case 'STATS_AGGREGATE_CHANGED':        return p ? [`cybe:event:project:${p}:stats`] : [`cybe:event:org:${o}:overview`];
    case 'MEMBERSHIP_CHANGED':             return t ? [`cybe:event:membership`, `cybe:event:team:${t}`] : [`cybe:event:membership`, `cybe:event:org:${o}:members`];
    case 'TRIAL_UPDATED':
    case 'SUBSCRIPTION_CHANGED':
    case 'USAGE_UPDATED':
    case 'VIBEDEFEND_USAGE_UPDATED':       return [`cybe:event:billing:org:${o}`];
    case 'ASYNC_TASK_PROGRESS':
    case 'ASYNC_TASK_COMPLETED':
      // Background-job progress + terminal events. One channel per task; the
      // gateway relays it over an ownership-guarded per-task SSE stream that the
      // dashboard's background-tasks tracker subscribes to while the job runs.
      return j ? [`cybe:event:job:${j}`] : [];
    default:                               return [];
  }
}

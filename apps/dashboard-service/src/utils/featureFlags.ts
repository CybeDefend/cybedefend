// Per-page realtime SSE feature flags. Defaults: all ON.
// Env vars `VITE_REALTIME_*` can override (set to "false" to disable a page).
export const features = {
  realtime: {
    projectList: readBool('VITE_REALTIME_PROJECT_LIST', true),
    issues: readBool('VITE_REALTIME_ISSUES', true),
    trial: readBool('VITE_REALTIME_TRIAL', true),
    projectStats: readBool('VITE_REALTIME_PROJECT_STATS', true),
    orgOverview: readBool('VITE_REALTIME_ORG_OVERVIEW', true),
    policies: readBool('VITE_REALTIME_POLICIES', true),
    members: readBool('VITE_REALTIME_MEMBERS', true),
    teams: readBool('VITE_REALTIME_TEAMS', true),
  },
} as const;

function readBool(envKey: string, fallback: boolean): boolean {
  try {
    // Vite exposes import.meta.env.VITE_*
    const v = (import.meta as any)?.env?.[envKey];
    if (v === 'true' || v === true) return true;
    if (v === 'false' || v === false) return false;
  } catch {}
  return fallback;
}

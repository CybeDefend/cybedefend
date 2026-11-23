export type AgentStep = {
  kind?: string;
  phase?: "ingestion" | "analysis" | "vuln" | "prioritization" | string;
  action?: "start" | "result" | "error" | "done" | "decided" | string;
  progress?: number; // 0..100 when known
  processed?: number;
  total?: number;
  index?: number; // 1-based index (i in i/N) when available
  count?: number; // prioritization count
  degraded?: boolean;
  projectId?: string;
  vulnerabilityId?: string;
  verdict?: "TP" | "FP" | string;
  statusSet?: "confirmed" | "ignored" | "" | string;
  confidence?: number;
  reasoning?: string;
  signals?: Record<string, any>;
  assignments?: Array<{ vulnerabilityId: string; priority: string }>;
  error?: string;
  message?: string;
  raw?: string;
  timestamp?: string | number;
  // Optional totals breakdown when available
  tp?: number;
  fp?: number;
  err?: number;
  lastVulnerabilityId?: string;
};

// Try to parse a step which can be either plain text or a JSON string
export function parseAgentStep(step: string | undefined | null): AgentStep | null {
  if (!step) return null;
  const raw = String(step);

  // Prefer robust JSON payloads. Avoid brittle text heuristics.
  try {
    const maybe = JSON.parse(raw);
    if (maybe && typeof maybe === 'object') {
      const m: any = maybe;
  const processed: number | undefined = m.processed ?? m?.totals?.processed;
  const total: number | undefined = m.total ?? m?.totals?.total;
      let progress: number | undefined = typeof m.progress === 'number' ? m.progress : undefined;
      if (progress === undefined && typeof processed === 'number' && typeof total === 'number' && total > 0) {
        progress = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
      }

      // Derive phase based on stable signals first, then fall back
      const hasAssignments = Array.isArray(m.assignments) && m.assignments.length > 0;
      const vulnId: string | undefined = m.vulnerabilityId || m.vulnId || m.id;
      let phase: AgentStep["phase"] | undefined = m.phase || m.stage;
      if (!phase) {
        if (hasAssignments) phase = 'prioritization';
        else if (vulnId) phase = 'vuln';
      }
      const action: AgentStep["action"] = m.action || m.status || (hasAssignments ? 'decided' : undefined);

      const step: AgentStep = {
        kind: m.kind,
        phase,
        action,
        processed,
        total,
        index: m.index,
        count: m.count,
        degraded: m.degraded,
        projectId: m.projectId,
        vulnerabilityId: vulnId,
        verdict: m.verdict,
        statusSet: m.statusSet,
        confidence: m.confidence,
        reasoning: m.reasoning,
        signals: m.signals,
        assignments: m.assignments,
        error: m.error,
        timestamp: m.timestamp,
        progress,
        tp: m?.totals?.tp,
        fp: m?.totals?.fp,
        err: m?.totals?.err,
        lastVulnerabilityId: m?.lastVulnerabilityId,
        message: compactMessage({ kind: m.kind, phase, action }) || raw,
        raw,
      };
      return step;
    }
  } catch {}

  // Fallback: attempt to extract key info from truncated JSON-like strings
  try {
    const phaseMatch = /\"phase\"\s*:\s*\"([^\"]+)\"/.exec(raw);
    const actionMatch = /\"action\"\s*:\s*\"([^\"]+)\"/.exec(raw);
    const processedMatch = /\"processed\"\s*:\s*(\d+)/.exec(raw);
    const totalMatch = /\"total\"\s*:\s*(\d+)/.exec(raw);
    const tpMatch = /\"tp\"\s*:\s*(\d+)/.exec(raw);
    const fpMatch = /\"fp\"\s*:\s*(\d+)/.exec(raw);
    const errMatch = /\"err\"\s*:\s*(\d+)/.exec(raw);
    const vulnMatch = /\"lastVulnerabilityId\"\s*:\s*\"([^\"]+)\"/.exec(raw) || /\"vulnerabilityId\"\s*:\s*\"([^\"]+)\"/.exec(raw);

    const processed = processedMatch ? parseInt(processedMatch[1], 10) : undefined;
    const total = totalMatch ? parseInt(totalMatch[1], 10) : undefined;
    let progress: number | undefined;
    if (typeof processed === 'number' && typeof total === 'number' && total > 0) {
      progress = Math.max(0, Math.min(100, Math.round((processed / total) * 100)));
    }

    const phase = phaseMatch ? phaseMatch[1] : undefined;
    const action = actionMatch ? actionMatch[1] : undefined;
    const tp = tpMatch ? parseInt(tpMatch[1], 10) : undefined;
    const fp = fpMatch ? parseInt(fpMatch[1], 10) : undefined;
    const err = errMatch ? parseInt(errMatch[1], 10) : undefined;
    const vulnId = vulnMatch ? vulnMatch[1] : undefined;

    if (phase || action || processed || total || tp || fp || err || vulnId) {
      return {
        phase,
        action,
        processed,
        total,
        progress,
        tp,
        fp,
        err,
        lastVulnerabilityId: vulnId,
        message: compactMessage({ phase, action }) || undefined,
        raw,
      } as AgentStep;
    }
  } catch {}

  // Handle plain-text steps like "parsing_completed", "agent: parsing in progress"
  const lower = raw.toLowerCase();
  if (lower.includes('parsing')) {
    const isDone = lower.includes('completed') || lower.includes('done') || lower.includes('finished');
    return { phase: 'parsing', action: isDone ? 'done' : 'in_progress', message: undefined, raw };
  }
  if (lower.includes('ingestion') || lower.includes('ingesting')) {
    const isDone = lower.includes('completed') || lower.includes('done') || lower.includes('finished');
    return { phase: 'ingestion', action: isDone ? 'done' : 'in_progress', message: undefined, raw };
  }

  // Last resort: do not surface raw JSON to the UI
  return { message: undefined, raw };
}

export function extractLatestAgentFromContainers(containers: Array<{ step?: string; status?: string; finishedAt?: string }> = []): AgentStep | null {
  // Prefer running containers, else last updated completed
  const running = containers.filter(c => c.status === 'running');
  const source = running.length > 0 ? running : containers;
  for (let i = 0; i < source.length; i++) {
    const s = source[i]?.step;
    const parsed = parseAgentStep(s);
    if (parsed && (parsed.kind || parsed.message)) return parsed;
  }
  return null;
}

function compactMessage(p: { kind?: string; phase?: string; action?: string }) {
  const parts = [p.phase, p.action].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

// Determine whether a container represents an agentic step
export function isAgentContainer(container: { step?: string; image?: string } | null | undefined): boolean {
  if (!container) return false;
  // Primary signal: image name
  const image = String(container.image || '').toLowerCase();
  if (image.includes('agent-service')) return true;

  // Fallback: infer from step content when image is not available
  const parsed = parseAgentStep(container.step);
  if (parsed?.kind && String(parsed.kind).toLowerCase().includes('agent')) return true;
  if (parsed?.message && String(parsed.message).toLowerCase().includes('agent')) return true;
  if (parsed?.phase && ['ingestion','analysis','vuln','prioritization'].includes(String(parsed.phase))) return true;
  return false;
}

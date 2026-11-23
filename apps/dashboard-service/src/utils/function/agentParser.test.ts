import { describe, it, expect } from 'vitest';
import { extractLatestAgentFromContainers, parseAgentStep } from './agentParser';

// The step the agent service writes for a finding that got a verdict:
// one update instead of three, so it now carries the counters the separate
// `agent: analyzed N/total` step used to. The string is the agent's own
// `json.dumps(...)` output, Python separators included.
const RESULT_STEP =
  '{"kind": "agent_progress", "phase": "vuln", "action": "result", "processed": 3, "total": 12, ' +
  '"vulnerabilityId": "00000000-0000-7000-8000-000000000052", "verdict": "FP", ' +
  '"statusSet": "ignored", "confidence": 0.85}';

describe('parseAgentStep – the verdict step of an analysis', () => {
  it('fits the 240 characters the agent keeps of a step', () => {
    expect(RESULT_STEP.length).toBeLessThanOrEqual(240);
  });

  it('gives the progress, the phase and the finding', () => {
    const step = parseAgentStep(RESULT_STEP);

    expect(step).toMatchObject({
      kind: 'agent_progress',
      phase: 'vuln',
      action: 'result',
      processed: 3,
      total: 12,
      progress: 25,
      vulnerabilityId: '00000000-0000-7000-8000-000000000052',
      verdict: 'FP',
      statusSet: 'ignored',
      confidence: 0.85,
    });
  });

  it('is what the running agent container reports', () => {
    const step = extractLatestAgentFromContainers([
      { status: 'completed', step: 'completed' },
      { status: 'running', step: RESULT_STEP },
    ]);

    expect(step?.vulnerabilityId).toBe('00000000-0000-7000-8000-000000000052');
    expect(step?.progress).toBe(25);
  });

  it('lost its finding when the agent cut it at 240 characters', () => {
    // The older, longer step (286 characters with full ids) always reached the
    // dashboard cut: no JSON, and the fallback names no `vulnerabilityId`.
    const cut =
      '{"kind": "agent_progress", "phase": "vuln", "action": "result", "projectId": ' +
      '"00000000-0000-7000-8000-000000000040", "vulnerabilityId": ' +
      '"00000000-0000-7000-8000-000000000052", "verdict": "TP", "statusSet": "confirmed", "confiden [truncated]';

    const step = parseAgentStep(cut);

    expect(step?.vulnerabilityId).toBeUndefined();
    expect(step?.progress).toBeUndefined();
  });
});

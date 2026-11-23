import { HistoryItem } from '../../entities/history-item.entity';

/**
 * Agent audit propagation for HistoryItem rows.
 *
 * The gateway forwards three optional ids on every {@link UpdateResultRequest}
 * when the mutation is triggered by a confirmed HITL chat tool call:
 *   - ``agentToolCallId``       — stable id of the tool call inside one stream
 *   - ``agentConversationId``   — owner conversation
 *   - ``agentStreamId``         — SSE stream that proposed the action
 *
 * Persisting them on the resulting {@link HistoryItem} lets analysts pivot
 * back from a vulnerability history row to the chat conversation that
 * caused the change. The {@link HistoryItem.source} discriminator tells the
 * UI/cron whether to treat the row as a manual override that must not be
 * recomputed for 7 days.
 */

export type HistorySource =
  | 'chat_agent_assisted'
  | 'dashboard_manual'
  | 'system';

const SYSTEM_USER_IDS = new Set(['system', 'cron', '']);

interface AgentAuditFields {
  userId?: string;
  agentToolCallId?: string;
  agentConversationId?: string;
  agentStreamId?: string;
}

/** Decide which {@link HistorySource} applies to a given mutation. */
export function resolveHistorySource(
  fields: AgentAuditFields,
  override?: HistorySource,
): HistorySource {
  if (override) return override;
  if (fields.agentToolCallId && fields.agentToolCallId.trim().length > 0) {
    return 'chat_agent_assisted';
  }
  if (
    !fields.userId ||
    SYSTEM_USER_IDS.has(fields.userId) ||
    fields.userId === 'system'
  ) {
    return 'system';
  }
  return 'dashboard_manual';
}

/**
 * Apply the audit columns onto a {@link HistoryItem} just before
 * persistence. Pass ``override`` when the call site already knows the
 * source — eg ``'system'`` for cron-driven priority recalculation rows.
 */
export function applyAgentAuditFields(
  item: HistoryItem,
  fields: AgentAuditFields,
  override?: HistorySource,
): void {
  item.source = resolveHistorySource(fields, override);
  item.agentToolCallId = nonEmptyOrNull(fields.agentToolCallId);
  item.agentConversationId = nonEmptyOrNull(fields.agentConversationId);
  item.agentStreamId = nonEmptyOrNull(fields.agentStreamId);
}

function nonEmptyOrNull(value?: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

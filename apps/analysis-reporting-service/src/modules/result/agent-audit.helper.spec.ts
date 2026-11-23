import { HistoryItem } from '../../entities/history-item.entity';
import {
  applyAgentAuditFields,
  resolveHistorySource,
} from './agent-audit.helper';

describe('agent-audit helper', () => {
  describe('resolveHistorySource', () => {
    it("returns 'chat_agent_assisted' when agentToolCallId is set", () => {
      expect(
        resolveHistorySource({
          userId: 'user-1',
          agentToolCallId: 'tc-abc',
        }),
      ).toBe('chat_agent_assisted');
    });

    it("returns 'dashboard_manual' for a real user without agent ids", () => {
      expect(resolveHistorySource({ userId: 'user-1' })).toBe(
        'dashboard_manual',
      );
    });

    it("returns 'system' when userId is 'system' or empty", () => {
      expect(resolveHistorySource({ userId: 'system' })).toBe('system');
      expect(resolveHistorySource({ userId: '' })).toBe('system');
      expect(resolveHistorySource({})).toBe('system');
    });

    it('honors an explicit override even when agentToolCallId is set', () => {
      expect(
        resolveHistorySource(
          { userId: 'user-1', agentToolCallId: 'tc-1' },
          'system',
        ),
      ).toBe('system');
    });

    it('treats whitespace agentToolCallId as missing', () => {
      expect(
        resolveHistorySource({
          userId: 'user-1',
          agentToolCallId: '   ',
        }),
      ).toBe('dashboard_manual');
    });
  });

  describe('applyAgentAuditFields', () => {
    it('writes all four audit columns when ids are set', () => {
      const item = new HistoryItem();
      applyAgentAuditFields(item, {
        userId: 'user-1',
        agentToolCallId: 'tc-abc',
        agentConversationId: 'conv-1',
        agentStreamId: 'stream-1',
      });
      expect(item.source).toBe('chat_agent_assisted');
      expect(item.agentToolCallId).toBe('tc-abc');
      expect(item.agentConversationId).toBe('conv-1');
      expect(item.agentStreamId).toBe('stream-1');
    });

    it('null-fills missing or empty agent ids', () => {
      const item = new HistoryItem();
      applyAgentAuditFields(item, { userId: 'user-1' });
      expect(item.source).toBe('dashboard_manual');
      expect(item.agentToolCallId).toBeNull();
      expect(item.agentConversationId).toBeNull();
      expect(item.agentStreamId).toBeNull();
    });

    it("respects an explicit 'system' override regardless of audit ids", () => {
      const item = new HistoryItem();
      applyAgentAuditFields(
        item,
        { userId: 'system', agentToolCallId: 'should-not-promote' },
        'system',
      );
      expect(item.source).toBe('system');
      // Audit ids are still recorded for traceability when present.
      expect(item.agentToolCallId).toBe('should-not-promote');
    });
  });
});

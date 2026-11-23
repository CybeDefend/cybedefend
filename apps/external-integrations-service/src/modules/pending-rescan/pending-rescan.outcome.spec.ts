import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  branchHeadOutcomeOf,
  isGraphOnlyLimitReached,
  isScanAlreadyInProgress,
  pendingRescanOutcomeOf,
} from './pending-rescan.outcome';

const rpc = (code: number) => new RpcException({ code, message: 'x' });
const serviceError = (code: number) =>
  Object.assign(new Error('x'), { code, details: 'x' });

describe('pending rescan outcomes', () => {
  it('a running scan is ALREADY_EXISTS, as an RpcException or a raw ServiceError', () => {
    expect(isScanAlreadyInProgress(rpc(status.ALREADY_EXISTS))).toBe(true);
    expect(isScanAlreadyInProgress(serviceError(status.ALREADY_EXISTS))).toBe(
      true,
    );
    expect(isScanAlreadyInProgress(rpc(status.INTERNAL))).toBe(false);
  });

  // The TTL bounds the retries, so only a refusal that would
  // come back identical drops the rescan.
  describe('a failed scan start', () => {
    it.each([
      ['ALREADY_EXISTS', rpc(status.ALREADY_EXISTS)],
      ['UNAVAILABLE', rpc(status.UNAVAILABLE)],
      ['DEADLINE_EXCEEDED', serviceError(status.DEADLINE_EXCEEDED)],
      ['INTERNAL', rpc(status.INTERNAL)],
      ['UNKNOWN', rpc(status.UNKNOWN)],
      [
        'a MySQL error',
        Object.assign(new Error('ER_LOCK_WAIT_TIMEOUT'), {
          code: 'ER_LOCK_WAIT_TIMEOUT',
        }),
      ],
      ['a BullMQ / Redis error', new Error('Connection is closed.')],
    ])('%s is checked again later', (_label, error) => {
      expect(pendingRescanOutcomeOf(error)).toBe('busy');
    });

    it.each([
      ['NOT_FOUND', rpc(status.NOT_FOUND)],
      ['PERMISSION_DENIED', rpc(status.PERMISSION_DENIED)],
      ['UNAUTHENTICATED', rpc(status.UNAUTHENTICATED)],
      ['INVALID_ARGUMENT', serviceError(status.INVALID_ARGUMENT)],
      ['FAILED_PRECONDITION', rpc(status.FAILED_PRECONDITION)],
      ['RESOURCE_EXHAUSTED', rpc(status.RESOURCE_EXHAUSTED)],
    ])('%s drops the rescan', (_label, error) => {
      expect(pendingRescanOutcomeOf(error)).toBe('dropped');
    });
  });

  // A graph-only scan refused by
  // security-scanning's graph-only limits is a « busy » project or
  // organisation, not a final refusal, and only those two codes say so.
  describe('the graph-only limits', () => {
    const limited = (message: string) =>
      new RpcException({ code: status.RESOURCE_EXHAUSTED, message });

    it.each(['GRAPH_ONLY_PROJECT_BUSY', 'GRAPH_ONLY_ORG_LIMIT'])(
      '%s is a graph-only limit, as an RpcException or a raw ServiceError',
      (code) => {
        expect(isGraphOnlyLimitReached(limited(code))).toBe(true);
        expect(
          isGraphOnlyLimitReached(
            Object.assign(new Error(`8 RESOURCE_EXHAUSTED: ${code}`), {
              code: status.RESOURCE_EXHAUSTED,
              details: code,
            }),
          ),
        ).toBe(true);
      },
    );

    it.each([
      ['another RESOURCE_EXHAUSTED', limited('TRIAL_SCANS_EXHAUSTED')],
      ['RESOURCE_EXHAUSTED without a message', rpc(status.RESOURCE_EXHAUSTED)],
      [
        'the code under another status',
        new RpcException({
          code: status.INTERNAL,
          message: 'GRAPH_ONLY_PROJECT_BUSY',
        }),
      ],
      [
        'a message that only contains the code',
        limited('not GRAPH_ONLY_PROJECT_BUSY really'),
      ],
    ])('%s is not', (_label, error) => {
      expect(isGraphOnlyLimitReached(error)).toBe(false);
    });

    it.each(['GRAPH_ONLY_PROJECT_BUSY', 'GRAPH_ONLY_ORG_LIMIT'])(
      'a deferred rescan refused with %s stays pending (busy)',
      (code) => {
        expect(pendingRescanOutcomeOf(limited(code))).toBe('busy');
      },
    );
  });

  describe('a failed read of the branch head', () => {
    it.each([
      ['HTTP 404', Object.assign(new Error('x'), { status: 404 })],
      [
        'axios 404',
        Object.assign(new Error('x'), { response: { status: 404 } }),
      ],
      ['HTTP 401', Object.assign(new Error('x'), { status: 401 })],
      ['integration gone', rpc(status.NOT_FOUND)],
      ['nothing usable', new TypeError('no commit')],
    ])('%s drops the rescan', (_label, error) => {
      expect(branchHeadOutcomeOf(error)).toBe('dropped');
    });

    it.each([
      ['HTTP 502', Object.assign(new Error('x'), { status: 502 })],
      [
        'HTTP 429',
        Object.assign(new Error('x'), { response: { status: 429 } }),
      ],
      ['network', rpc(status.UNAVAILABLE)],
      ['anything else', new Error('socket hang up')],
    ])('%s is checked again later', (_label, error) => {
      expect(branchHeadOutcomeOf(error)).toBe('busy');
    });
  });
});

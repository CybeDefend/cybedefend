import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { assertDismissalReason } from './lifecycle.util';

/**
 * A finding may only be dismissed with a justification.
 *
 * WHY THE GUARD LIVES HERE AND NOT ONLY IN THE GATEWAY DTO. The gateway DTO is
 * the clean 400 for an HTTP caller; it is not the control. The async batch job
 * rebuilds each `UpdateResultRequest` from queue data, and any other gRPC caller
 * (mcp-service, a future service) never constructs the DTO at all. A validation
 * that only exists at the edge is not a control — this repo's own rule.
 *
 * The invariant this file pins: `status === 'ignored'` with no non-blank reason
 * is INVALID_ARGUMENT, and nothing else is affected.
 */
describe('assertDismissalReason', () => {
  const codeOf = (fn: () => void): number => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(RpcException);
      const err = (e as RpcException).getError() as { code: number };
      return err.code;
    }
    throw new Error('expected assertDismissalReason to throw, it did not');
  };

  it('rejects an ignore with no reason at all', () => {
    expect(codeOf(() => assertDismissalReason({ status: 'ignored' }))).toBe(
      status.INVALID_ARGUMENT,
    );
  });

  // '' is what the gateway sends for an absent optional string, and the proto3
  // default for the field; whitespace is what a client sends to tick the box
  // without saying anything. Both are "no justification".
  it.each(['', ' ', '   ', '\t', '\n', ' \t\n '])(
    'rejects an ignore whose reason is blank %j',
    (dismissalReason) => {
      expect(
        codeOf(() =>
          assertDismissalReason({ status: 'ignored', dismissalReason }),
        ),
      ).toBe(status.INVALID_ARGUMENT);
    },
  );

  it('names the field in the message so the caller can fix the payload', () => {
    try {
      assertDismissalReason({ status: 'ignored' });
    } catch (e) {
      const err = (e as RpcException).getError() as { message: string };
      expect(err.message).toContain('dismissalReason');
    }
  });

  it('passes when a reason is present', () => {
    expect(() =>
      assertDismissalReason({
        status: 'ignored',
        dismissalReason: 'accepted risk',
      }),
    ).not.toThrow();
  });

  it('passes when a reason has padding around real content', () => {
    expect(() =>
      assertDismissalReason({ status: 'ignored', dismissalReason: '  ok  ' }),
    ).not.toThrow();
  });

  // The guard is about ONE transition. A resolve, a confirm, a revert or a
  // priority/comment-only update (status arrives as the proto3 empty string)
  // must be untouched, or every triage in the product needs a reason.
  it.each(['to_verify', 'confirmed', 'resolved', '', undefined])(
    'passes for status %j',
    (s) => {
      expect(() => assertDismissalReason({ status: s })).not.toThrow();
    },
  );

  it('does not require a reason on a comment-only update', () => {
    expect(() => assertDismissalReason({})).not.toThrow();
  });
});

import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

/**
 * The closed list of reasons the Linear integration refuses a request.
 * The code travels as the `message` of the RpcException; the gateway forwards it
 * and the dashboard shows a fixed translated sentence per code, never the text.
 */
export const LINEAR_REFUSALS = [
  'LINEAR_NOT_CONNECTED',
  'LINEAR_NEEDS_RECONNECT',
  'LINEAR_WORKSPACE_TAKEN',
  'LINEAR_NO_TEAM',
  'LINEAR_TEAM_NOT_FOUND',
  'LINEAR_ISSUE_NOT_FOUND',
] as const;

export type LinearRefusal = (typeof LINEAR_REFUSALS)[number];

export function linearRefusal(
  code: LinearRefusal,
  grpcCode: status,
): RpcException {
  return new RpcException({ code: grpcCode, message: code });
}

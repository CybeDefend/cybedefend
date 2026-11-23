import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { LINEAR_REFUSALS, linearRefusal } from './linear-refusals';

describe('linear refusals', () => {
  it('is the closed list of refusal codes', () => {
    expect([...LINEAR_REFUSALS]).toEqual([
      'LINEAR_NOT_CONNECTED',
      'LINEAR_NEEDS_RECONNECT',
      'LINEAR_WORKSPACE_TAKEN',
      'LINEAR_NO_TEAM',
      'LINEAR_TEAM_NOT_FOUND',
      'LINEAR_ISSUE_NOT_FOUND',
    ]);
  });

  it('carries the refusal code as the message of the RpcException', () => {
    const rpc = linearRefusal(
      'LINEAR_NOT_CONNECTED',
      status.FAILED_PRECONDITION,
    );

    expect(rpc).toBeInstanceOf(RpcException);
    expect(rpc.getError()).toEqual({
      code: status.FAILED_PRECONDITION,
      message: 'LINEAR_NOT_CONNECTED',
    });
  });

  it('keeps the gRPC code it is given', () => {
    expect(
      linearRefusal('LINEAR_ISSUE_NOT_FOUND', status.NOT_FOUND).getError(),
    ).toMatchObject({ code: status.NOT_FOUND });
    expect(
      linearRefusal('LINEAR_WORKSPACE_TAKEN', status.ALREADY_EXISTS).getError(),
    ).toMatchObject({ code: status.ALREADY_EXISTS });
  });
});

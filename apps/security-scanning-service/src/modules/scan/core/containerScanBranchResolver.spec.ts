import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { NEVER, of, throwError } from 'rxjs';
import {
  BRANCH_RESOLUTION_TIMEOUT_MS,
  ContainerScanBranchResolver,
} from './containerScanBranchResolver';

function build(resolveScanBranch: jest.Mock) {
  const client = {
    getService: jest.fn().mockReturnValue({ resolveScanBranch }),
  };
  const logger = { warn: jest.fn() };
  const resolver = new ContainerScanBranchResolver(
    client as any,
    logger as any,
  );
  resolver.onModuleInit();
  return { resolver, client, logger };
}

describe('ContainerScanBranchResolver', () => {
  afterEach(() => jest.useRealTimers());

  it('asks external-integrations for the branch and returns its answer', async () => {
    const resolveScanBranch = jest.fn(() => of({ branch: 'develop' }));
    const { resolver, client } = build(resolveScanBranch);

    await expect(resolver.resolve('p1', '', 'develop')).resolves.toBe(
      'develop',
    );

    expect(client.getService).toHaveBeenCalledWith(
      'ProjectIntegrationStatusService',
    );
    expect(resolveScanBranch).toHaveBeenCalledWith({
      projectId: 'p1',
      branch: '',
      referenceBranch: 'develop',
    });
  });

  it('passes a refusal on with its code and message, so the caller gets a 400', async () => {
    const refusal = Object.assign(new Error('3 INVALID_ARGUMENT: Branch'), {
      code: status.INVALID_ARGUMENT,
      details: 'Branch "v2.102.0" does not exist in acme/vault',
    });
    const { resolver } = build(jest.fn(() => throwError(() => refusal)));

    const error = await resolver.resolve('p1', 'v2.102.0', '').catch((e) => e);

    expect(error).toBeInstanceOf(RpcException);
    expect(error.getError()).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'Branch "v2.102.0" does not exist in acme/vault',
    });
  });

  it('is UNAVAILABLE when external-integrations does not answer in time', async () => {
    jest.useFakeTimers();
    const { resolver } = build(jest.fn(() => NEVER));

    const pending = resolver.resolve('p1', 'develop', '').catch((e) => e);
    await jest.advanceTimersByTimeAsync(BRANCH_RESOLUTION_TIMEOUT_MS + 1);
    const error = await pending;

    expect(error).toBeInstanceOf(RpcException);
    expect(error.getError()).toMatchObject({ code: status.UNAVAILABLE });
  });

  // Deploy order: an external-integrations older than ResolveScanBranch
  // answers UNIMPLEMENTED. Container scans must not all fail meanwhile.
  describe('behind an external-integrations without ResolveScanBranch', () => {
    const unimplemented = () =>
      Object.assign(new Error('12 UNIMPLEMENTED: Method not found'), {
        code: status.UNIMPLEMENTED,
        details: 'Method not found!',
      });

    it.each([
      ['v2.102.0', 'develop', 'v2.102.0'],
      [' v2.102.0 ', 'develop', 'v2.102.0'],
      ['', 'develop', 'develop'],
      ['', '', 'main'],
    ])(
      'stores the requested branch %p, else the reference %p, else main, unchecked',
      async (branch, reference, stored) => {
        const { resolver, logger } = build(
          jest.fn(() => throwError(unimplemented)),
        );

        await expect(resolver.resolve('p1', branch, reference)).resolves.toBe(
          stored,
        );
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('BRANCH_UNCHECKED'),
        );
      },
    );
  });
});

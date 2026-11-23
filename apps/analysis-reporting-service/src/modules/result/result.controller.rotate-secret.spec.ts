// AppModule-free: the controller is built with Object.create.
import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { ResultController } from './result.controller';

/**
 * Marking a secret as rotated resolves it (SecretService
 * .rotateSecret), outside updateScanResult: the controller reports it to
 * Linear as fixed once the rotation is written.
 */
describe('ResultController.rotateSecret — Linear', () => {
  let rotateSecret: jest.Mock;
  let reportHandledFindings: jest.Mock;
  let controller: ResultController;

  beforeEach(() => {
    rotateSecret = jest.fn().mockResolvedValue({ state: 'resolved' });
    reportHandledFindings = jest.fn();
    controller = Object.create(ResultController.prototype);
    Object.assign(controller, {
      secretService: { rotateSecret },
      resultService: { reportHandledFindings },
    });
  });

  it('rotateSecret reports the secret as fixed', async () => {
    await expect(
      controller.rotateSecret({
        projectId: 'p1',
        vulnerabilityId: 's1',
        userId: 'u1',
      }),
    ).resolves.toEqual({ state: 'resolved' });

    expect(rotateSecret).toHaveBeenCalledWith('p1', 's1', 'u1');
    expect(reportHandledFindings).toHaveBeenCalledWith('p1', ['s1'], 'fixed');
    expect(rotateSecret.mock.invocationCallOrder[0]).toBeLessThan(
      reportHandledFindings.mock.invocationCallOrder[0],
    );
  });

  it('reports nothing when the rotation is refused', async () => {
    rotateSecret.mockRejectedValue(
      new RpcException({
        code: status.NOT_FOUND,
        message: 'Secret detection not found',
      }),
    );

    await expect(
      controller.rotateSecret({
        projectId: 'p1',
        vulnerabilityId: 'missing',
        userId: 'u1',
      }),
    ).rejects.toBeInstanceOf(RpcException);
    expect(reportHandledFindings).not.toHaveBeenCalled();
  });
});

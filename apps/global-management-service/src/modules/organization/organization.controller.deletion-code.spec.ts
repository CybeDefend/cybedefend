import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { Logger } from 'nestjs-pino';
import { createLoggerMock } from 'src/test-utils/typeorm-mock.util';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

/** RequestOrganizationDeletionCode and Delete, as the gRPC server calls them. */
describe('OrganizationController: deletion confirmation RPCs', () => {
  const service = {
    requestOrganizationDeletionCode: jest
      .fn()
      .mockResolvedValue({ expiresAt: '2026-10-27T10:10:00.000Z' }),
    confirmOrganizationDeletion: jest
      .fn()
      .mockResolvedValue({ message: 'deleted' }),
  };
  const controller = new OrganizationController(
    service as unknown as OrganizationService,
    createLoggerMock() as unknown as Logger,
  );

  beforeEach(() => jest.clearAllMocks());

  it('requestOrganizationDeletionCode hands the request to the service', async () => {
    const request = { organizationId: 'o1', requestedBy: 'u1' };
    await expect(
      controller.requestOrganizationDeletionCode(request),
    ).resolves.toEqual({ expiresAt: '2026-10-27T10:10:00.000Z' });
    expect(service.requestOrganizationDeletionCode).toHaveBeenCalledWith(
      request,
    );
  });

  it('requestOrganizationDeletionCode without an organization is INVALID_ARGUMENT', async () => {
    const thrown = await Promise.resolve(
      controller.requestOrganizationDeletionCode({
        organizationId: '',
        requestedBy: 'u1',
      }),
    ).catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(RpcException);
    expect(((thrown as RpcException).getError() as { code: number }).code).toBe(
      status.INVALID_ARGUMENT,
    );
    expect(service.requestOrganizationDeletionCode).not.toHaveBeenCalled();
  });

  it('confirmOrganizationDeletion forwards the caller and the confirmation code', async () => {
    const request = {
      organizationId: 'o1',
      requestedBy: 'u1',
      confirmationCode: '123456',
    };
    await expect(
      controller.confirmOrganizationDeletion(request),
    ).resolves.toEqual({ message: 'deleted' });
    expect(service.confirmOrganizationDeletion).toHaveBeenCalledWith(request);
  });
});

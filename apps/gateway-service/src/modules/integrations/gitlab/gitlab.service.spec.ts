import { HttpException } from '@nestjs/common';
import { of, throwError, Observable } from 'rxjs';
import {
  DisconnectGitlabRequest,
  DisconnectGitlabResponse,
} from '@grpc/external-integrations/gitlab';
import { GitlabService } from './gitlab.service';

function build(
  disconnect: jest.Mock<
    Observable<DisconnectGitlabResponse> | ReturnType<typeof throwError>
  >,
) {
  const client = { getService: jest.fn(() => ({ disconnect })) };
  const service = new GitlabService(
    client as never,
    { log: jest.fn() } as never,
  );
  service.onModuleInit();
  return service;
}

describe('GitlabService.disconnect', () => {
  it('relays the organization to GitlabService.Disconnect', async () => {
    const disconnect = jest.fn((_request: DisconnectGitlabRequest) =>
      of({ success: true, message: 'GitLab integration disconnected' }),
    );

    await expect(build(disconnect).disconnect('org-1')).resolves.toEqual({
      success: true,
      message: 'GitLab integration disconnected',
    });
    expect(disconnect.mock.calls[0][0]).toEqual({
      organizationId: 'org-1',
    });
  });

  it('answers 501 while external-integrations does not know the method yet', async () => {
    const disconnect = jest.fn((_request: DisconnectGitlabRequest) =>
      throwError(() => ({
        code: 12,
        details: 'The server does not implement the method Disconnect',
      })),
    );

    const error = await build(disconnect)
      .disconnect('org-1')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(501);
  });
});

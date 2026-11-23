import { IsNull } from 'typeorm';
import { flagReconnectRequired, isRevokedGrant } from './gitlab-reconnect';

const refused = (status: number, data?: unknown) => ({
  message: `Request failed with status code ${status}`,
  response: { status, data },
});

describe('isRevokedGrant', () => {
  it.each([
    ['400 invalid_grant', refused(400, { error: 'invalid_grant' })],
    ['401 invalid_grant', refused(401, { error: 'invalid_grant' })],
  ])('is true for %s', (_label, error) => {
    expect(isRevokedGrant(error)).toBe(true);
  });

  it.each([
    [
      '400 invalid_client (our own credentials)',
      refused(400, { error: 'invalid_client' }),
    ],
    ['400 without a body', refused(400)],
    ['429', refused(429, { error: 'invalid_grant' })],
    ['500', refused(500, { error: 'invalid_grant' })],
    ['503', refused(503)],
    ['a network error', new Error('socket hang up')],
    ['null', null],
    ['a string', 'invalid_grant'],
  ])('is false for %s', (_label, error) => {
    expect(isRevokedGrant(error)).toBe(false);
  });
});

describe('flagReconnectRequired', () => {
  const integration = { id: 'integration-1', organizationId: 'org-1' };

  function setup(update: jest.Mock) {
    const repository = { update };
    const logger = { warn: jest.fn(), error: jest.fn() };
    return { repository, logger };
  }

  it('marks a healthy row only while it still holds the refresh token GitLab refused', async () => {
    const { repository, logger } = setup(
      jest.fn().mockResolvedValue({ affected: 1 }),
    );

    await flagReconnectRequired(
      repository as never,
      logger,
      integration,
      'sent-token',
    );

    expect(repository.update).toHaveBeenCalledWith(
      {
        id: 'integration-1',
        refreshToken: 'sent-token',
        reconnectRequiredAt: IsNull(),
      },
      { reconnectRequiredAt: expect.any(Date) },
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'GITLAB_RECONNECT_REQUIRED org=org-1 integration=integration-1',
      ),
    );
  });

  it('leaves a connection already marked, rotated meanwhile or gone as it is, and logs nothing', async () => {
    const { repository, logger } = setup(
      jest.fn().mockResolvedValue({ affected: 0 }),
    );

    await flagReconnectRequired(
      repository as never,
      logger,
      integration,
      'sent-token',
    );

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('never throws and never logs the token', async () => {
    const { repository, logger } = setup(
      jest.fn().mockRejectedValue(new Error('deadlock')),
    );

    await expect(
      flagReconnectRequired(
        repository as never,
        logger,
        integration,
        'sent-token',
      ),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
    expect(
      JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls]),
    ).not.toContain('sent-token');
  });
});

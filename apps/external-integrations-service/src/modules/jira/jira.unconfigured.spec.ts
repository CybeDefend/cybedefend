import { status } from '@grpc/grpc-js';
import { ConfigService } from '@nestjs/config';
import { RpcException } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Logger } from 'nestjs-pino';
import SecretsService from '../../core/secrets/secrets.service';
import { JiraIntegration } from '../../entities/jira-integration.entity';
import { JiraProjectMapping } from '../../entities/jira-project-mapping.entity';
import { createLoggerMock, createMockRepository } from '../../test-utils/mocks';
import { JiraService } from './jira.service';

/**
 * An instance where Jira is not configured (no client id or secret, the
 * Community default): the public webhook route and the connect route answer
 * a stable configuration refusal instead of failing inside the HMAC or
 * building an authorize URL with no client id.
 */
describe('JiraService without a Jira configuration', () => {
  let service: JiraService;
  let integrationRepo: ReturnType<typeof createMockRepository>;
  let logger: ReturnType<typeof createLoggerMock>;

  beforeEach(async () => {
    integrationRepo = createMockRepository();
    logger = createLoggerMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        JiraService,
        {
          provide: getRepositoryToken(JiraIntegration),
          useValue: integrationRepo,
        },
        {
          provide: getRepositoryToken(JiraProjectMapping),
          useValue: createMockRepository(),
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'NODE_ENV' ? 'production' : undefined,
          },
        },
        { provide: SecretsService, useValue: { getSecret: () => undefined } },
        { provide: Logger, useValue: logger },
      ],
    }).compile();
    service = moduleRef.get(JiraService);
  });

  const refusalOf = async (run: () => unknown): Promise<unknown> => {
    try {
      await run();
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('answers a webhook delivery NOT_FOUND, without reading the database or logging an error', async () => {
    const thrown = await refusalOf(() =>
      service.handleWebhook({ rawBody: '{}', secret: 'forged' }),
    );

    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.NOT_FOUND,
      message: 'JIRA_NOT_CONFIGURED',
    });
    expect(integrationRepo.findOne).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('refuses to build an authorize URL with no client id', async () => {
    const thrown = await refusalOf(() =>
      service.generateOAuthUrl({
        redirectUri: 'https://app.example.com/cb',
        state: 's',
      }),
    );

    expect(thrown).toBeInstanceOf(RpcException);
    expect((thrown as RpcException).getError()).toEqual({
      code: status.FAILED_PRECONDITION,
      message: 'JIRA_NOT_CONFIGURED',
    });
  });
});

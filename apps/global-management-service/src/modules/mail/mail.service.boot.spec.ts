const verifyNeverSettles = jest.fn(() => new Promise<boolean>(() => undefined));
const createTransportMock = jest.fn((...args: any[]) => ({
  __args: args,
  verify: verifyNeverSettles,
  sendMail: jest.fn().mockResolvedValue(undefined),
  close: jest.fn(),
}));

jest.mock('nodemailer', () => ({
  createTransport: (...args: any[]) => createTransportMock(...args),
}));

import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { MailService } from './mail.service';

/**
 * Startup must never wait on SMTP.
 *
 * nodemailer's default connection timeout is 2 minutes, and `onModuleInit`
 * runs before the gRPC server starts listening on 50051. The pod's
 * startupProbe budget is initialDelay 15s + 30 x 5s = 165s, so an unreachable
 * mail host would eat 120s of it and can crash-loop the whole service — which
 * also serves organizations, teams and projects.
 */
/** Every MailService made by the current test, released after it. */
const made: MailService[] = [];

function makeService(secret = 'x') {
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  const svc = new MailService(
    { getSecret: jest.fn().mockReturnValue(secret) } as any,
    { get: jest.fn().mockReturnValue('') } as any,
    {} as any,
    {} as any,
    logger as any,
  );
  jest.spyOn(svc as any, 'registerPartials').mockResolvedValue(undefined);
  made.push(svc);
  return { svc, logger };
}

describe('MailService boot path', () => {
  beforeEach(() => {
    createTransportMock.mockClear();
    verifyNeverSettles.mockClear();
  });

  afterEach(() => {
    for (const svc of made.splice(0)) svc.beforeApplicationShutdown();
  });

  it('completes startup even when the SMTP check never settles', async () => {
    const { svc } = makeService();

    // Resolves on its own; if onModuleInit awaited verify() this would hang
    // until the jest timeout.
    await expect(svc.onModuleInit()).resolves.toBeUndefined();

    // The check is still attempted — just not blocking.
    expect(verifyNeverSettles).toHaveBeenCalled();
  });

  it('bounds the SMTP connect and greeting phases instead of nodemailer 2-minute default', async () => {
    const { svc } = makeService();
    await svc.onModuleInit();

    const opts = createTransportMock.mock.calls[0][0] as any;
    expect(opts.connectionTimeout).toBeLessThanOrEqual(30_000);
    expect(opts.greetingTimeout).toBeLessThanOrEqual(30_000);
  });

  // One SMTP session per mail cost ~1.4 s of connect + TLS +
  // AUTH for every zero-day alert, report and invitation. A pool reuses the
  // sessions, and 3 keeps us under the handful of concurrent sessions Google
  // accepts before answering 421.
  it('pools the SMTP sessions, at most 3 at once', async () => {
    const { svc } = makeService();
    await svc.onModuleInit();

    const opts = createTransportMock.mock.calls[0][0] as any;
    expect(opts.pool).toBe(true);
    expect(opts.maxConnections).toBe(3);
  });

  // 4 MailService instances live in the API process
  // (MailModule, UserModule, OrganizationModule, MarketingLeadModule).
  it('creates and verifies one transport for every MailService of the process', async () => {
    for (let i = 0; i < 4; i++) await makeService().svc.onModuleInit();

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(verifyNeverSettles).toHaveBeenCalledTimes(1);
    const transporters = new Set(made.map((svc) => (svc as any).transporter));
    expect(transporters.size).toBe(1);
  });

  it('gives an instance that read other SMTP settings a transport of its own', async () => {
    const a = makeService('x').svc;
    const b = makeService('rotated').svc;
    await a.onModuleInit();
    await b.onModuleInit();

    expect(createTransportMock).toHaveBeenCalledTimes(2);
    expect((a as any).transporter).not.toBe((b as any).transporter);
  });

  // An open pooled session keeps the event loop alive,
  // so a pod that sent a mail would not exit on its own after app.close().
  it('closes the shared transport once, when the last instance is destroyed', async () => {
    const instances = Array.from({ length: 4 }, () => makeService().svc);
    for (const svc of instances) await svc.onModuleInit();
    const close = createTransportMock.mock.results[0].value.close as jest.Mock;

    for (const svc of instances.slice(0, 3)) svc.beforeApplicationShutdown();
    expect(close).not.toHaveBeenCalled();

    instances[3].beforeApplicationShutdown();
    instances[3].beforeApplicationShutdown();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the transport when Nest closes the application', async () => {
    jest
      .spyOn(MailService.prototype as any, 'registerPartials')
      .mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        MailService,
        {
          provide: SecretsService,
          useValue: { getSecret: jest.fn().mockReturnValue('x') },
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: Logger,
          useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
        { provide: getRepositoryToken(Organization), useValue: {} },
        { provide: getRepositoryToken(Project), useValue: {} },
      ],
    }).compile();
    await module.init();
    const close = createTransportMock.mock.results[0].value.close as jest.Mock;

    await module.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});

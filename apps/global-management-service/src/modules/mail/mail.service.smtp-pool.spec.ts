import { createServer, AddressInfo, Server, Socket } from 'node:net';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import SecretsService from 'src/core/secrets/secrets.service';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';

/**
 * The transport MailService builds, run for real against a
 * local fake SMTP server: the pool options must actually bound the sessions
 * and reuse them, whatever the nodemailer version does with them.
 *
 * Only host, port and TLS are swapped (the fake server speaks plain SMTP and
 * nothing leaves the machine); every other option is MailService's own.
 */
const mockSmtp = { port: 0, createTransportCalls: 0 };
jest.mock('nodemailer', () => {
  const actual = jest.requireActual('nodemailer');
  return {
    createTransport: (options: Record<string, unknown>) => {
      mockSmtp.createTransportCalls++;
      return actual.createTransport({
        ...options,
        host: '127.0.0.1',
        port: mockSmtp.port,
        secure: false,
        ignoreTLS: true,
      });
    },
  };
});

import { MailService } from './mail.service';

interface FakeSmtpServer {
  server: Server;
  /** Sessions opened since the start. */
  sessions: number;
  /** Most sessions open at the same time. */
  maxOpen: number;
  /** Sessions open right now. */
  open: number;
  delivered: number;
}

/**
 * Just enough SMTP for nodemailer: EHLO, AUTH, MAIL, RCPT, DATA, QUIT. Each
 * message is acknowledged after `deliveryDelayMs`, so concurrent sends really
 * overlap.
 */
function startFakeSmtp(
  deliveryDelayMs: number,
  { rejectAuth = false } = {},
): Promise<FakeSmtpServer> {
  const state: FakeSmtpServer = {
    server: undefined as unknown as Server,
    sessions: 0,
    maxOpen: 0,
    open: 0,
    delivered: 0,
  };
  state.server = createServer((socket: Socket) => {
    state.sessions++;
    state.open++;
    state.maxOpen = Math.max(state.maxOpen, state.open);
    socket.on('close', () => {
      state.open--;
    });
    socket.on('error', () => undefined);
    const reply = (line: string) => socket.write(`${line}\r\n`);
    let buffer = '';
    let inData = false;
    reply('220 fake.invalid ESMTP');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let end = buffer.indexOf('\r\n');
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf('\r\n');
        if (inData) {
          if (line === '.') {
            inData = false;
            setTimeout(() => {
              state.delivered++;
              reply('250 2.0.0 queued');
            }, deliveryDelayMs);
          }
          continue;
        }
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO') {
          socket.write(
            '250-fake.invalid\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n',
          );
        } else if (verb === 'AUTH') {
          reply(
            rejectAuth
              ? '535 5.7.8 Username and Password not accepted'
              : '235 2.7.0 accepted',
          );
        } else if (verb === 'DATA') {
          inData = true;
          reply('354 go ahead');
        } else if (verb === 'QUIT') {
          reply('221 bye');
          socket.end();
        } else {
          reply('250 OK');
        }
      }
    });
  });
  return new Promise((resolve) => {
    state.server.listen(0, '127.0.0.1', () => {
      mockSmtp.port = (state.server.address() as AddressInfo).port;
      resolve(state);
    });
  });
}

/** Every MailService booted by the current test, released after it. */
const booted: MailService[] = [];

async function bootService(): Promise<MailService> {
  const svc = new MailService(
    { getSecret: jest.fn().mockReturnValue('x') } as any,
    { get: jest.fn().mockReturnValue('') } as any,
    {} as any,
    {} as any,
    { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any,
  );
  jest.spyOn(svc as any, 'registerPartials').mockResolvedValue(undefined);
  // The boot check opens a session of its own; only the sends are measured.
  jest.spyOn(svc as any, 'verifyTransport').mockResolvedValue(undefined);
  await svc.onModuleInit();
  booted.push(svc);
  return svc;
}

const mail = (i: number) => ({
  from: '"CybeDefend" <noreply@example.com>',
  to: `recipient-${i}@example.invalid`,
  subject: `pool test ${i}`,
  html: '<p>pool test</p>',
});

describe('MailService SMTP transport against a real SMTP dialogue', () => {
  let smtp: FakeSmtpServer;
  let svc: MailService;

  beforeEach(() => {
    mockSmtp.createTransportCalls = 0;
  });

  afterEach(async () => {
    for (const instance of booted.splice(0))
      instance.beforeApplicationShutdown();
    await new Promise((resolve) => smtp.server.close(resolve));
  });

  it('never opens more than 3 sessions, however many mails are sent at once', async () => {
    smtp = await startFakeSmtp(50);
    svc = await bootService();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        (svc as any).transporter.sendMail(mail(i)),
      ),
    );

    expect(smtp.delivered).toBe(10);
    expect(smtp.maxOpen).toBeLessThanOrEqual(3);
  });

  it('reuses one session for mails sent one after the other', async () => {
    smtp = await startFakeSmtp(0);
    svc = await bootService();

    for (let i = 0; i < 5; i++) {
      await (svc as any).transporter.sendMail(mail(i));
    }

    expect(smtp.delivered).toBe(5);
    expect(smtp.sessions).toBe(1);
  });

  // MailService is provided by MailModule AND re-declared
  // in UserModule, OrganizationModule and MarketingLeadModule, i.e. 4
  // instances in the API process. One pool each would be up to 12 sessions.
  it('shares one transport between every MailService of the process, 3 sessions in all', async () => {
    smtp = await startFakeSmtp(50);
    const instances = [
      await bootService(),
      await bootService(),
      await bootService(),
      await bootService(),
    ];

    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (instances[i % instances.length] as any).transporter.sendMail(mail(i)),
      ),
    );

    expect(mockSmtp.createTransportCalls).toBe(1);
    expect(smtp.delivered).toBe(12);
    expect(smtp.maxOpen).toBeLessThanOrEqual(3);
  });

  it('closes every pooled session once all instances are destroyed', async () => {
    smtp = await startFakeSmtp(0);
    const instances = [await bootService(), await bootService()];
    await Promise.all(
      instances.map((instance, i) =>
        (instance as any).transporter.sendMail(mail(i)),
      ),
    );
    expect(smtp.open).toBeGreaterThan(0);

    for (const instance of booted.splice(0))
      instance.beforeApplicationShutdown();

    const deadline = Date.now() + 5_000;
    while (smtp.open > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(smtp.open).toBe(0);
  });

  // MarketingLeadModule declares MailService next to
  // MarketingLeadService, whose onModuleDestroy drains lead mails for up to
  // 15 s. Nest runs the onModuleDestroy hooks of one module concurrently, so
  // a lease given back there could close the pool under the drain.
  it('keeps the pool open for a mail sent while another provider drains, and closes it after shutdown', async () => {
    smtp = await startFakeSmtp(0);

    @Injectable()
    class DrainingProvider implements OnModuleDestroy {
      outcome = 'not run';
      constructor(private readonly mailService: MailService) {}
      async onModuleDestroy(): Promise<void> {
        // A lead task still running when shutdown starts.
        await new Promise((resolve) => setTimeout(resolve, 50));
        this.outcome = await (this.mailService as any).transporter
          .sendMail(mail(0))
          .then(
            () => 'sent',
            (err: Error) => err.message,
          );
      }
    }

    jest
      .spyOn(MailService.prototype as any, 'registerPartials')
      .mockResolvedValue(undefined);
    jest
      .spyOn(MailService.prototype as any, 'verifyTransport')
      .mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      providers: [
        MailService,
        DrainingProvider,
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
    const draining = module.get(DrainingProvider);

    await module.close();

    expect(draining.outcome).toBe('sent');
    expect(smtp.delivered).toBe(1);
    const deadline = Date.now() + 5_000;
    while (smtp.open > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(smtp.open).toBe(0);
  });

  // The report crons abort on a rejected credential (isFatalTransportError):
  // through the pool the login error must still reach the sendMail caller,
  // with the code and response code they test.
  it('hands a rejected login to the caller as EAUTH / 535', async () => {
    smtp = await startFakeSmtp(0, { rejectAuth: true });
    svc = await bootService();

    await expect(
      (svc as any).transporter.sendMail(mail(0)),
    ).rejects.toMatchObject({ code: 'EAUTH', responseCode: 535 });
    expect(smtp.delivered).toBe(0);
  });
});

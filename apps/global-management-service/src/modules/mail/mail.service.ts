import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import { join } from 'node:path';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import { formatDistanceToNow, format } from 'date-fns';
import { OrganizationInviteResponse } from '@grpc/global-management/organization';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { User } from 'src/entities/user.entity';
import { buildReportRecipients, ProjectAccessPair } from './report-recipients';
import { buildDailyCriticalProjectView } from './report-branch-grouping';
import SecretsService from 'src/core/secrets/secrets.service';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { leaseSmtpTransport } from './shared-smtp-transport';
import { isCommunityEdition } from 'src/edition/edition';
import { ident } from '@cybedefend/db-dialect';
import {
  SUPPORT_CONTACT_PORT,
  type SupportContact,
} from 'src/edition/ports/support-contact.port';
import { CommunitySupportContact } from 'src/edition/community/support-contact.community';

interface ConsolidatedSeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
}
interface ConsolidatedReportVuln {
  title?: string;
  severity: string;
  type?: string;
  packageName?: string;
  version?: string;
  cvss?: string;
  createdAt?: string;
  branch?: string;
}
interface ConsolidatedPeriodicProject {
  projectId: string;
  projectName: string;
  severities: ConsolidatedSeverity;
  total: number;
  topRecent: ConsolidatedReportVuln[];
}
interface ConsolidatedCriticalProject {
  projectId: string;
  projectName: string;
  criticals: ConsolidatedReportVuln[];
  count: number;
}

/**
 * A send failure as it may be logged: the error's class only. A nodemailer
 * error repeats the recipient address in its message.
 */
function errorClass(error: unknown): string {
  return (error as Error | undefined)?.name ?? 'unknown';
}

/** The header logo of every template: `src='cid:header-logo'`. */
const HEADER_LOGO_CID = 'header-logo';
const HEADER_LOGO_PATH = 'assets/header-logo.png';

/**
 * An organization name printed next to a deletion code: quoted, and cut at
 * 80 characters (code points), so an administrator cannot rename the
 * organization into a sentence that reads as our own instructions.
 */
const ORGANIZATION_NAME_MAX = 80;
function quotedOrganizationName(name: string): string {
  const chars = [...(name ?? '')];
  const shown =
    chars.length > ORGANIZATION_NAME_MAX
      ? `${chars.slice(0, ORGANIZATION_NAME_MAX - 1).join('')}…`
      : chars.join('');
  return `“${shown}”`;
}

/**
 * The cloud invitation link: the token in the path, the organisation, role,
 * expiry and invited address in the query (the page warns an invitee signed
 * in with another account).
 */
function cloudInviteUrl(
  frontendUrl: string,
  invite: OrganizationInviteResponse,
): string {
  return (
    `${frontendUrl}/invite/${invite.token}` +
    `?organizationName=${encodeURIComponent(invite.organizationName)}` +
    `&organizationRole=${encodeURIComponent(invite.organizationRole)}` +
    `&expiresAt=${encodeURIComponent(invite.expiresAt)}` +
    `&email=${encodeURIComponent(invite.email)}` +
    `&fromInvitation=true`
  );
}

@Injectable()
export class MailService implements OnModuleInit, BeforeApplicationShutdown {
  // Undefined when no EMAIL_HOST was configured at boot: every
  // send method then skips with one WARN instead of failing.
  private transporter?: nodemailer.Transporter;
  // Gives back this instance's lease on the shared transport.
  private releaseTransport?: () => void;

  constructor(
    private readonly secretsService: SecretsService,
    private readonly configService: ConfigService,
    @InjectRepository(Organization)
    private readonly organizationRepo: Repository<Organization>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly logger: Logger,
    // Bound by the edition layer in every context; a MailService built by
    // hand points to the instance administrator.
    @Optional()
    @Inject(SUPPORT_CONTACT_PORT)
    private readonly supportContact: SupportContact = new CommunitySupportContact(),
  ) {}

  /**
   * True when an SMTP host is configured (EMAIL_HOST non-empty). The
   * Community Edition runs without SMTP: no transport is leased then, and
   * every send method skips with one WARN.
   */
  isConfigured(): boolean {
    return Boolean(this.secretsService.getSecret('EMAIL_HOST'));
  }

  async onModuleInit() {
    if (!this.isConfigured()) {
      // No SMTP host: lease no transport. Partials still register,
      // so the templates are ready if a host is configured later.
      await this.registerPartials();
      return;
    }
    const settings = {
      host: this.secretsService.getSecret('EMAIL_HOST'),
      port: this.secretsService.getSecret('EMAIL_PORT'),
      secure: this.configService.get('EMAIL_SECURE') !== 'false',
      auth: {
        user: this.secretsService.getSecret('EMAIL_USER'),
        pass: this.secretsService.getSecret('EMAIL_PASSWORD'),
      },
      // nodemailer defaults to a 2-minute connection timeout and a 30s
      // greeting timeout. Both are far too generous for a report cron and for
      // the boot check below — an unreachable mail host would otherwise tie up
      // a run (or a startup) for minutes. Send/idle behaviour is untouched.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      // Reuse SMTP sessions instead of paying connect + TLS + AUTH (~1.4 s)
      // for every mail; Google answers 421 beyond a few concurrent sessions.
      // The 3 sessions are for the whole process: MailService is declared in
      // MailModule, UserModule, OrganizationModule and MarketingLeadModule,
      // and every instance leases the same transport (shared-smtp-transport).
      // An idle session is closed after nodemailer's 10 min socket timeout.
      // A message whose session drops before the server's final reply is
      // requeued on another session (maxRequeues 5): if the server had in
      // fact accepted the DATA, the recipient gets the mail twice.
      pool: true as const,
      maxConnections: 3,
    };
    const lease = leaseSmtpTransport(settings, () =>
      nodemailer.createTransport(settings),
    );
    this.transporter = lease.transporter;
    this.releaseTransport = lease.release;

    // Deliberately NOT awaited. `onModuleInit` runs before the gRPC server
    // listens on 50051, and the pod's startupProbe budget is 165s
    // (initialDelay 15s + 30 x 5s). Blocking here on an unreachable SMTP host
    // would burn that budget and crash-loop a service that also serves
    // organizations, teams and projects — a guard costing more than it
    // protects. The result is reported when it arrives. Once per transport:
    // the instances sharing it would only repeat the same check.
    if (lease.created) void this.verifyTransport();

    await this.registerPartials();
  }

  /**
   * Gives back this instance's lease; the last one closes the shared pool.
   * An open pooled session keeps the event loop alive, so without this a pod
   * that sent a mail would not exit on its own after app.close().
   *
   * Not onModuleDestroy: Nest runs a module's onModuleDestroy hooks together,
   * and MarketingLeadService drains lead mails there for up to 15 s. Nest
   * calls beforeApplicationShutdown once every onModuleDestroy has settled.
   */
  beforeApplicationShutdown(): void {
    this.releaseTransport?.();
    this.releaseTransport = undefined;
  }

  /**
   * Checks the SMTP credentials at boot so a rejected one is known immediately
   * instead of at the next report cron — which, being weekly, is how a revoked
   * app password went unnoticed for a week.
   *
   * Neither throws nor blocks startup: it reports and lets the service come up.
   */
  private async verifyTransport(): Promise<void> {
    try {
      await this.transporter.verify();
    } catch (err) {
      this.logger.error(
        { err },
        'SMTP transport verification FAILED — outbound email is down until the ' +
          'credentials are fixed (EMAIL_USER / EMAIL_PASSWORD). Reports and ' +
          'invitations will not be delivered.',
      );
    }
  }

  /**
   * True when an error means the transport itself is unusable, so every
   * remaining recipient would fail the same way.
   *
   * Rejected credentials (`EAUTH` / SMTP 535) are the case that matters: the
   * weekly report cron burned through every recipient one by one against a
   * revoked Google app password, logging an identical error each time and
   * returning success to its caller.
   */
  static isFatalTransportError(err: unknown): boolean {
    const e = err as { code?: string; responseCode?: number } | null;
    if (!e) return false;
    if (e.code === 'EAUTH') return true;
    // 530 Authentication required / 535 Bad credentials.
    return e.responseCode === 530 || e.responseCode === 535;
  }

  getTemplatePath(subPath: string): string {
    const basePath =
      process.env.NODE_ENV === 'production'
        ? 'dist/modules/mail/templates'
        : 'src/modules/mail/templates';

    // Security: reject path traversal attempts but allow forward slashes for subdirectories
    if (subPath.includes('..')) {
      throw new TypeError('Invalid template path: path traversal not allowed');
    }

    // Normalize path separators to forward slashes
    const normalizedPath = subPath.replaceAll('\\', '/');

    return join(process.cwd(), basePath, normalizedPath);
  }

  private async registerPartials() {
    const partialsDir = this.getTemplatePath('partials');
    if (!existsSync(partialsDir)) {
      throw new TypeError(`Partials directory does not exist`);
    }

    const files = await readdir(partialsDir);
    for (const file of files) {
      if (file.endsWith('.hbs')) {
        const partialName = file.replaceAll('.hbs', '');
        const partialContent = await readFile(join(partialsDir, file), 'utf8');
        handlebars.registerPartial(partialName, partialContent);
      }
    }

    // Register report partials from reports/partials directory
    const reportPartialsDir = this.getTemplatePath('reports/partials');
    if (existsSync(reportPartialsDir)) {
      const reportFiles = await readdir(reportPartialsDir);
      for (const file of reportFiles) {
        if (file.endsWith('.hbs')) {
          const partialName = file.replaceAll('.hbs', '');
          const partialContent = await readFile(
            join(reportPartialsDir, file),
            'utf8',
          );
          handlebars.registerPartial(partialName, partialContent);
        }
      }
    }

    // Also register base layout templates that live at root (e.g., mainTemplate.hbs)
    // so they can be invoked as partials ({{> mainTemplate ...}}) from wrapper templates.
    const rootTemplates = ['mainTemplate'];
    for (const tmpl of rootTemplates) {
      try {
        const rootPath = this.getTemplatePath(`${tmpl}.hbs`);
        if (existsSync(rootPath)) {
          const content = await readFile(rootPath, 'utf8');
          handlebars.registerPartial(tmpl, content);
        }
      } catch {
        // Non-fatal if a root template is missing.
      }
    }

    // Helpers
    handlebars.registerHelper('severityColor', (sev: string) => {
      const s = (sev || '').toLowerCase();
      if (s === 'critical') return 'd32f2f';
      if (s === 'high') return 'f57c00';
      if (s === 'medium') return 'fbc02d';
      if (s === 'low') return '1976d2';
      return '757575';
    });
    handlebars.registerHelper('cvssColor', (score: any) => {
      const v = Number.parseFloat(score);
      if (Number.isNaN(v)) return '#555';
      if (v >= 9) return '#d32f2f';
      if (v >= 7) return '#f57c00';
      if (v >= 4) return '#fbc02d';
      return '#1976d2';
    });
    handlebars.registerHelper('eq', (a: any, b: any) => a === b);
  }

  /**
   * Renders one of the mail templates (public: the closed edition's mails
   * render through this).
   */
  async render(
    templateName: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const filePath = this.getTemplatePath(`${templateName}.hbs`);
    if (!existsSync(filePath)) {
      throw new TypeError(`Template file does not exist`);
    }

    const templateContent = await readFile(filePath, 'utf8');
    const compiledTemplate = handlebars.compile(templateContent);
    return compiledTemplate(data);
  }

  /**
   * The sender of every mail this service sends: EMAIL_FROM. Always set when
   * a transport exists — the cloud schema defaults it, and the Community
   * schema requires it whenever EMAIL_HOST is set.
   */
  private from(): string {
    return this.configService.get<string>('EMAIL_FROM');
  }

  /**
   * True when this instance holds no SMTP transport (no EMAIL_HOST at boot),
   * so the mail is skipped with one WARN naming the method. Carries
   * no recipient and no content, only the method name. Public: the closed
   * edition's mails skip through this.
   */
  skipWithoutSmtp(kind: string): boolean {
    if (this.transporter) return false;
    this.logger.warn(`MAIL_SKIPPED_NO_SMTP kind=${kind}`);
    return true;
  }

  /**
   * Hands one mail to the transport, with the images its html shows inline.
   * The header logo ships beside the templates and travels inside the mail as
   * a CID attachment: opening a mail fetches nothing from a remote host, which
   * would otherwise learn who opened it, when and from where.
   */
  private send(mail: nodemailer.SendMailOptions): Promise<unknown> {
    return this.transporter.sendMail(this.withInlineAssets(mail));
  }

  private withInlineAssets(
    mail: nodemailer.SendMailOptions,
  ): nodemailer.SendMailOptions {
    const html = typeof mail.html === 'string' ? mail.html : '';
    if (!html.includes(`cid:${HEADER_LOGO_CID}`)) return mail;
    const attachments = mail.attachments ?? [];
    if (attachments.some((a) => a.cid === HEADER_LOGO_CID)) return mail;
    return {
      ...mail,
      attachments: [
        ...attachments,
        {
          filename: 'logo.png',
          path: this.getTemplatePath(HEADER_LOGO_PATH),
          cid: HEADER_LOGO_CID,
          contentDisposition: 'inline',
        },
      ],
    };
  }

  /**
   * Sends one mail through the shared SMTP transport (public: the closed mails
   * of the closed edition send through this). The sender defaults to EMAIL_FROM.
   */
  async deliver(mail: nodemailer.SendMailOptions): Promise<void> {
    if (this.skipWithoutSmtp('deliver')) return;
    const from = mail.from ?? this.from();
    await this.send({ ...mail, from });
  }

  /**
   * Sends the invitation mail. Resolves `false` when no SMTP is configured:
   * the caller then keeps the token in the response and shows the
   * invitee the link itself; otherwise today's behaviour, then `true`.
   */
  async sendOrganizationInviteEmail(
    invite: OrganizationInviteResponse,
  ): Promise<boolean> {
    if (this.skipWithoutSmtp('sendOrganizationInviteEmail')) return false;
    const frontendUrl = this.configService
      .get('FRONTEND_URL')
      .replaceAll(/\/$/g, '');
    // Community Edition: the token travels in the fragment, which no server
    // or proxy logs and no Referer header carries; its invitation page reads
    // only the token and the invited address (it ignores the organisation,
    // the role and the expiry). The cloud link keeps its form.
    const inviteUrl = isCommunityEdition()
      ? `${frontendUrl}/invite#token=${encodeURIComponent(invite.token)}` +
        `&email=${encodeURIComponent(invite.email)}`
      : cloudInviteUrl(frontendUrl, invite);

    const timeUntilExpiration = formatDistanceToNow(new Date(invite.expiresAt));

    const components = [
      {
        type: 'title',
        content: `You're invited to join ${invite.organizationName} on CybeDefend! 🥳`,
      },
      {
        type: 'textBlock',
        content: `Hello! You've been invited to join ${invite.organizationName} as a ${invite.organizationRole}. Please accept the invitation by clicking the link below.`,
      },
      {
        type: 'button',
        text: 'Accept Invitation',
        url: inviteUrl,
        buttonColor: '#7B45FF',
      },
      {
        type: 'textBlock',
        content: `The invitation expires in ${timeUntilExpiration}. If you have any questions, feel free to reach out to us.`,
      },
    ];

    const html = await this.render('mainTemplate', {
      title: `Invitation to join ${invite.organizationName} on CybeDefend`,
      components,
    });

    const mailOptions = {
      from: this.from(),
      to: invite.email,
      subject: `Invitation to join ${invite.organizationName} on CybeDefend`,
      html,
    };

    try {
      await this.send(mailOptions);
      this.logger.log('Invitation email sent');
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending invitation email (${errorClass(error)})`,
      );
      throw error;
    }
  }

  async sendWelcomeEmail(to: string, name: string): Promise<void> {
    // Without SMTP the welcome mail is simply not sent.
    if (this.skipWithoutSmtp('sendWelcomeEmail')) return;
    // This button is how someone who signed up on a phone reaches the app on a
    // computer. It was a hardcoded `http://localhost:3002`: a dead link in
    // every deployed environment.
    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      .replaceAll(/\/$/g, '');

    const components = [
      { type: 'title', content: 'Thanks for joining us! 🚀' },
      {
        type: 'textBlock',
        content: `Hello, ${name}! We're excited to have you on board. Let's scan your first project together and make sure it's secure!`,
      },
      {
        type: 'button',
        text: 'Get Started',
        url: frontendUrl,
        buttonColor: '#7B45FF',
      },
      {
        type: 'textBlock',
        content: this.supportContact.questionLine(),
      },
    ];

    const html = await this.render('mainTemplate', {
      title: 'Welcome to CybeDefend!',
      components,
    });

    const mailOptions = {
      from: this.from(),
      to,
      subject: 'Welcome to CybeDefend!',
      html,
    };

    try {
      await this.send(mailOptions);
      this.logger.log('Welcome email sent');
    } catch (error) {
      this.logger.error(`Error sending welcome email (${errorClass(error)})`);
      throw error;
    }
  }

  /**
   * The password-reset mail of the Community Edition: the link
   * carries the token in its fragment, so it never reaches a log or a Referer
   * header. Resolves `false` when no SMTP is configured: the caller
   * then answers as if the mail had gone out (no account enumeration). Rethrows
   * a transport failure, so the caller logs it by class name; never logs the
   * recipient nor the link.
   */
  async sendPasswordResetEmail(input: {
    to: string;
    link: string;
  }): Promise<boolean> {
    if (this.skipWithoutSmtp('sendPasswordResetEmail')) return false;
    const subject = 'Reset your CybeDefend password';
    const components = [
      { type: 'title', content: subject },
      {
        type: 'textBlock',
        content:
          'Someone asked to reset the password of your CybeDefend account. Click the button below to choose a new one.',
      },
      {
        type: 'button',
        text: 'Reset password',
        url: input.link,
        buttonColor: '#7B45FF',
      },
      {
        type: 'textBlock',
        content:
          'The link is valid for 30 minutes and can be used once. If you did not ask for this, ignore this e-mail: your password stays unchanged. Never share the link with anyone.',
      },
    ];
    const html = await this.render('mainTemplate', {
      title: subject,
      components,
    });
    try {
      await this.send({
        from: this.from(),
        to: input.to,
        subject,
        html,
      });
      this.logger.log('Password reset email sent');
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending password reset email (${
          (error as Error | undefined)?.name ?? 'unknown'
        })`,
      );
      throw error;
    }
  }

  /**
   * The code that confirms an organization's deletion, sent to its creator.
   * Every value goes into a component as plain text, which the
   * partials escape. Rethrows a transport failure, so the caller invalidates
   * the code nobody received. Never logs the code nor the address: only the
   * error's class (a nodemailer error carries the recipient in its message).
   */
  async sendOrganizationDeletionCodeEmail(input: {
    to: string;
    organizationName: string;
    code: string;
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendOrganizationDeletionCodeEmail')) return;
    const subject = 'Confirm the deletion of your CybeDefend organization';
    const components = [
      { type: 'title', content: 'Confirm the deletion of your organization' },
      {
        type: 'textBlock',
        content: `Someone signed in as you asked to delete the organization ${quotedOrganizationName(input.organizationName)} and all of its data. To confirm, enter this code:`,
      },
      { type: 'title', content: input.code },
      {
        type: 'textBlock',
        content:
          'The code is valid for 10 minutes and can be used once. If you did not ask for this, ignore this e-mail: nothing is deleted without the code. Never share it with anyone.',
      },
    ];
    const html = await this.render('mainTemplate', {
      title: subject,
      components,
    });
    try {
      await this.send({
        from: this.from(),
        to: input.to,
        subject,
        html,
      });
      this.logger.log('Organization deletion code email sent');
    } catch (error) {
      this.logger.error(
        `Error sending organization deletion code email (${
          (error as Error | undefined)?.name ?? 'unknown'
        })`,
      );
      throw error;
    }
  }

  /**
   * The alert sent to the creator when too many wrong deletion codes locked
   * the organization's deletion. Rethrows a transport failure;
   * the caller treats it as best-effort.
   */
  async sendOrganizationDeletionLockedEmail(input: {
    to: string;
    organizationName: string;
    lockedUntil: Date;
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendOrganizationDeletionLockedEmail')) return;
    const subject = 'Deletion of your CybeDefend organization locked';
    const components = [
      { type: 'title', content: 'Organization deletion locked' },
      {
        type: 'textBlock',
        content: `Too many wrong confirmation codes were entered to delete the organization ${quotedOrganizationName(input.organizationName)}. Its deletion is locked until ${input.lockedUntil.toISOString()} (UTC). Nothing was deleted.`,
      },
      {
        type: 'textBlock',
        content: `If this was not you, someone may be using your account: change your password and contact ${this.supportContact.compromisedAccountContact()}.`,
      },
    ];
    const html = await this.render('mainTemplate', {
      title: subject,
      components,
    });
    try {
      await this.send({
        from: this.from(),
        to: input.to,
        subject,
        html,
      });
      this.logger.log('Organization deletion locked email sent');
    } catch (error) {
      this.logger.error(
        `Error sending organization deletion locked email (${
          (error as Error | undefined)?.name ?? 'unknown'
        })`,
      );
      throw error;
    }
  }

  /**
   * Email of the project's organization creator — the sole recipient of the
   * per-project notification emails — or null when there is none, or when that
   * user turned "Email Notifications" off in /profile (`user.notification`).
   */
  async resolveOrganizationEmail(projectId: string): Promise<string | null> {
    const creator = await this.organizationRepo
      .createQueryBuilder('organization')
      .innerJoin('organization.teams', 'team')
      .innerJoin('team.projects', 'project', 'project.id = :projectId', {
        projectId,
      })
      .innerJoin('organization.creator', 'user')
      .select('user.email', 'email')
      .addSelect('user.notification', 'notification')
      .getRawOne<{ email: string; notification: number | boolean | null }>();

    // `notification` is a TINYINT: the raw row carries 0/1, never a boolean.
    // Only an explicit 0 opts out — a NULL, or a row missing the column, keeps
    // the email flowing instead of silently muting a security alert.
    const preference = creator?.notification;
    if (
      preference !== undefined &&
      preference !== null &&
      Number(preference) === 0
    ) {
      this.logger.log(
        `Organization creator has Email Notifications off — skipping notification email for project ${projectId}`,
      );
      return null;
    }

    return creator?.email ?? null;
  }

  /**
   * Resolve organization creator name from project ID
   */
  async resolveOrganizationCreatorName(projectId: string): Promise<string> {
    const org = await this.organizationRepo
      .createQueryBuilder('organization')
      .innerJoin('organization.teams', 'team')
      .innerJoin('team.projects', 'project', 'project.id = :projectId', {
        projectId,
      })
      .innerJoin('organization.creator', 'user')
      .select('user.firstName', 'firstName')
      .getRawOne<{ firstName: string }>();

    return org?.firstName || 'User';
  }

  async sendWeeklyProjectReportEmail(payload: {
    projectId: string;
    projectName: string;
    severities: { critical: number; high: number; medium: number; low: number };
    types: { sast: number; iac: number; sca: number; container: number };
    topRecent: Array<{
      id: string;
      title: string;
      severity: string;
      type: string;
      state: string;
      cwe?: string;
      packageName?: string;
      version?: string;
      createdAt: string;
      cvss?: string;
    }>;
    total: number;
    newLast7d: number;
    resolvedLast7d: number;
    recipients?: string[];
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendWeeklyProjectReportEmail')) return;
    // Skip projects with no vulnerabilities
    if (payload.total === 0) {
      this.logger.debug(
        `Skipping weekly report for project ${payload.projectId} - no vulnerabilities`,
      );
      return;
    }

    const frontendUrl = this.configService
      .get('FRONTEND_URL')
      .replaceAll(/\/$/g, '');

    // Resolve recipient and user name
    const to =
      payload.recipients?.[0] ||
      (await this.resolveOrganizationEmail(payload.projectId));
    if (!to) {
      this.logger.warn('No recipient for weekly project report');
      return;
    }

    const userName = await this.resolveOrganizationCreatorName(
      payload.projectId,
    );

    // Calculate week period
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekPeriod = `${format(weekAgo, 'MMM d')} - ${format(now, 'MMM d, yyyy')}`;

    // Build severities array for badges
    const severities = [
      {
        label: 'Critical',
        count: payload.severities.critical,
        color: '#D32F2F',
      },
      { label: 'High', count: payload.severities.high, color: '#F57C00' },
      { label: 'Medium', count: payload.severities.medium, color: '#FBC02D' },
      { label: 'Low', count: payload.severities.low, color: '#1976D2' },
    ];

    // Build vulnerabilities list (max 5 items)
    const vulnerabilities = payload.topRecent.slice(0, 5).map((v) => ({
      severity: v.severity,
      title: v.title?.substring(0, 200) || 'Unknown vulnerability',
      packageName: v.packageName || undefined,
      version: v.version || undefined,
      cvss: v.cvss || undefined,
    }));

    const hasMore = payload.topRecent.length > 5;
    const remainingCount = payload.topRecent.length - 5;

    // Calculate severity counts for project header badges
    const severityCounts = {
      critical: payload.severities.critical,
      high: payload.severities.high,
      medium: payload.severities.medium,
      low: payload.severities.low,
    };

    // Build context for template
    const context = {
      userName,
      weekPeriod,
      totalVulnerabilities: payload.total,
      severities,
      dashboardUrl: `${frontendUrl}/`,
      projects: [
        {
          projectName: payload.projectName,
          projectUrl: `${frontendUrl}/project/${payload.projectId}`,
          vulnerabilitiesCount: payload.total,
          severityCounts, // Pass severity counts for badges
          vulnerabilities,
          hasMore,
          remainingCount,
        },
      ],
      notificationSettingsUrl: `${frontendUrl}/project/${payload.projectId}/settings?tab=notifications`,
      currentYear: new Date().getFullYear(),
    };

    // Compile the new professional template
    const html = await this.render('reports/weeklyReportTemplate', context);

    try {
      await this.send({
        from: this.from(),
        to,
        subject: `${userName}'s Weekly Security Report - ${payload.projectName}`,
        html,
      });
    } catch (err) {
      this.logger.error(
        `sendWeeklyProjectReportEmail failed for project ${payload.projectId} (${errorClass(err)})`,
      );
      throw err;
    }

    this.logger.log(`Weekly report sent for project ${payload.projectId}`);
  }

  /**
   * Send monthly project report email.
   */
  async sendMonthlyProjectReportEmail(payload: {
    projectId: string;
    projectName: string;
    severities: { critical: number; high: number; medium: number; low: number };
    types: { sast: number; iac: number; sca: number; container: number };
    topRecent: Array<{
      id: string;
      title: string;
      severity: string;
      type: string;
      state: string;
      createdAt: string;
      packageName?: string;
      version?: string;
      cvss?: string;
    }>;
    total: number;
    newLast30d: number;
    resolvedLast30d: number;
    recipients?: string[];
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendMonthlyProjectReportEmail')) return;
    // Skip if no vulnerabilities
    if (payload.total === 0) {
      this.logger.debug(
        `Skipping monthly report for project ${payload.projectName} - no vulnerabilities`,
      );
      return;
    }

    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      ?.replaceAll(/\/$/g, '');
    const to =
      payload.recipients?.[0] ||
      (await this.resolveOrganizationEmail(payload.projectId));
    if (!to) {
      this.logger.warn('No recipient for monthly project report');
      return;
    }

    const userName = await this.resolveOrganizationCreatorName(
      payload.projectId,
    );

    // Calculate month period
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthPeriod = `${format(monthAgo, 'MMM d')} - ${format(now, 'MMM d, yyyy')}`;

    // Build severities array for badges
    const severities = [
      {
        label: 'Critical',
        count: payload.severities.critical,
        color: '#D32F2F',
      },
      { label: 'High', count: payload.severities.high, color: '#F57C00' },
      { label: 'Medium', count: payload.severities.medium, color: '#FBC02D' },
      { label: 'Low', count: payload.severities.low, color: '#1976D2' },
    ];

    // Build vulnerabilities list (max 5 items)
    const vulnerabilities = payload.topRecent.slice(0, 5).map((v) => ({
      severity: v.severity,
      title: v.title?.substring(0, 200) || 'Unknown vulnerability',
      packageName: v.packageName || undefined,
      version: v.version || undefined,
      cvss: v.cvss || undefined,
    }));

    const hasMore = payload.topRecent.length > 5;
    const remainingCount = payload.topRecent.length - 5;

    // Calculate severity counts for project header badges
    const severityCounts = {
      critical: payload.severities.critical,
      high: payload.severities.high,
      medium: payload.severities.medium,
      low: payload.severities.low,
    };

    // Build context for template
    const context = {
      userName,
      monthPeriod, // Use monthPeriod instead of weekPeriod
      totalVulnerabilities: payload.total,
      severities,
      dashboardUrl: `${frontendUrl}/`,
      projects: [
        {
          projectName: payload.projectName,
          projectUrl: `${frontendUrl}/project/${payload.projectId}`,
          vulnerabilitiesCount: payload.total,
          severityCounts, // Pass severity counts for badges
          vulnerabilities,
          hasMore,
          remainingCount,
        },
      ],
      notificationSettingsUrl: `${frontendUrl}/project/${payload.projectId}/settings?tab=notifications`,
      currentYear: new Date().getFullYear(),
    };

    // Compile the new professional template
    const html = await this.render('reports/monthlyReportTemplate', context);

    try {
      await this.send({
        from: this.from(),
        to,
        subject: `${userName}'s Monthly Security Report - ${payload.projectName}`,
        html,
      });
    } catch (err) {
      this.logger.error(
        `sendMonthlyProjectReportEmail failed for project ${payload.projectId} (${errorClass(err)})`,
      );
      throw err;
    }

    this.logger.log(`Monthly report sent for project ${payload.projectId}`);
  }

  /**
   * Send daily critical alerts email (if at least one critical vulnerability detected in last 24h).
   */
  async sendDailyCriticalAlertsEmail(payload: {
    projectId: string;
    projectName: string;
    criticals: Array<{
      id: string;
      title: string;
      severity: string;
      type: string;
      state?: string;
      createdAt: string;
      cvss?: string;
      packageName?: string;
      version?: string;
    }>;
    recipients?: string[];
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendDailyCriticalAlertsEmail')) return;
    if (!payload.criticals || payload.criticals.length === 0) {
      this.logger.debug(
        `Skipping critical alerts for project ${payload.projectName} - no critical vulnerabilities in last 24h`,
      );
      return;
    }

    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      ?.replaceAll(/\/$/g, '');
    const to =
      payload.recipients?.[0] ||
      (await this.resolveOrganizationEmail(payload.projectId));
    if (!to) {
      this.logger.warn('No recipient for daily critical alerts');
      return;
    }

    const userName = await this.resolveOrganizationCreatorName(
      payload.projectId,
    );

    // Format today's date
    const now = new Date();
    const todayDate = format(now, 'EEEE, MMMM d, yyyy');

    // Build vulnerabilities list (limit to 10 for critical alerts)
    const vulnerabilities = payload.criticals.slice(0, 10).map((v) => ({
      severity: v.severity,
      title: v.title?.substring(0, 200) || 'Unknown vulnerability',
      type: v.type,
      packageName: v.packageName || undefined,
      version: v.version || undefined,
      cvss: v.cvss || undefined,
      createdAt: v.createdAt,
    }));

    const hasMore = payload.criticals.length > 10;
    const remainingCount = payload.criticals.length - 10;

    // Count by type
    const typeCounts = {
      sast: payload.criticals.filter((v) => v.type === 'SAST').length,
      iac: payload.criticals.filter((v) => v.type === 'IAC').length,
      sca: payload.criticals.filter((v) => v.type === 'SCA').length,
      container: payload.criticals.filter((v) => v.type === 'CONTAINER').length,
    };

    // Build context for template
    const context = {
      userName,
      todayDate,
      totalCritical: payload.criticals.length,
      projectName: payload.projectName,
      projectUrl: `${frontendUrl}/project/${payload.projectId}?filter=critical`,
      typeCounts,
      vulnerabilities,
      hasMore,
      remainingCount,
      notificationSettingsUrl: `${frontendUrl}/project/${payload.projectId}/settings?tab=notifications`,
      currentYear: new Date().getFullYear(),
    };

    // Compile the new professional template
    const html = await this.render('reports/criticalAlertsTemplate', context);

    try {
      await this.send({
        from: this.from(),
        to,
        subject: `🚨 ${payload.criticals.length} Critical Vulnerabilities Detected - ${payload.projectName}`,
        html,
      });

      this.logger.log(
        `Critical alerts sent for project ${payload.projectId} (${payload.criticals.length} critical vulnerabilities)`,
      );
    } catch (err) {
      this.logger.error(
        `sendDailyCriticalAlertsEmail failed for project ${payload.projectId} (${errorClass(err)})`,
      );
      throw err;
    }
  }

  /**
   * Send scan complete report email.
   */
  async sendScanCompleteReportEmail(payload: {
    projectId: string;
    projectName: string;
    scanId: string;
    severities: { critical: number; high: number; medium: number; low: number };
    types: { sast: number; iac: number; sca: number; container: number };
    total: number;
    topVulnerabilities: Array<{
      id: string;
      title: string;
      severity: string;
      type: string;
      state?: string;
      createdAt: string;
      cvss?: string;
      packageName?: string;
      version?: string;
    }>;
    scannerType: string;
    branch?: string;
    recipients?: string[];
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendScanCompleteReportEmail')) return;
    const frontendUrl = this.configService
      .get<string>('FRONTEND_URL')
      ?.replaceAll(/\/$/g, '');
    const to =
      payload.recipients?.[0] ||
      (await this.resolveOrganizationEmail(payload.projectId));
    if (!to) {
      this.logger.warn('No recipient for scan complete report');
      return;
    }

    const userName = await this.resolveOrganizationCreatorName(
      payload.projectId,
    );

    // Format today's date
    const now = new Date();
    const todayDate = format(now, 'EEEE, MMMM d, yyyy');

    // Build severities array for badges
    const severities = [
      {
        label: 'Critical',
        count: payload.severities.critical,
        color: '#D32F2F',
      },
      { label: 'High', count: payload.severities.high, color: '#F57C00' },
      { label: 'Medium', count: payload.severities.medium, color: '#FBC02D' },
      { label: 'Low', count: payload.severities.low, color: '#1976D2' },
    ];

    // Build vulnerabilities list (max 5 items)
    const vulnerabilities = payload.topVulnerabilities.slice(0, 5).map((v) => ({
      severity: v.severity,
      title: v.title?.substring(0, 200) || 'Unknown vulnerability',
      type: v.type,
      packageName: v.packageName || undefined,
      version: v.version || undefined,
      cvss: v.cvss || undefined,
    }));

    const hasMore = payload.topVulnerabilities.length > 5;
    const remainingCount = payload.topVulnerabilities.length - 5;

    // Scanner type label (format "sast,iac,sca" → "SAST / IAC / SCA")
    const scannerTypeLabel = (payload.scannerType || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .join(' / ');

    // Build type breakdown for template (only include active types)
    const typeBreakdown = [
      { label: 'SAST', count: payload.types.sast },
      { label: 'IAC', count: payload.types.iac },
      { label: 'SCA', count: payload.types.sca },
      { label: 'Container', count: payload.types.container },
    ].filter((t) => t.count > 0);
    const showTypeBreakdown = typeBreakdown.length > 1;

    // Build context for template
    const context = {
      userName,
      todayDate,
      projectName: payload.projectName,
      projectUrl: `${frontendUrl}/project/${payload.projectId}`,
      scanId: payload.scanId,
      scanUrl: `${frontendUrl}/project/${payload.projectId}/scan/${payload.scanId}`,
      scannerType: scannerTypeLabel,
      branch: payload.branch || '',
      totalVulnerabilities: payload.total,
      severities,
      typeBreakdown,
      showTypeBreakdown,
      vulnerabilities,
      hasMore,
      remainingCount,
      notificationSettingsUrl: `${frontendUrl}/project/${payload.projectId}/settings?tab=notifications`,
      currentYear: new Date().getFullYear(),
    };

    const html = await this.render('reports/scanCompleteTemplate', context);

    try {
      await this.send({
        from: this.from(),
        to,
        subject: `Scan Complete - ${payload.projectName} (${scannerTypeLabel})`,
        html,
      });

      this.logger.log(
        `Scan complete report sent for project ${payload.projectId} (scan ${payload.scanId})`,
      );
    } catch (err) {
      this.logger.error(
        `sendScanCompleteReportEmail failed for project ${payload.projectId}, scan ${payload.scanId} (${errorClass(err)})`,
      );
      throw err;
    }
  }

  // ─── Consolidated (multi-project) reports ──────────────────────────────

  /**
   * Resolve (user, project) access pairs for a set of projects so a single
   * org-wide report can be fanned out to every member who can access each
   * project. Access mirrors UserService.loadAccessibleProjects /
   * ProjectService.getProjectsOrganization: creator/administrator on the
   * project's organization, OR member of the team that owns the project.
   *
   * These are AppSec reports: once the
   * organisation's per-member products switch is on, a team member is a
   * recipient only while holding AppSec (`appsec_access`), as Permify then
   * refuses the others every AppSec route the e-mail links to. The creator
   * and administrators always hold AppSec. Switch off: today's recipients.
   */
  private async fetchProjectAccessPairs(
    projectIds: string[],
  ): Promise<Array<ProjectAccessPair & { firstName: string }>> {
    if (projectIds.length === 0) return [];
    // The subqueries' aliases (uom, tm, uap) and the output aliases are not
    // the query builder's, so TypeORM leaves them as written: the camelCase
    // ones are quoted (PostgreSQL folds an unquoted name to lower case), and
    // the booleans compare with TRUE / FALSE (PostgreSQL has no
    // `boolean = integer`; MySQL reads them as 1 / 0).
    const q = (name: string) => ident(name).text;
    const rows = await this.projectRepo
      .createQueryBuilder('project')
      .innerJoin('project.team', 'team')
      .innerJoin('team.organization', 'org')
      .innerJoin(
        User,
        'u',
        `(EXISTS (SELECT 1 FROM users_organizations_members uom WHERE ${q('uom.organizationId')} = org.id AND ${q('uom.userId')} = u.id AND uom.role IN ('creator', 'administrator'))
          OR (EXISTS (SELECT 1 FROM teams_members tm WHERE ${q('tm.teamId')} = team.id AND ${q('tm.userId')} = u.id)
            AND (org.member_products = FALSE
              OR EXISTS (SELECT 1 FROM users_organizations_members uap WHERE ${q('uap.organizationId')} = org.id AND ${q('uap.userId')} = u.id AND uap.appsec_access = TRUE))))`,
      )
      .where('project.id IN (:...projectIds)', { projectIds })
      .select([
        `u.id AS ${q('userId')}`,
        'u.email AS email',
        `u.firstName AS ${q('firstName')}`,
        'u.notification AS notification',
        `project.id AS ${q('projectId')}`,
      ])
      .getRawMany<{
        userId: string;
        email: string;
        firstName: string;
        notification: number | boolean;
        projectId: string;
      }>();
    return rows.map((r) => ({
      userId: r.userId,
      email: r.email,
      firstName: r.firstName || 'User',
      notification: Boolean(Number(r.notification)),
      projectId: r.projectId,
    }));
  }

  private severityBadges(s: ConsolidatedSeverity) {
    return [
      { label: 'Critical', count: s.critical, color: '#D32F2F' },
      { label: 'High', count: s.high, color: '#F57C00' },
      { label: 'Medium', count: s.medium, color: '#FBC02D' },
      { label: 'Low', count: s.low, color: '#1976D2' },
    ];
  }

  private sumSeverities(
    items: ConsolidatedPeriodicProject[],
  ): ConsolidatedSeverity {
    return items.reduce(
      (acc, it) => ({
        critical: acc.critical + (it.severities?.critical ?? 0),
        high: acc.high + (it.severities?.high ?? 0),
        medium: acc.medium + (it.severities?.medium ?? 0),
        low: acc.low + (it.severities?.low ?? 0),
      }),
      { critical: 0, high: 0, medium: 0, low: 0 },
    );
  }

  private periodicProjectSection(
    p: ConsolidatedPeriodicProject,
    frontendUrl: string,
  ) {
    const topRecent = p.topRecent ?? [];
    const vulnerabilities = topRecent.slice(0, 5).map((v) => ({
      severity: v.severity,
      title: v.title?.substring(0, 200) || 'Unknown vulnerability',
      packageName: v.packageName || undefined,
      version: v.version || undefined,
      cvss: v.cvss || undefined,
      // per-row branch chip; template skips it via {{#if branch}}.
      branch: v.branch || undefined,
    }));
    return {
      projectName: p.projectName,
      projectUrl: `${frontendUrl}/project/${p.projectId}`,
      vulnerabilitiesCount: p.total,
      severityCounts: {
        critical: p.severities.critical,
        high: p.severities.high,
        medium: p.severities.medium,
        low: p.severities.low,
      },
      vulnerabilities,
      hasMore: topRecent.length > 5,
      remainingCount: Math.max(0, topRecent.length - 5),
    };
  }

  /**
   * Shared core for the weekly + monthly consolidated reports (identical layout,
   * only the template, period label and subject differ). Sends ONE email per
   * eligible recipient carrying their accessible subset of the org's projects.
   */
  private async sendConsolidatedPeriodicReport(opts: {
    organizationId: string;
    projects: ConsolidatedPeriodicProject[];
    templateName: string;
    periodKey: 'weekPeriod' | 'monthPeriod';
    periodValue: string;
    reportLabel: string;
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendConsolidatedPeriodicReport')) return;
    const projects = opts.projects.filter((p) => p.total > 0);
    if (projects.length === 0) return;

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL')?.replaceAll(/\/$/g, '') ??
      '';

    const pairs = await this.fetchProjectAccessPairs(
      projects.map((p) => p.projectId),
    );
    const recipients = buildReportRecipients(pairs, projects);
    if (recipients.length === 0) return;

    const nameByUser = new Map(pairs.map((p) => [p.userId, p.firstName]));
    let failed = 0;

    for (const recipient of recipients) {
      const userName = nameByUser.get(recipient.userId) || 'User';
      const overview = this.sumSeverities(recipient.projects);
      const context: Record<string, unknown> = {
        userName,
        totalVulnerabilities: recipient.projects.reduce(
          (sum, p) => sum + p.total,
          0,
        ),
        severities: this.severityBadges(overview),
        dashboardUrl: `${frontendUrl}/`,
        projects: recipient.projects.map((p) =>
          this.periodicProjectSection(p, frontendUrl),
        ),
        notificationSettingsUrl: `${frontendUrl}/profile`,
        currentYear: new Date().getFullYear(),
      };
      context[opts.periodKey] = opts.periodValue;

      try {
        const html = await this.render(opts.templateName, context);
        await this.send({
          from: this.from(),
          to: recipient.email,
          subject: `${userName}'s ${opts.reportLabel} Security Report`,
          html,
        });
        this.logger.log(
          `${opts.reportLabel} consolidated report sent to user ${recipient.userId} (${recipient.projects.length} projects)`,
        );
      } catch (err) {
        failed++;
        this.logger.error(
          {
            error: errorClass(err),
            userId: recipient.userId,
            organizationId: opts.organizationId,
          },
          `Consolidated ${opts.reportLabel} report failed for user ${recipient.userId}`,
        );

        if (MailService.isFatalTransportError(err)) {
          // The credential is rejected, so every remaining recipient would fail
          // identically. Stop, and make the caller see it: swallowed, every
          // remaining report would be silently lost while the cron reports
          // success.
          this.logger.error(
            { error: errorClass(err), organizationId: opts.organizationId },
            `SMTP transport rejected our credentials — aborting the ${opts.reportLabel} ` +
              `report run after ${failed}/${recipients.length} recipient(s). ` +
              `NO further report will be delivered until EMAIL_USER / EMAIL_PASSWORD is fixed.`,
          );
          throw err;
        }
      }
    }

    if (failed > 0) {
      this.logger.error(
        {
          organizationId: opts.organizationId,
          failed,
          total: recipients.length,
        },
        `Consolidated ${opts.reportLabel} report: ${failed}/${recipients.length} recipient(s) were NOT delivered`,
      );
    }
  }

  async sendConsolidatedWeeklyReportEmail(payload: {
    organizationId: string;
    projects: ConsolidatedPeriodicProject[];
  }): Promise<void> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    await this.sendConsolidatedPeriodicReport({
      organizationId: payload.organizationId,
      projects: payload.projects,
      templateName: 'reports/weeklyReportTemplate',
      periodKey: 'weekPeriod',
      periodValue: `${format(weekAgo, 'MMM d')} - ${format(now, 'MMM d, yyyy')}`,
      reportLabel: 'Weekly',
    });
  }

  async sendConsolidatedMonthlyReportEmail(payload: {
    organizationId: string;
    projects: ConsolidatedPeriodicProject[];
  }): Promise<void> {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await this.sendConsolidatedPeriodicReport({
      organizationId: payload.organizationId,
      projects: payload.projects,
      templateName: 'reports/monthlyReportTemplate',
      periodKey: 'monthPeriod',
      periodValue: `${format(monthAgo, 'MMM d')} - ${format(now, 'MMM d, yyyy')}`,
      reportLabel: 'Monthly',
    });
  }

  async sendConsolidatedDailyCriticalReportEmail(payload: {
    organizationId: string;
    projects: ConsolidatedCriticalProject[];
  }): Promise<void> {
    if (this.skipWithoutSmtp('sendConsolidatedDailyCriticalReportEmail'))
      return;
    const projects = payload.projects.filter(
      (p) => (p.criticals?.length ?? 0) > 0,
    );
    if (projects.length === 0) return;

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL')?.replaceAll(/\/$/g, '') ??
      '';

    const pairs = await this.fetchProjectAccessPairs(
      projects.map((p) => p.projectId),
    );
    const recipients = buildReportRecipients(pairs, projects);
    if (recipients.length === 0) return;

    const nameByUser = new Map(pairs.map((p) => [p.userId, p.firstName]));
    const todayDate = format(new Date(), 'EEEE, MMMM d, yyyy');

    for (const recipient of recipients) {
      const userName = nameByUser.get(recipient.userId) || 'User';
      const totalCritical = recipient.projects.reduce(
        (sum, p) => sum + (p.criticals?.length ?? 0),
        0,
      );
      const context = {
        userName,
        todayDate,
        totalCritical,
        dashboardUrl: `${frontendUrl}/`,
        // hybrid branch presentation: single-branch projects show the
        // branch inline in the header; multi-branch projects are split into
        // per-branch sections (see report-branch-grouping.ts).
        projects: recipient.projects.map((p) =>
          buildDailyCriticalProjectView(
            {
              projectId: p.projectId,
              projectName: p.projectName,
              criticals: p.criticals ?? [],
            },
            frontendUrl,
          ),
        ),
        notificationSettingsUrl: `${frontendUrl}/profile`,
        currentYear: new Date().getFullYear(),
      };

      try {
        const html = await this.render(
          'reports/consolidatedCriticalAlertsTemplate',
          context,
        );
        await this.send({
          from: this.from(),
          to: recipient.email,
          subject: `🚨 ${totalCritical} Critical Vulnerabilities Detected`,
          html,
        });
        this.logger.log(
          `Consolidated critical alerts sent to user ${recipient.userId} (${recipient.projects.length} projects, ${totalCritical} criticals)`,
        );
      } catch (err) {
        this.logger.error(
          {
            error: errorClass(err),
            userId: recipient.userId,
            organizationId: payload.organizationId,
          },
          `Consolidated critical alerts failed for user ${recipient.userId}`,
        );
      }
    }
  }
}

import { createHash } from 'node:crypto';
import type { Transporter } from 'nodemailer';

/**
 * One SMTP transport per process and per set of SMTP settings.
 *
 * MailService is provided by MailModule and re-declared in UserModule,
 * OrganizationModule and MarketingLeadModule, so the API process holds 4
 * instances. Each building its own pooled transport meant up to 4 pools of
 * `maxConnections` sessions per pod. Every instance now leases the same
 * transport; it is created by the first lease and closed when the last one is
 * released.
 *
 * Keyed by the settings each instance read at boot: an instance that read
 * other credentials never sends through a transport it did not configure.
 * The key is a digest, so the password is not kept as a map key.
 */
interface SharedTransport {
  transporter: Transporter;
  leases: number;
}

const transports = new Map<string, SharedTransport>();

export interface SmtpTransportLease {
  transporter: Transporter;
  /** True for the lease that created the transport. */
  created: boolean;
  /** Gives the lease back; closes the transport with the last one. Idempotent. */
  release(): void;
}

export function leaseSmtpTransport(
  settings: object,
  create: () => Transporter,
): SmtpTransportLease {
  const key = createHash('sha256')
    .update(JSON.stringify(settings))
    .digest('hex');
  let shared = transports.get(key);
  const created = !shared;
  if (!shared) {
    shared = { transporter: create(), leases: 0 };
    transports.set(key, shared);
  }
  shared.leases++;
  const leased = shared;
  let released = false;
  return {
    transporter: leased.transporter,
    created,
    release: () => {
      if (released) return;
      released = true;
      leased.leases--;
      if (leased.leases > 0) return;
      if (transports.get(key) === leased) transports.delete(key);
      leased.transporter.close();
    },
  };
}

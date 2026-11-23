import { isIP } from 'node:net';

/**
 * The address a rate-limit bucket is keyed on, from a client address.
 *
 * - An IPv4 address is kept as it is.
 * - An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`, or its hexadecimal form)
 *   is the IPv4 client it maps: one client, one bucket, whichever socket
 *   family the server listens on.
 * - Any other IPv6 address is folded to its /64 (`2001:db8:1:2::/64`). A
 *   client is usually given a whole /64 and can pick a new address in it for
 *   every request, so a bucket keyed on the full address would not limit it.
 * - Anything else (an empty value, `unknown`) is returned trimmed, so the
 *   caller's own fallback key still applies.
 *
 * Generic file: the same bytes in every service that keys a limit on an
 * address.
 */
export function rateLimitAddressOf(address: string | undefined): string {
  const value = typeof address === 'string' ? address.trim() : '';
  const zoneless = value.split('%')[0];
  const family = isIP(zoneless);
  if (family === 4) return zoneless;
  if (family !== 6) return value;

  const groups = expandIpv6(zoneless.toLowerCase());
  if (!groups) return value;
  const mapped =
    groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  if (mapped) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]
      .map(String)
      .join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':')}::/64`;
}

/** The eight 16-bit groups of a valid IPv6 address, or null. */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  const last = text.slice(lastColon + 1);
  if (last.includes('.')) {
    const octets = last.split('.').map(Number);
    tail.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    text = text.slice(0, lastColon + 1);
    // Drop the separator before the IPv4 tail, but keep a '::' marker.
    if (!text.endsWith('::')) text = text.slice(0, -1);
  }
  const parse = (part: string) =>
    part === '' ? [] : part.split(':').map((g) => parseInt(g, 16));
  const halves = text.split('::');
  const head = parse(halves[0]);
  const rest = halves.length > 1 ? parse(halves[1]) : [];
  const missing = 8 - tail.length - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...new Array(missing).fill(0), ...rest, ...tail];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g))
    ? groups
    : null;
}

import { OS_EOL_DATES } from './os-eol.data';

/**
 * Is a distribution release past its end of support?
 *
 * Trivy only computes its `EOSL` flag inside the vulnerability scanner. In
 * inventory mode (no database in the pod) that flag is gone, and the
 * "base OS no longer supported" alert would go dark exactly when it matters
 * most. The platform derives the answer from a static end-of-support table.
 *
 * Returns `null` when the family or the release is unknown to the table, so
 * the caller can keep whatever the scanner said instead of guessing.
 */
export function isOsEndOfLife(
  family: string | undefined,
  version: string | undefined,
  now: Date = new Date(),
): boolean | null {
  const cycles = OS_EOL_DATES[normalizeFamily(family)];
  if (!cycles) return null;
  const cycle = cycleFor(normalizeFamily(family), version);
  if (!cycle || !(cycle in cycles)) return null;
  const eol = cycles[cycle];
  if (eol === null) return false; // supported, no announced date
  return now.getTime() >= new Date(`${eol}T00:00:00Z`).getTime();
}

/** Trivy / scanner family names → table keys. */
function normalizeFamily(family: string | undefined): string {
  const f = (family ?? '').trim().toLowerCase();
  switch (f) {
    case 'rhel':
    case 'red hat':
      return 'redhat';
    case 'almalinux':
      return 'alma';
    case 'rockylinux':
    case 'rocky linux':
      return 'rocky';
    case 'oraclelinux':
    case 'oracle linux':
      return 'oracle';
    case 'amazonlinux':
    case 'amazon linux':
      return 'amazon';
    case 'sles':
      return 'suse';
    case 'opensuse-leap':
    case 'opensuse.leap':
      return 'opensuse';
    default:
      return f;
  }
}

/**
 * The release cycle endoflife.date keys on, per family: Alpine, Ubuntu,
 * openSUSE, SLES and Photon by major.minor; Debian, RHEL and its rebuilds,
 * CentOS, Fedora by major; Amazon Linux by its "2" / "2023" label.
 */
function cycleFor(family: string, version: string | undefined): string | null {
  const v = (version ?? '').trim();
  if (!v) return null;
  const parts = v.split('.');
  switch (family) {
    case 'alpine':
    case 'ubuntu':
    case 'opensuse':
    case 'suse':
    case 'photon':
      return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : parts[0];
    case 'amazon':
      return parts[0];
    default:
      return parts[0];
  }
}

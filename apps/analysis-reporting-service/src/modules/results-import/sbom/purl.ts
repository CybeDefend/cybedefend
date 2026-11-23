import { ecosystemOfPurlType } from '../sarif/ecosystems';

export { ecosystemOfPurlType };

/** A package URL (https://github.com/package-url/purl-spec), decoded. */
export interface ParsedPurl {
  /** Lower-cased. */
  type: string;
  namespace: string[];
  name: string;
  version: string | undefined;
}

/** The purl spec: a type is ASCII letters, digits, `.`, `+` and `-`. */
const PURL_TYPE = /^[a-z][a-z0-9.+-]{0,31}$/;

/** `decodeURIComponent`, or null on a malformed escape. */
const decode = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/**
 * Parses a purl, `pkg:type/namespace/name@version?qualifiers#subpath`, as
 * the purl spec reads it: the subpath and the qualifiers are dropped, the
 * version is what follows the last `@` after the last `/`, each segment is
 * percent-decoded. Null when it is no purl.
 */
export function parsePurl(purl: string): ParsedPurl | null {
  if (typeof purl !== 'string' || !/^pkg:/i.test(purl)) return null;
  let rest = purl.slice(4).replace(/^\/+/, '');
  const hash = rest.indexOf('#');
  if (hash >= 0) rest = rest.slice(0, hash);
  const query = rest.indexOf('?');
  if (query >= 0) rest = rest.slice(0, query);

  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const type = rest.slice(0, slash).toLowerCase();
  if (!PURL_TYPE.test(type)) return null;
  rest = rest.slice(slash + 1);

  let version: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at > rest.lastIndexOf('/') && at > 0) {
    const decoded = decode(rest.slice(at + 1));
    if (decoded === null) return null;
    version = decoded === '' ? undefined : decoded;
    rest = rest.slice(0, at);
  }

  const segments: string[] = [];
  for (const segment of rest.split('/')) {
    if (segment === '') continue;
    const decoded = decode(segment);
    if (decoded === null || decoded === '') return null;
    segments.push(decoded);
  }
  const name = segments.pop();
  if (name === undefined) return null;
  return { type, namespace: segments, name, version };
}

/**
 * The types whose namespace is a distribution or a vendor, not part of the
 * package's name (`pkg:deb/debian/curl` is `curl`, as Trivy and Grype name it).
 */
const DISTRIBUTION_TYPES: ReadonlySet<string> = new Set([
  'apk',
  'deb',
  'rpm',
  'alpm',
]);

/**
 * The package name and ecosystem a purl stands for, spelled as the SARIF
 * path writes them, so that a package lands on the same row whichever file
 * named it: an npm scope is kept (`@babel/code-frame`), Maven is
 * `group:artifact`, a Go module keeps its whole path.
 */
export function packageOfPurl(purl: ParsedPurl): {
  name: string;
  ecosystem: string;
} {
  const ecosystem = ecosystemOfPurlType(purl.type);
  if (purl.namespace.length === 0 || DISTRIBUTION_TYPES.has(purl.type)) {
    return { name: purl.name, ecosystem };
  }
  if (purl.type === 'maven') {
    return { name: `${purl.namespace.join('.')}:${purl.name}`, ecosystem };
  }
  return { name: `${purl.namespace.join('/')}/${purl.name}`, ecosystem };
}

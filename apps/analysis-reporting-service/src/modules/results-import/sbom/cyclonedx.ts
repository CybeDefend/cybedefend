import { parserStream as makeParser } from 'stream-json';
import type { Library } from '@grpc/analysis-reporting/result';
import {
  isSafePackageName,
  isSafePackageVersion,
} from '../../../core/utils/package-coordinates.util';
import {
  ImportError,
  MAX_IMPORT_JSON_DEPTH,
  SARIF_IMPORT_LIMITS,
  SarifSource,
} from '../sarif/import-limits';
import { decodeSarifBytes } from '../sarif/sarif-stream';
import { packageOfPurl, parsePurl } from './purl';

/**
 * The limits of the CycloneDX SBOM of an `sca` import: the SARIF's sizes
 * (50 MiB stored, 200 MiB decoded), as many components as a SARIF file has
 * results (nested ones counted), a bounded dependency graph, and at most
 * 500,000 license entries in the whole document (IMPORT_TOO_LARGE past it:
 * a few bytes of `{}` per entry would otherwise each cost a kept object).
 */
export const SBOM_IMPORT_LIMITS = {
  maxUploadedBytes: SARIF_IMPORT_LIMITS.maxUploadedBytes,
  maxDecompressedBytes: SARIF_IMPORT_LIMITS.maxDecompressedBytes,
  maxComponents: SARIF_IMPORT_LIMITS.maxResults,
  maxDependencies: 2 * SARIF_IMPORT_LIMITS.maxResults,
  maxDependencyEdges: 1_000_000,
  maxLicenses: 500_000,
} as const;

export type SbomLimits = { [K in keyof typeof SBOM_IMPORT_LIMITS]: number };

/** The CycloneDX versions whose JSON this reader knows. */
export const SUPPORTED_SPEC_VERSIONS: readonly string[] = [
  '1.4',
  '1.5',
  '1.6',
  '1.7',
];

/** Why a component is not a package of the inventory (counted, never logged with it). */
export type SbomSkip =
  | 'not_a_package'
  | 'no_purl'
  | 'invalid_purl'
  | 'no_version';

export interface SbomInventory {
  /** One library per (lower-cased name, version), in the order first seen. */
  packages: Library[];
  skipped: Map<SbomSkip, number>;
}

/** The component types that are packages; every other one is a graph node. */
const PACKAGE_TYPES: ReadonlySet<string> = new Set(['library', 'framework']);

/** `sca_detected_packages.licenseExpression` is a varchar(512). */
const MAX_LICENSE_EXPRESSION = 512;
const MAX_LICENSE = 128;
const MAX_LICENSES = 32;
/** `sca_detected_packages.fileName` is a varchar(255). */
const MAX_FILE = 255;
const MAX_NAME = 255;
/** A dependency path keeps its first entries, then the node it starts from. */
const MAX_PATH_PACKAGES = 31;

/** The property naming a package's file, by producer, in this order. */
const FILE_PROPERTIES = [
  'aquasecurity:trivy:FilePath',
  'syft:location:0:path',
  'SrcFile',
];
/** cdxgen marks a development dependency with this property. */
const DEV_PROPERTY = 'cdx:npm:package:development';
/** The only properties the reader keeps: any other one is never held. */
const KEPT_PROPERTIES: ReadonlySet<string> = new Set([
  ...FILE_PROPERTIES,
  DEV_PROPERTY,
]);

/** A distribution version may carry an epoch (`1:`) and a tilde. */
const DISTRIBUTION_TYPES: ReadonlySet<string> = new Set([
  'apk',
  'deb',
  'rpm',
  'alpm',
]);
const DISTRIBUTION_VERSION = /^[A-Za-z0-9][A-Za-z0-9._\-+:~]{0,127}$/;

/** U+0000 to U+001F and U+007F: never in a stored value. */
const CONTROL = /[\u0000-\u001f\u007f]/;

const invalid = (message: string): ImportError =>
  new ImportError('IMPORT_INVALID_SBOM', message);

interface LicenseChoice {
  id?: string;
  name?: string;
  expression?: string;
}

interface ComponentRecord {
  type?: string;
  name?: string;
  version?: string;
  purl?: string;
  bomRef?: string;
  scope?: string;
  licenses: LicenseChoice[];
  properties: Map<string, string>;
  locations: string[];
}

interface DependencyRecord {
  ref?: string;
  dependsOn: string[];
}

interface SbomDocument {
  bomFormat?: string;
  specVersion?: string;
  root: { bomRef?: string; name?: string };
  components: ComponentRecord[];
  /** null when the document has no `dependencies` array. */
  dependencies: DependencyRecord[] | null;
}

type Role =
  | 'root'
  | 'meta'
  | 'metaComponent'
  | 'components'
  | 'component'
  | 'licenses'
  | 'licenseChoice'
  | 'license'
  | 'properties'
  | 'property'
  | 'evidence'
  | 'occurrences'
  | 'occurrence'
  | 'dependencies'
  | 'dependency'
  | 'dependsOn'
  | 'other';

interface Frame {
  kind: 'object' | 'array';
  role: Role;
  pendingKey: string | null;
  component?: ComponentRecord;
  choice?: LicenseChoice;
  property?: { name?: string; value?: string };
  dependency?: DependencyRecord;
}

interface Token {
  name: string;
  value?: string | boolean | null;
}

/** The role of a value opened under `parent` at `key` (null in an array). */
function roleOf(
  parent: Frame | undefined,
  key: string | null,
  kind: 'object' | 'array',
): Role {
  if (!parent) return 'root';
  const object = kind === 'object';
  switch (parent.role) {
    case 'root':
      if (key === 'metadata' && object) return 'meta';
      if (key === 'components' && !object) return 'components';
      if (key === 'dependencies' && !object) return 'dependencies';
      return 'other';
    case 'meta':
      return key === 'component' && object ? 'metaComponent' : 'other';
    case 'metaComponent':
      return key === 'components' && !object ? 'components' : 'other';
    case 'components':
      return object ? 'component' : 'other';
    case 'component':
      if (key === 'components' && !object) return 'components';
      if (key === 'licenses' && !object) return 'licenses';
      if (key === 'properties' && !object) return 'properties';
      if (key === 'evidence' && object) return 'evidence';
      return 'other';
    case 'licenses':
      return object ? 'licenseChoice' : 'other';
    case 'licenseChoice':
      return key === 'license' && object ? 'license' : 'other';
    case 'properties':
      return object ? 'property' : 'other';
    case 'evidence':
      return key === 'occurrences' && !object ? 'occurrences' : 'other';
    case 'occurrences':
      return object ? 'occurrence' : 'other';
    case 'dependencies':
      return object ? 'dependency' : 'other';
    case 'dependency':
      return key === 'dependsOn' && !object ? 'dependsOn' : 'other';
    default:
      return 'other';
  }
}

/**
 * One pass over the stored SBOM: the top-level format fields, the root
 * component, every component (nested ones included) and the dependency
 * graph, kept as small records. Nothing else of the document (hashes,
 * descriptions, vulnerabilities, services) is held.
 */
async function readDocument(
  source: SarifSource,
  limits: SbomLimits,
): Promise<SbomDocument> {
  const raw = await source();
  const decoded = decodeSarifBytes(raw, limits);
  const parser = decoded.pipe(
    makeParser({
      packKeys: true,
      packStrings: true,
      packNumbers: true,
      streamValues: false,
    }),
  );

  return new Promise<SbomDocument>((resolve, reject) => {
    const doc: SbomDocument = {
      root: {},
      components: [],
      dependencies: null,
    };
    const stack: Frame[] = [];
    let rootKind: string | null = null;
    let componentCount = 0;
    let dependencyCount = 0;
    let edgeCount = 0;
    let licenseCount = 0;
    let stopped = false;

    const fail = (err: unknown): void => {
      if (stopped) return;
      stopped = true;
      parser.destroy();
      decoded.destroy();
      raw.destroy();
      // A parser's text can quote the document: never passed on.
      reject(
        err instanceof ImportError
          ? err
          : invalid('the SBOM is not a readable JSON document'),
      );
    };

    const nearest = (role: Role): Frame | undefined => {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].role === role) return stack[i];
      }
      return undefined;
    };

    /** The key of the value being read in `frame`, consumed. */
    const takeKey = (frame: Frame | undefined): string | null => {
      if (!frame || frame.kind !== 'object') return null;
      const key = frame.pendingKey;
      frame.pendingKey = null;
      return key;
    };

    const onString = (value: string): void => {
      const top = stack[stack.length - 1];
      const key = takeKey(top);
      switch (top?.role) {
        case 'root':
          if (key === 'bomFormat') doc.bomFormat = value;
          if (key === 'specVersion') doc.specVersion = value;
          break;
        case 'metaComponent':
          if (key === 'bom-ref') doc.root.bomRef = value;
          if (key === 'name') doc.root.name = value;
          break;
        case 'component': {
          const component = top.component;
          if (key === 'type') component.type = value;
          else if (key === 'name') component.name = value;
          else if (key === 'version') component.version = value;
          else if (key === 'purl') component.purl = value;
          else if (key === 'bom-ref') component.bomRef = value;
          else if (key === 'scope') component.scope = value;
          break;
        }
        case 'licenseChoice':
          if (key === 'expression') top.choice.expression = value;
          break;
        case 'license': {
          const choice = nearest('licenseChoice')?.choice;
          if (choice && key === 'id') choice.id = value;
          if (choice && key === 'name') choice.name = value;
          break;
        }
        case 'property':
          if (key === 'name') top.property.name = value;
          if (key === 'value') top.property.value = value;
          break;
        case 'occurrence': {
          const component = nearest('component')?.component;
          // Only the first location is read: the others are never held.
          if (
            component &&
            key === 'location' &&
            component.locations.length === 0
          ) {
            component.locations.push(value);
          }
          break;
        }
        case 'dependency':
          if (key === 'ref') top.dependency.ref = value;
          break;
        case 'dependsOn': {
          edgeCount += 1;
          if (edgeCount > limits.maxDependencyEdges) {
            throw invalid(
              `the SBOM has more than ${limits.maxDependencyEdges} dependency edges`,
            );
          }
          nearest('dependency')?.dependency.dependsOn.push(value);
          break;
        }
        default:
          break;
      }
    };

    const onOpen = (kind: 'object' | 'array'): void => {
      if (stack.length >= MAX_IMPORT_JSON_DEPTH) {
        throw invalid(
          `the SBOM nests values deeper than ${MAX_IMPORT_JSON_DEPTH} levels`,
        );
      }
      const parent = stack[stack.length - 1];
      const key = takeKey(parent);
      if (!parent) rootKind = kind;
      const role = roleOf(parent, key, kind);
      const frame: Frame = { kind, role, pendingKey: null };
      if (role === 'component') {
        componentCount += 1;
        if (componentCount > limits.maxComponents) {
          throw invalid(
            `the SBOM has more than ${limits.maxComponents} components`,
          );
        }
        frame.component = {
          licenses: [],
          properties: new Map(),
          locations: [],
        };
      } else if (role === 'licenseChoice') {
        licenseCount += 1;
        if (licenseCount > limits.maxLicenses) {
          throw new ImportError(
            'IMPORT_TOO_LARGE',
            `the SBOM has more than ${limits.maxLicenses} license entries`,
          );
        }
        frame.choice = {};
      } else if (role === 'property') {
        frame.property = {};
      } else if (role === 'dependencies') {
        doc.dependencies = doc.dependencies ?? [];
      } else if (role === 'dependency') {
        dependencyCount += 1;
        if (dependencyCount > limits.maxDependencies) {
          throw invalid(
            `the SBOM has more than ${limits.maxDependencies} dependency entries`,
          );
        }
        frame.dependency = { dependsOn: [] };
      }
      stack.push(frame);
    };

    const onClose = (): void => {
      const frame = stack.pop();
      if (!frame) return;
      switch (frame.role) {
        case 'component':
          doc.components.push(frame.component);
          break;
        case 'licenseChoice':
          nearest('component')?.component.licenses.push(frame.choice);
          break;
        case 'property': {
          const component = nearest('component')?.component;
          const { name, value } = frame.property;
          if (
            component &&
            name &&
            value !== undefined &&
            KEPT_PROPERTIES.has(name)
          ) {
            if (!component.properties.has(name)) {
              component.properties.set(name, value);
            }
          }
          break;
        }
        case 'dependency':
          doc.dependencies.push(frame.dependency);
          break;
        default:
          break;
      }
    };

    const processToken = (token: Token): void => {
      switch (token.name) {
        case 'keyValue': {
          const top = stack[stack.length - 1];
          if (top) top.pendingKey = String(token.value);
          break;
        }
        case 'startObject':
          onOpen('object');
          break;
        case 'startArray':
          onOpen('array');
          break;
        case 'endObject':
        case 'endArray':
          onClose();
          break;
        case 'stringValue':
          onString(String(token.value));
          break;
        default:
          // numbers, booleans, null: their key is consumed, nothing kept
          takeKey(stack[stack.length - 1]);
          break;
      }
    };

    parser.on('data', (token: Token) => {
      if (stopped) return;
      try {
        processToken(token);
      } catch (err) {
        fail(err);
      }
    });
    parser.on('end', () => {
      if (stopped) return;
      if (rootKind !== 'object') {
        fail(invalid('the root of the SBOM is not a JSON object'));
        return;
      }
      resolve(doc);
    });
    parser.on('error', fail);
    decoded.on('error', fail);
    raw.on('error', fail);
  });
}

/** A string we may store: no control character, at most `max` characters. */
const storable = (value: string | undefined, max: number): string | null =>
  typeof value === 'string' &&
  value !== '' &&
  value.length <= max &&
  !CONTROL.test(value)
    ? value
    : null;

/** PEP 503: the name pip compares (`typing_extensions` is `typing-extensions`). */
export const pep503 = (name: string): string =>
  name.toLowerCase().replace(/[-_.]+/g, '-');

/** A path an SBOM names, relative: `/go.mod` and `./go.mod` are `go.mod`. */
const relativeFile = (value: string | undefined): string | null => {
  const file = storable(value, MAX_FILE + 2);
  if (file === null) return null;
  return storable(file.replace(/^\.?\/+/, ''), MAX_FILE);
};

/** An SPDX expression of ids joined by AND / OR only, as its ids. */
const idsOfExpression = (expression: string): string[] => {
  const tokens = expression.replace(/[()]/g, ' ').trim().split(/\s+/);
  const ids: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (i % 2 === 1) {
      if (token !== 'AND' && token !== 'OR') return [];
      continue;
    }
    if (!/^[A-Za-z0-9.+-]+$/.test(token) || token === 'WITH') return [];
    ids.push(token);
  }
  return tokens.length % 2 === 1 ? ids : [];
};

/** The licenses of a component: SPDX ids, a name only when the choice has no id. */
function licensesOf(choices: LicenseChoice[]): {
  licenses: string[];
  expression?: string;
} {
  const licenses: string[] = [];
  let expression: string | undefined;
  const add = (value: string | undefined): void => {
    const license = storable(value, MAX_LICENSE);
    if (license === null || licenses.length >= MAX_LICENSES) return;
    if (!licenses.includes(license)) licenses.push(license);
  };
  for (const choice of choices) {
    if (choice.expression !== undefined) {
      const stored = storable(choice.expression, MAX_LICENSE_EXPRESSION);
      if (stored !== null && expression === undefined) {
        expression = stored;
        for (const id of idsOfExpression(stored)) add(id);
      }
    } else if (choice.id !== undefined) {
      add(choice.id);
    } else {
      add(choice.name);
    }
  }
  return expression === undefined ? { licenses } : { licenses, expression };
}

const isSafeVersion = (version: string, purlType: string): boolean =>
  DISTRIBUTION_TYPES.has(purlType)
    ? DISTRIBUTION_VERSION.test(version) && !version.includes('..')
    : isSafePackageVersion(version);

/** A package component, read: what the graph and the merge need. */
interface Candidate {
  record: ComponentRecord;
  name: string;
  version: string;
  ecosystem: string;
  licenses: string[];
  expression?: string;
  isDev: boolean;
}

/** The candidate of a package component, a skip reason, or a refusal. */
function candidateOf(record: ComponentRecord): Candidate | SbomSkip {
  if (!record.type || !PACKAGE_TYPES.has(record.type)) return 'not_a_package';
  if (!record.purl) return 'no_purl';
  const purl = parsePurl(record.purl);
  if (!purl) return 'invalid_purl';
  const version = purl.version ?? record.version;
  if (!version) return 'no_version';

  const fromPurl = packageOfPurl(purl);
  // purl lower-cases a Python name and folds `_` into `-`: the component's
  // own spelling is kept when it is the same name for pip.
  const name =
    purl.type === 'pypi' &&
    record.name &&
    pep503(record.name) === pep503(fromPurl.name)
      ? record.name
      : fromPurl.name;
  if (
    name.length > MAX_NAME ||
    !isSafePackageName(name) ||
    !isSafeVersion(version, purl.type)
  ) {
    // Never quoted: the value is whatever the file holds.
    throw invalid('a component names a package no registry could hold');
  }

  const { licenses, expression } = licensesOf(record.licenses);
  return {
    record,
    name,
    version,
    ecosystem: fromPurl.ecosystem,
    licenses,
    ...(expression !== undefined ? { expression } : {}),
    isDev:
      record.scope === 'excluded' ||
      record.properties.get(DEV_PROPERTY) === 'true',
  };
}

/** Where a candidate sits in the graph. */
interface Placement {
  transitive: boolean;
  path: string[];
  /** The graph node it is reached from, unless that is the document's root. */
  originFile: string | null;
}

/**
 * Direct or transitive, from the dependency graph: a package depended on by
 * the root or by a component that is not a package (Trivy puts one
 * application node per lockfile between them) is direct; any other package
 * reachable from them is transitive. A breadth-first walk from every such
 * node gives each package its shortest path. A package nothing reaches has
 * no placement (its dependency information is unknown).
 */
function placementsOf(
  doc: SbomDocument,
  candidates: Map<string, Candidate>,
  sources: { ref: string; name: string | null; isRoot: boolean }[],
): Map<string, Placement> {
  const edges = new Map<string, string[]>();
  for (const dependency of doc.dependencies ?? []) {
    if (!dependency.ref) continue;
    const list = edges.get(dependency.ref) ?? [];
    list.push(...dependency.dependsOn);
    edges.set(dependency.ref, list);
  }

  const sourceRefs = new Set(sources.map((source) => source.ref));
  const placements = new Map<string, Placement>();
  const parentOf = new Map<string, string>();
  const originOf = new Map<string, (typeof sources)[number]>();
  const queue: string[] = [];

  for (const source of sources) {
    for (const ref of edges.get(source.ref) ?? []) {
      if (sourceRefs.has(ref) || !candidates.has(ref) || originOf.has(ref)) {
        continue;
      }
      originOf.set(ref, source);
      queue.push(ref);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const ref = queue[head];
    for (const next of edges.get(ref) ?? []) {
      if (sourceRefs.has(next) || !candidates.has(next) || originOf.has(next)) {
        continue;
      }
      originOf.set(next, originOf.get(ref));
      parentOf.set(next, ref);
      queue.push(next);
    }
  }

  for (const [ref, origin] of originOf) {
    const chain: string[] = [];
    for (
      let at: string | undefined = ref;
      at !== undefined && chain.length < MAX_PATH_PACKAGES;
      at = parentOf.get(at)
    ) {
      const candidate = candidates.get(at);
      chain.push(`${candidate.name}@${candidate.version}`);
    }
    const originName = storable(origin.name ?? undefined, MAX_FILE);
    placements.set(ref, {
      transitive: parentOf.has(ref),
      path: originName === null ? chain : [...chain, originName],
      originFile: origin.isRoot ? null : relativeFile(origin.name ?? undefined),
    });
  }
  return placements;
}

const fileOf = (record: ComponentRecord): string | null => {
  for (const property of FILE_PROPERTIES) {
    const file = relativeFile(record.properties.get(property));
    if (file !== null) return file;
  }
  return relativeFile(record.locations[0]);
};

/** The inventory of a document: validated, placed, one library per package. */
function inventoryOf(doc: SbomDocument): SbomInventory {
  if (doc.bomFormat !== 'CycloneDX') {
    throw invalid('the SBOM is not a CycloneDX document');
  }
  if (!SUPPORTED_SPEC_VERSIONS.includes(doc.specVersion ?? '')) {
    throw invalid('the CycloneDX version of the SBOM is not supported');
  }

  const skipped = new Map<SbomSkip, number>();
  const ordered: Candidate[] = [];
  const byRef = new Map<string, Candidate>();
  const sources: { ref: string; name: string | null; isRoot: boolean }[] = [];
  if (doc.root.bomRef) {
    sources.push({
      ref: doc.root.bomRef,
      name: doc.root.name ?? null,
      isRoot: true,
    });
  }
  for (const record of doc.components) {
    const outcome = candidateOf(record);
    if (typeof outcome === 'string') {
      skipped.set(outcome, (skipped.get(outcome) ?? 0) + 1);
      // Any component that is not a package is a node packages hang from.
      if (outcome === 'not_a_package' && record.bomRef) {
        sources.push({
          ref: record.bomRef,
          name: record.name ?? null,
          isRoot: false,
        });
      }
      continue;
    }
    ordered.push(outcome);
    if (record.bomRef && !byRef.has(record.bomRef)) {
      byRef.set(record.bomRef, outcome);
    }
  }

  const hasGraph = (doc.dependencies ?? []).length > 0;
  const placements = hasGraph
    ? placementsOf(doc, byRef, sources)
    : new Map<string, Placement>();

  const libraries = new Map<string, Library>();
  for (const candidate of ordered) {
    const ref = candidate.record.bomRef;
    const placement =
      ref !== undefined && byRef.get(ref) === candidate
        ? placements.get(ref)
        : undefined;
    const key = `${candidate.name.toLowerCase()}@${candidate.version}`;
    const existing = libraries.get(key);
    if (existing) {
      // One row per name and version: direct wins, dev only if every copy is.
      if (placement) {
        existing.isTransitive = existing.dependencyInfoAvailable
          ? existing.isTransitive && placement.transitive
          : placement.transitive;
        existing.dependencyInfoAvailable = true;
      }
      existing.isDev = existing.isDev && candidate.isDev;
      for (const license of candidate.licenses) {
        if (
          existing.licenses.length < MAX_LICENSES &&
          !existing.licenses.includes(license)
        ) {
          existing.licenses.push(license);
        }
      }
      if (
        existing.licenseExpression === undefined &&
        candidate.expression !== undefined
      ) {
        existing.licenseExpression = candidate.expression;
      }
      continue;
    }
    const library: Library = {
      name: candidate.name,
      version: candidate.version,
      file: fileOf(candidate.record) ?? placement?.originFile ?? '',
      ecosystem: candidate.ecosystem,
      isTransitive: placement?.transitive ?? false,
      isDev: candidate.isDev,
      path: placement?.path ?? [],
      dependencyInfoAvailable: placement !== undefined,
      importLocations: [],
      licenses: candidate.licenses,
      ...(candidate.expression !== undefined
        ? { licenseExpression: candidate.expression }
        : {}),
    };
    libraries.set(key, library);
  }
  return { packages: [...libraries.values()], skipped };
}

/**
 * Reads the CycloneDX JSON SBOM of an `sca` import (1.4 to 1.7, gzip or
 * not), within its limits, into one library per package. A document that is
 * not CycloneDX, of another version, malformed, over a limit, or naming a
 * package with characters no registry uses is refused with
 * IMPORT_INVALID_SBOM (IMPORT_TOO_LARGE over a size limit); its messages
 * never quote the document.
 */
export async function readCycloneDx(
  source: SarifSource,
  limits: SbomLimits = SBOM_IMPORT_LIMITS,
): Promise<SbomInventory> {
  return inventoryOf(await readDocument(source, limits));
}

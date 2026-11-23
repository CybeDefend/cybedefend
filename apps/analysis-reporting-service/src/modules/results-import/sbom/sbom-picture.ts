import type { Library } from '@grpc/analysis-reporting/result';
import { pep503 } from './cyclonedx';

/** The key of a package row: `lower(trim(name))@version`, as ingestMatched groups. */
const keyOf = (name: string, version: string): string =>
  `${name.toLowerCase().trim()}@${version}`;

/**
 * The SBOM's packages, as one picture of the branch with the SARIF's
 * vulnerabilities. A vulnerable package keeps the SARIF's name, version and
 * advisories and takes what the SBOM knows of it (licenses, direct or
 * transitive, dependency path, dev); the packages no SARIF result names are
 * the rest of the inventory, ingested without advisories. A package is taken
 * once: the one copy ingested is the one finalize keeps.
 *
 * Python names are compared as pip does (PEP 503), since purl spells
 * `typing_extensions` as `typing-extensions`.
 */
export class SbomPicture {
  private readonly byKey = new Map<string, Library>();
  private readonly byPythonKey = new Map<string, Library>();
  private readonly taken = new Set<Library>();

  constructor(private readonly packages: Library[]) {
    for (const library of packages) {
      this.byKey.set(keyOf(library.name, library.version), library);
      if (library.ecosystem === 'PyPI') {
        this.byPythonKey.set(
          `${pep503(library.name)}@${library.version}`,
          library,
        );
      }
    }
  }

  get size(): number {
    return this.packages.length;
  }

  /** The SARIF's library of a vulnerable package, with the SBOM's facts. */
  complete(library: Library): Library {
    const sbom =
      this.byKey.get(keyOf(library.name, library.version)) ??
      this.byPythonKey.get(`${pep503(library.name)}@${library.version}`);
    if (!sbom) return library;
    this.taken.add(sbom);
    const known = (value: string): boolean =>
      value !== '' && value !== 'unknown';
    return {
      ...library,
      file: known(library.file) ? library.file : sbom.file,
      ecosystem: known(library.ecosystem) ? library.ecosystem : sbom.ecosystem,
      isTransitive: sbom.isTransitive,
      isDev: sbom.isDev,
      path: sbom.path,
      dependencyInfoAvailable: sbom.dependencyInfoAvailable,
      licenses: sbom.licenses,
      ...(sbom.licenseExpression !== undefined
        ? { licenseExpression: sbom.licenseExpression }
        : {}),
    };
  }

  /** The packages no vulnerable package took, in the SBOM's order. */
  remaining(): Library[] {
    return this.packages.filter((library) => !this.taken.has(library));
  }
}

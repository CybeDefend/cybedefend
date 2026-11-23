import type { ImportCategory } from './sarif-mapper';
import { SarifRule } from './sarif.types';

/**
 * The result kinds of the SCA and container imports.
 * A result's kind decides which import
 * type takes it, for all six types.
 */

export type ImportType = ImportCategory | 'sca' | 'container';
export type ResultKind =
  | 'vulnerability'
  | 'misconfiguration'
  | 'secret'
  | 'license';

const RESULT_KINDS: readonly ResultKind[] = [
  'vulnerability',
  'misconfiguration',
  'secret',
  'license',
];

/**
 * The kind of a result. Trivy carries it in the first tag of the rule;
 * Grype and osv-scanner report only vulnerabilities. Any other tool — or a
 * Trivy rule whose first tag is not a known kind — says nothing, and the
 * import's type takes the result (null). `toolName` is sanitised.
 */
export function resultKindOf(
  toolName: string,
  rule: SarifRule | undefined,
): ResultKind | null {
  if (toolName === 'trivy') {
    const tags = rule?.properties?.tags;
    const first =
      Array.isArray(tags) && typeof tags[0] === 'string'
        ? tags[0].toLowerCase()
        : undefined;
    return RESULT_KINDS.includes(first as ResultKind)
      ? (first as ResultKind)
      : null;
  }
  if (toolName === 'grype' || toolName === 'osv-scanner')
    return 'vulnerability';
  return null;
}

/**
 * Whether an import of `type` takes a result of `kind`. A null kind (the tool
 * says nothing) is always taken; a licence is never taken by any type.
 */
export function typeTakesKind(
  type: ImportType,
  kind: ResultKind | null,
): boolean {
  if (kind === null) return true;
  switch (kind) {
    case 'vulnerability':
      return type === 'sca' || type === 'container';
    case 'misconfiguration':
      return type === 'iac';
    case 'secret':
      return type === 'secret';
    case 'license':
      return false;
  }
}

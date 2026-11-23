import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as posix from 'node:path/posix';
import * as ts from 'typescript';

// Closed gRPC domains. The core never imports
// src/core/grpc/<closed domain>/ (generated code is gitignored; the
// handwritten files directly under src/core/grpc/ are scanned).
export const CLOSED_GRPC_DOMAINS: readonly string[] = [
  'billing',
  'vibedefend',
  'mcp',
  'business-rules',
  'security-rules',
  'agent',
  'ai',
  'security-champion',
  'crm-sync',
];

// Closed files inside exported directories.
export const CLOSED_GRPC_FILES: readonly string[] = [
  'analysis-reporting/mcp_inventory',
  'analysis-reporting/mcp_verify',
  'global-management/logto_webhook',
  'global-management/marketing_lead',
  // Container registry integrations (closed extension): the generated
  // clients are closed, so no core ever imports one back.
  'external-integrations/gitlab_container_registry',
  'external-integrations/dockerhub_container_registry',
  'external-integrations/gcr_container_registry',
  'external-integrations/github_container_registry',
  'external-integrations/ecr_container_registry',
  'external-integrations/acr_container_registry',
  'external-integrations/quay_container_registry',
  'external-integrations/harbor_container_registry',
  'external-integrations/jfrog_container_registry',
  'external-integrations/scaleway_container_registry',
  'external-integrations/container_registry_credentials',
];

// The only core files allowed to import src/ee/.
export const EE_IMPORTERS: readonly string[] = [
  'src/edition/ee-modules.ts',
  'src/edition/ee-secrets.ts',
  'src/edition/ee-observability.ts',
];

export type BoundaryRule = 'ee' | 'closed-grpc';

export interface BoundaryViolation {
  file: string;
  line: number;
  specifier: string;
  rule: BoundaryRule;
}

const CLOSED_DOMAIN_RE = new RegExp(
  `^core/grpc/(${CLOSED_GRPC_DOMAINS.join('|')})(/|$)`,
);
const CLOSED_FILE_RE = new RegExp(
  `^core/grpc/(${CLOSED_GRPC_FILES.join('|')})$`,
);

/**
 * Maps an import specifier to its path from the service's src/ ('' when the
 * specifier is a package import): relative specifiers are resolved against
 * the importing file, `src/…` is the tsconfig alias, `@grpc/…` maps to
 * src/core/grpc/….
 */
function targetInSrc(fileFromRoot: string, spec: string): string {
  if (spec.startsWith('.')) {
    return posix.relative(
      'src',
      posix.normalize(posix.join(posix.dirname(fileFromRoot), spec)),
    );
  }
  if (spec.startsWith('src/')) {
    return spec.slice('src/'.length);
  }
  if (spec.startsWith('@grpc/')) {
    return 'core/grpc/' + spec.slice('@grpc/'.length);
  }
  return '';
}

/**
 * Every import form and alias of one file: `import`, `import type`,
 * `export … from`, dynamic `import()` and `require()` are all collected by
 * ts.preProcessFile. `file` is the path from the service root, '/'-separated.
 */
export function findBoundaryViolations(
  file: string,
  text: string,
): BoundaryViolation[] {
  const preprocessed = ts.preProcessFile(text, true, true);
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const mayImportEe = EE_IMPORTERS.includes(file);
  const violations: BoundaryViolation[] = [];
  for (const ref of preprocessed.importedFiles) {
    const specifier = ref.fileName;
    const target = targetInSrc(file, specifier);
    let rule: BoundaryRule | undefined;
    if (!mayImportEe && (target === 'ee' || target.startsWith('ee/'))) {
      rule = 'ee';
    } else if (CLOSED_DOMAIN_RE.test(target) || CLOSED_FILE_RE.test(target)) {
      rule = 'closed-grpc';
    }
    if (rule) {
      violations.push({
        file,
        line: ts.getLineAndCharacterOfPosition(sourceFile, ref.pos).line + 1,
        specifier,
        rule,
      });
    }
  }
  return violations;
}

/**
 * Scans the service's src/ (except src/ee/, node_modules and the generated
 * subfolders of src/core/grpc/ — the handwritten files directly in
 * src/core/grpc/ are scanned) and returns the violations sorted by file then
 * line. Paths are '/'-separated, from the service root.
 */
export function scanServiceSources(serviceRoot: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          continue;
        }
        if (entryRel === 'src/ee') {
          continue;
        }
        if (entryRel.startsWith('src/core/grpc/')) {
          continue;
        }
        walk(join(dir, entry.name), entryRel);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.d.ts')
      ) {
        const text = readFileSync(join(dir, entry.name), 'utf8');
        violations.push(...findBoundaryViolations(entryRel, text));
      }
    }
  };
  walk(join(serviceRoot, 'src'), 'src');
  violations.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  return violations;
}

export function baselineKey(v: BoundaryViolation): string {
  return `${v.file}|${v.specifier}`;
}

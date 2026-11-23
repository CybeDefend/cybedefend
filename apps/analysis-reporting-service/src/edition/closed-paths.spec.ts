import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Path checks for the closed folders, next to edition-boundary.spec.ts: one
 * `it(...)` per folder moved out of the core.
 */
describe('closed paths', () => {
  it('src/modules/admin no longer exists', () => {
    expect(existsSync(join(__dirname, '../modules/admin'))).toBe(false);
  });

  it('src/modules/diff-scan-finding no longer exists', () => {
    expect(existsSync(join(__dirname, '../modules/diff-scan-finding'))).toBe(
      false,
    );
  });

  it('no core file imports the diff-scan module or entities', () => {
    // Modules/diff-scan-finding and the diff-scan entities live under
    // src/ee/; nothing outside src/ee may name their paths.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (
            /modules\/diff-scan-finding|entities\/diff-scan/.test(
              readFileSync(full, 'utf8'),
            )
          ) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('no core file imports the premium report modules or entity', () => {
    // Eu-ai-act-report, scanner-type-report and the
    // scanner-type-report entity live under src/ee/reports/; nothing outside
    // src/ee may name their paths.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (
            /modules\/reports\/eu-ai-act-report|modules\/reports\/scanner-type-report|entities\/scanner-type-report/.test(
              readFileSync(full, 'utf8'),
            )
          ) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    // The old folders hold no TypeScript file anymore (empty leftover
    // directories are invisible to git).
    const leftover = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const full = join(dir, e.name);
            if (e.isDirectory()) return leftover(full);
            return e.name.endsWith('.ts') ? [full] : [];
          })
        : [];
    expect(
      leftover(join(root, 'modules', 'reports', 'eu-ai-act-report')),
    ).toEqual([]);
    expect(
      leftover(join(root, 'modules', 'reports', 'scanner-type-report')),
    ).toEqual([]);
  });

  it('no core file imports an MCP module or entity', () => {
    // Mcp-inventory, mcp-verify and the MCP entities live under
    // src/ee/; nothing outside src/ee may name them.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (
            /mcp-inventory|mcp-verify|entities\/mcp/.test(
              readFileSync(full, 'utf8'),
            )
          ) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('no core file imports the SBOM module or entity', () => {
    // Reports/sbom and the SBOM entity live under
    // src/ee/reports/sbom/; nothing outside src/ee may name their paths.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (
            /modules\/reports\/sbom|entities\/sbom-report/.test(
              readFileSync(full, 'utf8'),
            )
          ) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    // The old folder holds no TypeScript file anymore (empty leftover
    // directories are invisible to git).
    const leftover = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const full = join(dir, e.name);
            if (e.isDirectory()) return leftover(full);
            return e.name.endsWith('.ts') ? [full] : [];
          })
        : [];
    expect(leftover(join(root, 'modules', 'reports', 'sbom'))).toEqual([]);
  });

  it('no core file imports the AI-BOM module, processor or entities', () => {
    // Modules/aibom, the AI-BOM processor and entities live under
    // src/ee/aibom/; nothing outside src/ee may name their paths. The core
    // reads the inventory through the AIBOM_INVENTORY token only.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (
            /modules\/aibom|aibom-queue\.processor|entities\/aibom-/.test(
              readFileSync(full, 'utf8'),
            )
          ) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    expect(existsSync(join(root, 'modules', 'aibom'))).toBe(false);
  });

  it('no core file imports the SCA autofix, git or autofix worker modules', () => {
    // Modules/sca-autofix, modules/git and the autofix worker
    // context live under src/ee/; nothing outside src/ee may name their
    // paths (worker.shutdown.spec.ts only says where its case went).
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (
            /modules\/sca-autofix|modules\/git\/|from '\.{1,2}\/worker-autofix/.test(
              readFileSync(full, 'utf8'),
            )
          ) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    expect(existsSync(join(root, 'modules', 'sca-autofix'))).toBe(false);
    expect(existsSync(join(root, 'modules', 'git'))).toBe(false);
    expect(existsSync(join(root, 'worker-autofix.module.ts'))).toBe(false);
  });

  it('no core file serves the findings export', () => {
    // The findings-export server part (module, controller, service)
    // lives under src/ee/; nothing outside src/ee may name it. src/core/grpc
    // is skipped: it is generated and keeps the FindingsExportService name
    // until that service is stripped from the exported proto. The
    // fingerprint/lifecycle/detection-bounds helpers stay core on purpose.
    const root = join(__dirname, '..');
    const grpc = join(root, 'core', 'grpc');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee' || full === grpc) continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (
            /FindingsExport(Module|Controller|Service)\b|findings-export\.(module|controller|service)/.test(
              readFileSync(full, 'utf8'),
            )
          ) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it('no core file imports OSV, EPSS or the live end-of-life lookup', () => {
    // OSV, EPSS, the live end-of-life lookup and the cron-osv
    // and cron-epss contexts live under src/ee/; the core reaches them only
    // through the advisory tokens. Every module specifier (static
    // import, dynamic import, require, jest.mock) is resolved against src/ so
    // that a relative '../osv/...' is caught too; comments that merely name
    // a file (a frozen migration among them) are not imports.
    const root = join(__dirname, '..');
    const grpc = join(root, 'core', 'grpc');
    const closed =
      /modules\/osv\/|modules\/epss\/|os-eol\.service|cvss-recalc\.enqueuer|cvss-recalc-enqueuer|container-osv-matching|epss-score\.entity|osv-sync-state|osv-ecosystem-sync-state|cron\.osv\.module|cron\.epss\.module/;
    const specifierRe =
      /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bjest\.mock\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;
    const asSrcPath = (file: string, spec: string): string => {
      if (spec.startsWith('.')) {
        return relative(root, resolve(dirname(file), spec))
          .split('\\')
          .join('/');
      }
      return spec.startsWith('src/') ? spec.slice('src/'.length) : spec;
    };
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee' || full === grpc) continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          const content = readFileSync(full, 'utf8');
          for (const m of content.matchAll(specifierRe)) {
            const spec = m[1];
            if (closed.test(spec) || closed.test(asSrcPath(full, spec))) {
              offenders.push(`${relative(root, full)} imports ${spec}`);
            }
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    // The emptied folders hold no TypeScript file anymore (empty leftover
    // directories are invisible to git).
    const leftover = (dir: string): string[] =>
      existsSync(dir)
        ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const full = join(dir, e.name);
            if (e.isDirectory()) return leftover(full);
            return e.name.endsWith('.ts') ? [full] : [];
          })
        : [];
    expect(leftover(join(root, 'modules', 'osv'))).toEqual([]);
    expect(leftover(join(root, 'modules', 'epss'))).toEqual([]);
  });

  it('no core file maps the agent category or SCA autofix job tables', () => {
    // Both are closed: the agent categories filter what the AI analysis
    // reviews, the job rows track the closed SCA autofix runs. Their
    // entities live under src/ee/ and the core neither declares nor names
    // them. The frozen MySQL track (not exported) and the generated gRPC
    // code are skipped.
    const root = join(__dirname, '..');
    const skipped = new Set([
      join(root, 'core', 'grpc'),
      join(root, 'core', 'migrations'),
    ]);
    const closed =
      /agent-category(-mapping)?\.entity|sca-autofix-job\.entity|\bAgentCategory(Mapping)?\b|\bScaAutoFixJob\b/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'ee' || skipped.has(full)) continue;
          walk(full);
        } else if (entry.name.endsWith('.ts') && full !== __filename) {
          if (closed.test(readFileSync(full, 'utf8'))) {
            offenders.push(relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
    for (const file of [
      'entities/vulnerability/agent-category.entity.ts',
      'entities/vulnerability/agent-category-mapping.entity.ts',
      'entities/sca-autofix-job.entity.ts',
    ]) {
      expect([file, existsSync(join(root, file))]).toEqual([file, false]);
    }
  });

  it('no OSV or EPSS context is left in the core', () => {
    // Both contexts and their entry points are ee-only.
    const root = join(__dirname, '..');
    for (const file of [
      'cron.osv.module.ts',
      'cron.epss.module.ts',
      'main.cron-osv.ts',
      'main.cron-epss.ts',
    ]) {
      expect(existsSync(join(root, file))).toBe(false);
    }
  });
});

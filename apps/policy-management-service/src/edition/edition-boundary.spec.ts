import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOSED_GRPC_DOMAINS,
  CLOSED_GRPC_FILES,
  EE_IMPORTERS,
  baselineKey,
  findBoundaryViolations,
  scanServiceSources,
} from './edition-boundary.rules';

const SERVICE_ROOT = join(__dirname, '..', '..');
const f = 'src/modules/scan/scan.service.ts';

describe('findBoundaryViolations', () => {
  it('flags a relative import into src/ee', () => {
    expect(
      findBoundaryViolations(f, "import { X } from '../../ee/foo';"),
    ).toEqual([{ file: f, line: 1, specifier: '../../ee/foo', rule: 'ee' }]);
  });

  it('flags the src/ alias into src/ee', () => {
    expect(
      findBoundaryViolations(f, "import { X } from 'src/ee/bar/baz';"),
    ).toEqual([{ file: f, line: 1, specifier: 'src/ee/bar/baz', rule: 'ee' }]);
  });

  it('lets src/edition/ee-modules.ts import src/ee', () => {
    expect(
      findBoundaryViolations(
        'src/edition/ee-modules.ts',
        "import { EE_FEATURE_MODULES } from '../ee/ee-feature-modules';",
      ),
    ).toEqual([]);
  });

  it('lets src/edition/ee-secrets.ts import src/ee', () => {
    expect(
      findBoundaryViolations(
        'src/edition/ee-secrets.ts',
        "import { CloudSecretsSource } from '../ee/edition/secrets.cloud';",
      ),
    ).toEqual([]);
  });

  it('lets src/edition/ee-observability.ts import src/ee', () => {
    expect(
      findBoundaryViolations(
        'src/edition/ee-observability.ts',
        "import { fetchToken } from '../ee/observability/otel-token-fetcher';",
      ),
    ).toEqual([]);
  });

  it('does not let another edition file import src/ee', () => {
    expect(
      findBoundaryViolations(
        'src/edition/edition-imports.ts',
        "import { EE_FEATURE_MODULES } from '../ee/ee-feature-modules';",
      ),
    ).toEqual([
      {
        file: 'src/edition/edition-imports.ts',
        line: 1,
        specifier: '../ee/ee-feature-modules',
        rule: 'ee',
      },
    ]);
  });

  it.each([
    '@grpc/billing/billing',
    'src/core/grpc/agent/agent',
    '../../core/grpc/crm-sync/crm_sync',
    '@grpc/vibedefend/agent_sessions',
    '@grpc/security-champion/security_champion',
    '@grpc/analysis-reporting/mcp_inventory',
    '@grpc/analysis-reporting/mcp_verify',
    '@grpc/global-management/logto_webhook',
    '@grpc/global-management/marketing_lead',
    '@grpc/ai/enum',
  ])('flags the closed gRPC client %s', (specifier) => {
    expect(
      findBoundaryViolations(f, `import { X } from '${specifier}';`),
    ).toEqual([{ file: f, line: 1, specifier, rule: 'closed-grpc' }]);
  });

  it.each([
    '@grpc/grpc-js',
    '@grpc/proto-loader',
    '@grpc/analysis-reporting/result',
    '@grpc/global-management/user',
    '@grpc/aibom/x',
    './eel/x',
    '../free/ee-like',
    'src/core/grpc/wrapper-grpc.module',
  ])('does not flag %s', (specifier) => {
    expect(
      findBoundaryViolations(f, `import { X } from '${specifier}';`),
    ).toEqual([]);
  });

  it('sees import type, export from, dynamic import and require', () => {
    const text = [
      "import type { X } from '@grpc/billing/billing';",
      "export { Y } from '@grpc/billing/billing';",
      "const m = import('@grpc/billing/billing');",
      "const n = require('@grpc/billing/billing');",
    ].join('\n');
    expect(findBoundaryViolations(f, text)).toEqual([
      {
        file: f,
        line: 1,
        specifier: '@grpc/billing/billing',
        rule: 'closed-grpc',
      },
      {
        file: f,
        line: 2,
        specifier: '@grpc/billing/billing',
        rule: 'closed-grpc',
      },
      {
        file: f,
        line: 3,
        specifier: '@grpc/billing/billing',
        rule: 'closed-grpc',
      },
      {
        file: f,
        line: 4,
        specifier: '@grpc/billing/billing',
        rule: 'closed-grpc',
      },
    ]);
  });

  it('reports the line of the import', () => {
    const text = "\n\nimport { X } from '@grpc/billing/billing';";
    expect(findBoundaryViolations(f, text)).toEqual([
      {
        file: f,
        line: 3,
        specifier: '@grpc/billing/billing',
        rule: 'closed-grpc',
      },
    ]);
  });
});

describe('the service sources', () => {
  const baselinePath = join(__dirname, 'edition-boundary.baseline.json');
  const baseline: string[] = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const found = scanServiceSources(SERVICE_ROOT);
  const foundKeys = new Set(found.map(baselineKey));

  it('import nothing from ee/ nor a closed gRPC client beyond the baseline', () => {
    const baselineSet = new Set(baseline);
    expect(
      found
        .filter((v) => !baselineSet.has(baselineKey(v)))
        .map((v) => `${v.file}:${v.line} imports '${v.specifier}' (${v.rule})`),
    ).toEqual([]);
  });

  it('lists in the baseline only imports the code still has', () => {
    expect([...baseline].filter((k) => !foundKeys.has(k))).toEqual([]);
  });

  it('keeps the baseline sorted and unique', () => {
    expect([...baseline].sort()).toEqual(baseline);
    expect(new Set(baseline).size).toBe(baseline.length);
    expect(readFileSync(baselinePath, 'utf8').endsWith('\n')).toBe(true);
  });

  it('names every closed domain and file in the ESLint rule', () => {
    const eslintRule = readFileSync(
      join(__dirname, 'edition-boundary.eslint.mjs'),
      'utf8',
    );
    for (const entry of [
      ...CLOSED_GRPC_DOMAINS,
      ...CLOSED_GRPC_FILES,
      ...EE_IMPORTERS,
    ]) {
      expect(eslintRule).toContain(entry);
    }
  });
});

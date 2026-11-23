import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Mirrors src/edition/edition-boundary.rules.ts. edition-boundary.spec.ts
// scans this file and pins every closed domain, closed file and ee importer
// into it, so keep the three lists in sync with the rules file.
const CLOSED_GRPC_DOMAINS = [
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

const CLOSED_GRPC_FILES = [
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

const EE_IMPORTERS = [
  'src/edition/ee-modules.ts',
  'src/edition/ee-secrets.ts',
  'src/edition/ee-observability.ts',
];

const GRPC_PREFIX = '(@grpc/|(\\.\\./)*(\\./)?(src/)?core/grpc/)';

/**
 * Appended as the last entries of the service's eslint.config.mjs:
 *
 *   ...editionBoundaryConfigs(__dirname)
 *
 * The first block forbids, in every core file, the imports into src/ee/ and
 * the closed gRPC clients (the same rules edition-boundary.rules.ts enforces
 * in the spec). The second block turns the rule off on the files listed in
 * src/edition/edition-boundary.baseline.json, the initial allow-list; it is
 * omitted while the baseline is empty.
 *
 * @param {string} serviceDir absolute path of the service root
 * @returns {import('eslint').Linter.Config[]}
 */
export function editionBoundaryConfigs(serviceDir) {
  const baseline = JSON.parse(
    readFileSync(
      join(serviceDir, 'src/edition/edition-boundary.baseline.json'),
      'utf8',
    ),
  );
  const configs = [
    {
      files: ['src/**/*.ts'],
      ignores: ['src/ee/**', ...EE_IMPORTERS, 'src/core/grpc/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '(^|/)ee(/|$)',
                message:
                  'The core never imports src/ee/. Register closed code through src/edition/ee-modules.ts.',
              },
              {
                regex: `${GRPC_PREFIX}(${CLOSED_GRPC_DOMAINS.join('|')})(/|$)`,
                message: 'Closed gRPC client: use a port.',
              },
              {
                regex: `${GRPC_PREFIX}(${CLOSED_GRPC_FILES.join('|')})$`,
                message: 'Closed proto file: use a port.',
              },
            ],
          },
        ],
      },
    },
  ];
  const baselineFiles = [...new Set(baseline.map((key) => key.split('|')[0]))];
  if (baselineFiles.length > 0) {
    configs.push({
      files: baselineFiles,
      rules: { 'no-restricted-imports': 'off' },
    });
  }
  return configs;
}

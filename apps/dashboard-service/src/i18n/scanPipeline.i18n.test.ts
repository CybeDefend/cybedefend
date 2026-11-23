import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ContainerDto, ScanPipelineDto, ScanResponseDto } from '@/server/interfaces/Scan';
import {
  AGENT_STAGES,
  OUTCOME_REASONS,
  PIPELINE_I18N,
  QUEUE_REASONS,
  SCANNER_TYPES,
  buildScanPipelineView,
  type I18nText,
  type ScanPipelineViewModel,
} from '@/utils/function/scanPipelineView';

/**
 * The pipeline panel only ever shows translated text: every stage, outcome
 * code, queue reason, headline and banner is a key. A key missing from one
 * locale renders as its dotted path, and a translation that drops a
 * `{{placeholder}}` shows the raw braces — so both are checked here, in `en`
 * and `fr` (repo rule: the two are updated together, no `defaultValue`).
 */
const LOCALES = path.resolve(__dirname, 'locales');
const FILE = path.join('components', 'analyseWrapper', 'pipeline.json');

type Tree = { [key: string]: string | Tree };

function load(lng: 'en' | 'fr'): Tree {
  const file = path.join(LOCALES, lng, FILE);
  if (!fs.existsSync(file)) return {};
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Tree;
  // The fragment carries its full namespace, like its siblings in the folder.
  let node: string | Tree | undefined = raw;
  for (const segment of PIPELINE_I18N.split('.')) {
    node = typeof node === 'object' ? node[segment] : undefined;
  }
  return typeof node === 'object' ? node : {};
}

function leaves(tree: Tree, prefix = '', acc: string[] = []): string[] {
  for (const [k, v] of Object.entries(tree)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') acc.push(p);
    else leaves(v, p, acc);
  }
  return acc;
}

const locales = { en: load('en'), fr: load('fr') };

/** The translation of a full `components.analyseWrapper.pipeline.*` key, or undefined. */
function lookup(lng: 'en' | 'fr', fullKey: string): string | undefined {
  if (!fullKey.startsWith(`${PIPELINE_I18N}.`)) return undefined;
  let node: string | Tree | undefined = locales[lng];
  for (const segment of fullKey.slice(PIPELINE_I18N.length + 1).split('.')) {
    node = typeof node === 'object' ? node[segment] : undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

/** Every key a scan can make the view model emit, gathered by running it over every case. */
function emittedTexts(): I18nText[] {
  const now = new Date('2026-09-25T12:00:00Z');
  const since = new Date(now.getTime() - 75 * 60_000).toISOString();
  const recent = new Date(now.getTime() - 5 * 60_000).toISOString();
  const container = (over: Partial<ContainerDto>): ContainerDto => ({
    id: 'c',
    status: 'running',
    createdAt: '',
    startedAt: '',
    finishedAt: '',
    scanId: 's',
    ...over,
  });
  const scanners = SCANNER_TYPES.flatMap((type, i) =>
    ['starting', 'running', 'completed', 'failed'].map((status) =>
      container({ id: `${type}-${i}-${status}`, status, image: `appsec-${type}` }),
    ),
  );
  const lanes = [
    { total: 0, open: 0, completed: 0, failed: 0 },
    { total: 4, open: 2, completed: 2, failed: 0 },
    { total: 4, open: 0, completed: 3, failed: 1 },
    { total: 4, open: 0, completed: 4, failed: 0 },
  ];
  const agents: Array<NonNullable<ScanPipelineDto['agent']>> = AGENT_STAGES.flatMap((stage) => [
    { stage },
    { stage, aiQueuePosition: 3, processed: 12, total: 40, stageSince: since, stageDeadline: now.toISOString() },
    { stage, stageSince: recent },
    { stage, stageSince: now.toISOString() },
    ...[...OUTCOME_REASONS, 'brand_new_code'].map((outcomeReason) => ({ stage, outcomeReason })),
  ]);

  const scans: ScanResponseDto[] = [];
  for (const state of ['waiting_for_file', 'queued', 'running', 'completed', 'failed', 'cancelled', '']) {
    for (const scanLane of lanes) {
      for (const agent of agents) {
        for (const slotReleased of [false, true]) {
          scans.push({
            id: 's',
            state,
            containers: scanners,
            pipeline: { slotReleased, scanners: scanLane, agent, queuePosition: 2, queueReason: 'org_limit' },
          } as ScanResponseDto);
          scans.push({ ...scans[scans.length - 1], step: 'processing results' });
        }
      }
    }
    for (const queueReason of [...QUEUE_REASONS, 'brand_new_reason', undefined]) {
      const containers: ContainerDto[] = [];
      scans.push({
        id: 's',
        state,
        containers,
        pipeline: { slotReleased: false, queueReason, agent: { stage: 'not_applicable' } },
      } as ScanResponseDto);
    }
  }
  // One status per scan, so that every chip state shows up, not only the
  // `running` a mixed set of containers aggregates to.
  for (const status of ['starting', 'running', 'completed', 'completed_degraded', 'failed']) {
    scans.push({
      id: 's',
      state: 'running',
      containers: SCANNER_TYPES.map((type) => container({ id: type, status, image: `appsec-${type}` })),
    } as ScanResponseDto);
  }

  const collect = (vm: ScanPipelineViewModel): I18nText[] => [
    vm.headline,
    ...vm.banners,
    ...(vm.scannerSummary ? [vm.scannerSummary] : []),
    ...vm.scanners.flatMap((chip) => [chip.label, chip.stateLabel]),
    ...(vm.ai
      ? [vm.ai.label, ...vm.ai.steps.map((s) => s.label), vm.ai.reason, vm.ai.elapsed, vm.ai.limit].filter(
          (t): t is I18nText => Boolean(t),
        )
      : []),
  ];
  return scans.flatMap((s) => collect(buildScanPipelineView(s, now)));
}

/** Keys the panel asks for by name, on top of what the view model emits. */
const STATIC_KEYS = ['title', 'lane.scanners', 'lane.ai'];

describe('scan pipeline translations (en / fr)', () => {
  it('exist in both locales', () => {
    expect(leaves(locales.en).length, `en/${FILE} is missing or empty`).toBeGreaterThan(0);
    expect(leaves(locales.fr).length, `fr/${FILE} is missing or empty`).toBeGreaterThan(0);
  });

  it('carry the same keys in en and fr', () => {
    expect(leaves(locales.fr).sort()).toEqual(leaves(locales.en).sort());
  });

  it('name every stage, every outcome code plus unknown, every queue reason and every scanner type', () => {
    const required = [
      ...AGENT_STAGES.filter((s) => s !== 'not_applicable').map((s) => `stage.${s}`),
      ...[...OUTCOME_REASONS, 'unknown'].map((r) => `reason.${r}`),
      ...QUEUE_REASONS.map((r) => `queue.${r}`),
      ...SCANNER_TYPES.map((t) => `scanner.${t}`),
      'banner.slotReleased',
      'banner.resultsSaving',
      'queue.position',
      ...STATIC_KEYS,
    ];
    for (const lng of ['en', 'fr'] as const) {
      const missing = required.filter((k) => !lookup(lng, `${PIPELINE_I18N}.${k}`)?.trim());
      expect(missing, `${lng}: missing or blank`).toEqual([]);
    }
  });

  it('translate every key the view model can emit, with exactly the placeholders it fills', () => {
    const problems = new Set<string>();
    for (const t of emittedTexts()) {
      const params = Object.keys(t.params ?? {}).sort();
      for (const lng of ['en', 'fr'] as const) {
        const value = lookup(lng, t.key);
        if (!value?.trim()) {
          problems.add(`${lng}: ${t.key} is missing`);
          continue;
        }
        if (placeholders(value).join(',') !== params.join(',')) {
          problems.add(`${lng}: ${t.key} uses {${placeholders(value)}} but is given {${params}}`);
        }
      }
    }
    expect([...problems]).toEqual([]);
  });

  it('translate to French rather than copy the English sentences', () => {
    const copied = leaves(locales.en).filter((k) => {
      const en = lookup('en', `${PIPELINE_I18N}.${k}`) ?? '';
      // Acronyms and product names (SAST, CI/CD, AI-BOM) read the same in both.
      return en.includes(' ') && en === lookup('fr', `${PIPELINE_I18N}.${k}`);
    });
    expect(copied).toEqual([]);
  });
});

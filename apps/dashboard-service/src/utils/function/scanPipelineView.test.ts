import { describe, it, expect } from 'vitest';
import type { ContainerDto, ScanPipelineDto, ScanResponseDto } from '@/server/interfaces/Scan';
import { buildScanPipelineView, OUTCOME_REASONS, QUEUE_REASONS } from './scanPipelineView';

const K = 'components.analyseWrapper.pipeline';
const NOW = new Date('2026-09-25T12:00:00Z');
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

const container = (over: Partial<ContainerDto>): ContainerDto => ({
  id: 'c',
  status: 'running',
  createdAt: '',
  startedAt: '',
  finishedAt: '',
  scanId: 's1',
  ...over,
});

const scan = (over: Partial<ScanResponseDto> = {}): ScanResponseDto =>
  ({ id: 's1', state: 'running', containers: [], ...over }) as ScanResponseDto;

const lane = (total: number, open: number, completed: number, failed: number) => ({ total, open, completed, failed });

const withPipeline = (p: Partial<ScanPipelineDto>, over: Partial<ScanResponseDto> = {}): ScanResponseDto =>
  scan({
    ...over,
    pipeline: { slotReleased: false, scanners: lane(0, 0, 0, 0), agent: { stage: 'not_applicable' }, ...p },
  });

const view = (s: ScanResponseDto) => buildScanPipelineView(s, NOW);
const chips = (s: ScanResponseDto) => view(s).scanners.map(({ type, state }) => ({ type, state }));

describe('buildScanPipelineView', () => {
  describe('queued scans', () => {
    it('shows the queue position and why the scan waits', () => {
      const vm = view(
        withPipeline({ queuePosition: 2, queueReason: 'org_limit' }, { state: 'queued' }),
      );
      expect(vm.headline).toEqual({ key: `${K}.headline.queued`, params: { position: 2 } });
      expect(vm.banners).toEqual([
        { key: `${K}.queue.position`, params: { position: 2 } },
        { key: `${K}.queue.org_limit` },
      ]);
      expect(vm.bannerTone).toBe('info');
      expect(vm.ai).toBeNull();
      expect(vm.fromPipeline).toBe(true);
      expect(vm.isEmpty).toBe(false);
    });

    it.each(QUEUE_REASONS.map((r) => [r]))('names the %s queue reason', (reason) => {
      const vm = view(withPipeline({ queuePosition: 1, queueReason: reason }, { state: 'queued' }));
      expect(vm.banners).toContainEqual({ key: `${K}.queue.${reason}` });
    });

    it('stays readable without a position or with a reason it does not know', () => {
      const vm = view(withPipeline({ queueReason: 'brand_new_reason' }, { state: 'queued' }));
      expect(vm.headline).toEqual({ key: `${K}.headline.queuedNoPosition` });
      expect(vm.banners).toEqual([]);
      expect(vm.isEmpty).toBe(true);
    });
  });

  describe('banners', () => {
    it('announces the released slot while the AI runs', () => {
      const vm = view(
        withPipeline({
          slotReleased: true,
          scanners: lane(5, 0, 5, 0),
          agent: {
            stage: 'analyzing',
            processed: 45,
            total: 165,
            stageSince: '2026-09-25T10:00:00Z',
            stageDeadline: '2026-09-25T12:00:00Z',
          },
        }),
      );
      expect(vm.headline).toEqual({ key: `${K}.headline.aiAnalyzing`, params: { processed: 45, total: 165 } });
      expect(vm.banners).toEqual([{ key: `${K}.banner.slotReleased` }]);
      expect(vm.bannerTone).toBe('success');
      expect(vm.ai).toMatchObject({ stage: 'analyzing', progress: { processed: 45, total: 165 }, tone: 'active' });
    });

    it('says the scanner results are ready without claiming the slot when the scan still holds it', () => {
      const vm = view(
        withPipeline({ slotReleased: false, scanners: lane(5, 0, 5, 0), agent: { stage: 'queued_for_ai' } }),
      );
      expect(vm.banners).toEqual([{ key: `${K}.banner.scannersDone` }]);
    });

    it('says the results are being saved, not ready, while the scan is held for its results', () => {
      const vm = view(
        withPipeline(
          { slotReleased: true, scanners: lane(5, 0, 5, 0), agent: { stage: 'not_applicable' } },
          { step: 'processing results', progress: 99 },
        ),
      );
      expect(vm.banners).toEqual([{ key: `${K}.banner.resultsSaving` }]);
      expect(vm.bannerTone).toBe('info');
    });

    it('does not announce released scanner results when no agent is at work', () => {
      const vm = view(
        withPipeline({ slotReleased: true, scanners: lane(5, 0, 5, 0), agent: { stage: 'not_applicable' } }),
      );
      expect(vm.banners).toEqual([]);
    });

    it('shows no banner while the scanners run', () => {
      const vm = view(withPipeline({ scanners: lane(5, 2, 3, 0), agent: { stage: 'ingesting' } }));
      expect(vm.banners).toEqual([]);
    });
  });

  describe('AI lane', () => {
    it.each([
      ['queued_for_ai', { aiQueuePosition: 3 }, `${K}.stage.queued_for_ai`, { position: 3 }],
      ['ingesting', {}, `${K}.stage.ingesting`, undefined],
      ['waiting_for_scanners', {}, `${K}.stage.waiting_for_scanners`, undefined],
    ] as const)('labels the %s stage', (stage, extra, key, params) => {
      const vm = view(withPipeline({ scanners: lane(1, 1, 0, 0), agent: { stage, ...extra } }));
      expect(vm.ai?.label).toEqual(params ? { key, params } : { key });
      expect(vm.ai?.tone).toBe('active');
    });

    it('uses the plain step label when the AI queue position or the progress is unknown', () => {
      const queued = view(withPipeline({ scanners: lane(1, 0, 1, 0), agent: { stage: 'queued_for_ai' } }));
      expect(queued.ai?.label).toEqual({ key: `${K}.step.queued_for_ai` });
      const analyzing = view(withPipeline({ scanners: lane(1, 0, 1, 0), agent: { stage: 'analyzing' } }));
      expect(analyzing.ai?.label).toEqual({ key: `${K}.step.analyzing` });
      expect(analyzing.ai?.progress).toBeUndefined();
    });

    it('shows 0/N as soon as the analysis starts', () => {
      const vm = view(
        withPipeline({ scanners: lane(1, 0, 1, 0), agent: { stage: 'analyzing', processed: 0, total: 165 } }),
      );
      expect(vm.ai?.label).toEqual({ key: `${K}.stage.analyzing`, params: { processed: 0, total: 165 } });
      expect(vm.ai?.progress).toEqual({ processed: 0, total: 165, percent: 0 });
    });

    it('never draws a progress bar past its end', () => {
      const vm = view(
        withPipeline({ scanners: lane(1, 0, 1, 0), agent: { stage: 'analyzing', processed: 170, total: 165 } }),
      );
      expect(vm.ai?.progress).toEqual({ processed: 165, total: 165, percent: 100 });
    });

    it.each([
      ['skipped', 'ai_queue_timeout', 'warning'],
      ['interrupted', 'analysis_timeout', 'warning'],
      ['failed', 'service_unavailable', 'danger'],
      ['done', undefined, 'success'],
    ] as const)('shows the %s outcome with its reason', (stage, reason, tone) => {
      const vm = view(
        withPipeline(
          { scanners: lane(1, 0, 1, 0), agent: { stage, outcomeReason: reason } },
          { state: 'completed' },
        ),
      );
      expect(vm.ai?.stage).toBe(stage);
      expect(vm.ai?.label).toEqual({ key: `${K}.stage.${stage}` });
      expect(vm.ai?.tone).toBe(tone);
      expect(vm.ai?.reason).toEqual(reason ? { key: `${K}.reason.${reason}` } : undefined);
    });

    it.each(OUTCOME_REASONS.map((r) => [r]))('names the %s outcome code', (reason) => {
      const vm = view(
        withPipeline({ scanners: lane(1, 0, 1, 0), agent: { stage: 'failed', outcomeReason: reason } }, { state: 'completed' }),
      );
      expect(vm.ai?.reason).toEqual({ key: `${K}.reason.${reason}` });
    });

    it('names an analysis turned off for the project (disabled_for_project) as a skip', () => {
      const vm = view(
        withPipeline(
          { scanners: lane(1, 0, 1, 0), agent: { stage: 'skipped', outcomeReason: 'disabled_for_project' } },
          { state: 'completed' },
        ),
      );
      expect(vm.ai?.reason).toEqual({ key: `${K}.reason.disabled_for_project` });
      expect(vm.ai?.tone).toBe('warning');
    });

    it('falls back to a generic label for an unknown reason', () => {
      const vm = view(
        withPipeline(
          { scanners: lane(1, 0, 1, 0), agent: { stage: 'failed', outcomeReason: 'brand_new_code' } },
          { state: 'completed' },
        ),
      );
      expect(vm.ai?.reason).toEqual({ key: `${K}.reason.unknown` });
    });

    it('shows no reason when a closed agent carries none', () => {
      const vm = view(withPipeline({ scanners: lane(1, 0, 1, 0), agent: { stage: 'failed' } }, { state: 'completed' }));
      expect(vm.ai?.reason).toBeUndefined();
      expect(vm.ai?.tone).toBe('danger');
    });

    it('has no AI lane when the scan has no agent', () => {
      expect(view(withPipeline({ scanners: lane(2, 1, 1, 0) })).ai).toBeNull();
    });

    it('steps through the five steps, the current one carrying its detail', () => {
      const vm = view(
        withPipeline({ scanners: lane(2, 0, 2, 0), agent: { stage: 'queued_for_ai', aiQueuePosition: 2 } }),
      );
      expect(vm.ai?.steps).toEqual([
        { id: 'ingesting', label: { key: `${K}.step.ingesting` }, state: 'done' },
        { id: 'waiting_for_scanners', label: { key: `${K}.step.waiting_for_scanners` }, state: 'done' },
        { id: 'queued_for_ai', label: { key: `${K}.stage.queued_for_ai`, params: { position: 2 } }, state: 'current' },
        { id: 'analyzing', label: { key: `${K}.step.analyzing` }, state: 'upcoming' },
        { id: 'outcome', label: { key: `${K}.step.outcome` }, state: 'upcoming' },
      ]);
    });

    it('drops the stepper once the AI has an outcome', () => {
      const vm = view(
        withPipeline(
          { scanners: lane(1, 0, 1, 0), agent: { stage: 'skipped', outcomeReason: 'parse_timeout' } },
          { state: 'completed' },
        ),
      );
      expect(vm.ai?.steps).toEqual([]);
    });
  });

  describe('elapsed time and time limit', () => {
    const analyzing = (agent: Partial<NonNullable<ScanPipelineDto['agent']>>) =>
      view(withPipeline({ scanners: lane(1, 0, 1, 0), agent: { stage: 'analyzing', ...agent } }));

    it('reports the time spent in the current stage and when its limit falls', () => {
      // Built from local time so the expected HH:MM holds in every time zone.
      const deadline = new Date(2026, 8, 25, 14, 5).toISOString();
      const vm = analyzing({ stageSince: minutesBefore(25), stageDeadline: deadline });
      expect(vm.ai?.elapsed).toEqual({ key: `${K}.time.elapsedMinutes`, params: { minutes: 25 } });
      expect(vm.ai?.limit).toEqual({ key: `${K}.time.limitAt`, params: { time: '14:05' } });
      expect(vm.ai?.deadline).toBe(deadline);
    });

    it('counts hours past the first one', () => {
      expect(analyzing({ stageSince: minutesBefore(65) }).ai?.elapsed).toEqual({
        key: `${K}.time.elapsedHours`,
        params: { hours: 1, minutes: 5 },
      });
    });

    it('says the stage just started under a minute, or when the clocks disagree', () => {
      expect(analyzing({ stageSince: new Date(NOW.getTime() - 30_000).toISOString() }).ai?.elapsed).toEqual({
        key: `${K}.time.elapsedJustNow`,
      });
      expect(analyzing({ stageSince: new Date(NOW.getTime() + 120_000).toISOString() }).ai?.elapsed).toEqual({
        key: `${K}.time.elapsedJustNow`,
      });
    });

    it('ignores dates it cannot read', () => {
      const vm = analyzing({ stageSince: 'not-a-date', stageDeadline: '' });
      expect(vm.ai?.elapsed).toBeUndefined();
      expect(vm.ai?.limit).toBeUndefined();
    });

    it('shows no clock for a stage without one, nor once the AI is over', () => {
      const waiting = view(withPipeline({ scanners: lane(1, 1, 0, 0), agent: { stage: 'waiting_for_scanners' } }));
      expect(waiting.ai?.elapsed).toBeUndefined();
      const done = view(
        withPipeline(
          { scanners: lane(1, 0, 1, 0), agent: { stage: 'done', stageSince: minutesBefore(3) } },
          { state: 'completed' },
        ),
      );
      expect(done.ai?.elapsed).toBeUndefined();
      expect(done.ai?.limit).toBeUndefined();
    });
  });

  describe('headline', () => {
    it.each([
      ['waiting for the upload', scan({ state: 'waiting_for_file' }), { key: `${K}.headline.waitingForFile` }],
      ['a running scan without scanners yet', withPipeline({}), { key: `${K}.headline.starting` }],
      [
        'scanners at work',
        withPipeline({ scanners: lane(5, 2, 3, 0), agent: { stage: 'ingesting' } }),
        { key: `${K}.headline.scanners`, params: { done: 3, total: 5 } },
      ],
      [
        'scanners done, code still indexing',
        withPipeline({ scanners: lane(5, 0, 5, 0), agent: { stage: 'ingesting' } }),
        { key: `${K}.headline.aiIngesting` },
      ],
      [
        'scanners done, AI about to queue',
        withPipeline({ scanners: lane(5, 0, 5, 0), agent: { stage: 'waiting_for_scanners' } }),
        { key: `${K}.headline.aiWaitingForScanners` },
      ],
      [
        'scanners done, waiting for an AI slot',
        withPipeline({ scanners: lane(5, 0, 4, 1), agent: { stage: 'queued_for_ai', aiQueuePosition: 4 } }),
        { key: `${K}.headline.aiQueued`, params: { position: 4 } },
      ],
      [
        'scanners done, AI slot position unknown',
        withPipeline({ scanners: lane(5, 0, 5, 0), agent: { stage: 'queued_for_ai' } }),
        { key: `${K}.headline.aiQueuedNoPosition` },
      ],
      [
        'scanners done, AI progress unknown',
        withPipeline({ scanners: lane(5, 0, 5, 0), agent: { stage: 'analyzing' } }),
        { key: `${K}.headline.aiAnalyzingNoProgress` },
      ],
      [
        'scanners done and no AI running',
        withPipeline({ scanners: lane(5, 0, 5, 0), agent: { stage: 'done' } }),
        { key: `${K}.headline.scannersDone` },
      ],
      ['a completed scan', scan({ state: 'completed' }), { key: `${K}.headline.finished` }],
      ['a degraded scan', scan({ state: 'completed_degraded' }), { key: `${K}.headline.finished` }],
      ['a failed scan', scan({ state: 'failed' }), { key: `${K}.headline.finished` }],
      ['a cancelled scan', scan({ state: 'cancelled' }), { key: `${K}.headline.finished` }],
    ])('reads %s', (_label, s, expected) => {
      expect(view(s).headline).toEqual(expected);
    });
  });

  describe('scanner lane', () => {
    it('builds scanner chips from the containers', () => {
      const s = withPipeline(
        { scanners: lane(2, 1, 1, 0), agent: { stage: 'ingesting' } },
        {
          containers: [
            container({ id: '1', status: 'completed', scannerType: 'sast', image: 'appsec-sast' }),
            container({ id: '2', status: 'running', scannerType: 'sca', image: 'appsec-sca' }),
            container({ id: '3', status: 'running', image: 'agent-service' }),
          ],
        },
      );
      expect(chips(s)).toEqual([
        { type: 'sast', state: 'done' },
        { type: 'sca', state: 'running' },
      ]);
      expect(view(s).scanners[0]).toMatchObject({
        label: { key: `${K}.scanner.sast` },
        stateLabel: { key: `${K}.scannerState.done` },
      });
    });

    it('gives one chip per scanner type, in a fixed order, a failure outweighing a success', () => {
      const s = scan({
        containers: [
          container({ status: 'completed', image: 'appsec-iac-kics' }),
          container({ status: 'running', image: 'appsec-secret-gitleaks' }),
          container({ status: 'failed', image: 'appsec-iac-checkov' }),
          container({ status: 'starting', image: 'appsec-sast-opengrep' }),
          container({ status: 'completed_degraded', image: 'appsec-sca' }),
        ],
      });
      expect(chips(s)).toEqual([
        { type: 'sast', state: 'waiting' },
        { type: 'sca', state: 'done' },
        { type: 'iac', state: 'failed' },
        { type: 'secret', state: 'running' },
      ]);
    });

    it('reads the scanner type from the image or, failing that, from the pod name', () => {
      const s = scan({
        containers: [
          container({ status: 'completed', image: 'registry.example.test/team/appsec-sast-opengrep:1.0.0' }),
          container({ status: 'completed', image: '', podName: 'scan-pod-aibom-00000000-0000-4000-8000-0000000000a1' }),
          container({ status: 'completed', image: 'appsec-container' }),
          container({ status: 'completed', scannerType: 'cicd' }),
          container({ status: 'completed', image: 'mystery-tool' }),
        ],
      });
      expect(chips(s).map((c) => c.type)).toEqual(['sast', 'container', 'cicd', 'aibom', 'other']);
    });

    it('never mistakes an object property name for a scanner type', () => {
      const s = scan({ containers: [container({ status: 'completed', image: 'constructor-toString' })] });
      expect(chips(s)).toEqual([{ type: 'other', state: 'done' }]);
    });

    it('takes a container named after the agent, by image or pod name, as the AI lane', () => {
      const s = scan({
        containers: [
          container({ status: 'completed', image: 'appsec-sca' }),
          container({ status: 'parsing_completed', image: '', podName: 'scan-pod-agent-1234' }),
        ],
      });
      expect(chips(s)).toEqual([{ type: 'sca', state: 'done' }]);
      expect(view(s).ai?.stage).toBe('waiting_for_scanners');
    });

    it('counts the scanners that are done, and says how many failed', () => {
      expect(view(withPipeline({ scanners: lane(5, 1, 4, 0) })).scannerSummary).toEqual({
        key: `${K}.lane.scannersProgress`,
        params: { done: 4, total: 5 },
      });
      expect(view(withPipeline({ scanners: lane(6, 2, 3, 1) })).scannerSummary).toEqual({
        key: `${K}.lane.scannersProgressWithFailures`,
        params: { done: 4, total: 6, failed: 1 },
      });
      expect(view(withPipeline({})).scannerSummary).toBeNull();
    });
  });

  describe('without a pipeline (security-scanning not yet deployed)', () => {
    it("falls back to today's data when the API sends no pipeline", () => {
      const vm = view(
        scan({
          containers: [
            container({ id: '1', status: 'completed', image: 'appsec-sast' }),
            container({ id: '3', status: 'running', image: 'agent-service', step: 'agent: analyzed 3/10' }),
          ],
        }),
      );
      expect(vm.fromPipeline).toBe(false);
      expect(vm.scanners.map(({ type, state }) => ({ type, state }))).toEqual([{ type: 'sast', state: 'done' }]);
      expect(vm.ai).toMatchObject({ stage: 'analyzing', progress: { processed: 3, total: 10 } });
      expect(vm.headline).toEqual({ key: `${K}.headline.aiAnalyzing`, params: { processed: 3, total: 10 } });
      expect(vm.banners).toEqual([{ key: `${K}.banner.scannersDone` }]);
      expect(vm.scannerSummary).toEqual({ key: `${K}.lane.scannersProgress`, params: { done: 1, total: 1 } });
    });

    it.each([
      ['a starting agent', { status: 'starting', step: 'agent: ingesting codebase' }, 'ingesting'],
      ['an agent ingesting', { status: 'running', step: 'agent: ingesting codebase' }, 'ingesting'],
      ['an agent parsing', { status: 'running', step: 'agent: parsing in progress' }, 'ingesting'],
      ['a parsed agent', { status: 'parsing_completed', step: 'agent: parsing completed' }, 'waiting_for_scanners'],
      ['a parsed agent queued for the AI', { status: 'parsing_completed', analysisQueuedAt: NOW.toISOString() }, 'queued_for_ai'],
      ['an analysis starting', { status: 'running', step: 'agent: starting vulnerability analysis' }, 'analyzing'],
      ['an analysis stamped as started', { status: 'running', analysisStartedAt: NOW.toISOString() }, 'analyzing'],
      ['a finished agent', { status: 'completed', step: 'agent: analyzed 10/10' }, 'done'],
      ['a degraded agent', { status: 'completed_degraded' }, 'done'],
      ['a failed agent', { status: 'failed', step: 'agent: analysis failed' }, 'failed'],
      ['a skipped agent with its code', { status: 'completed', outcomeReason: 'ai_queue_timeout' }, 'skipped'],
      ['an agent turned off for the project', { status: 'completed', outcomeReason: 'disabled_for_project' }, 'skipped'],
      ['an interrupted agent with its code', { status: 'failed', outcomeReason: 'scan_time_limit' }, 'interrupted'],
      ['a failed agent with its code', { status: 'failed', outcomeReason: 'analysis_failed' }, 'failed'],
    ] as const)('reads %s from its container', (_label, agent, stage) => {
      const vm = view(scan({ containers: [container({ image: 'agent-service', ...agent })] }));
      expect(vm.ai?.stage).toBe(stage);
    });

    it('reads the progress of a JSON step through the agent parser', () => {
      const vm = view(
        scan({
          containers: [
            container({
              image: 'agent-service',
              step: JSON.stringify({ kind: 'agent_progress', phase: 'analysis', processed: 4, total: 8 }),
            }),
          ],
        }),
      );
      expect(vm.ai).toMatchObject({ stage: 'analyzing', progress: { processed: 4, total: 8, percent: 50 } });
    });

    it('prefers the container counters to the step', () => {
      const vm = view(
        scan({
          containers: [
            container({
              image: 'agent-service',
              analysisStartedAt: NOW.toISOString(),
              processedVulnerabilities: 2,
              totalVulnerabilities: 9,
              step: 'agent: analyzed 1/9',
            }),
          ],
        }),
      );
      expect(vm.ai?.progress).toEqual({ processed: 2, total: 9, percent: 22 });
    });

    it('never shows a raw step, and has no reason nor clock to give', () => {
      const vm = view(
        scan({ containers: [container({ status: 'failed', image: 'agent-service', step: 'agent: analysis crashed: boom' })] }),
      );
      expect(vm.ai?.reason).toBeUndefined();
      expect(vm.ai?.elapsed).toBeUndefined();
      expect(JSON.stringify(vm)).not.toContain('boom');
    });

    it('follows the open agent when a closed one is also there', () => {
      const vm = view(
        scan({
          containers: [
            container({ id: 'old', status: 'failed', image: 'agent-service', createdAt: minutesBefore(90) }),
            container({ id: 'new', status: 'parsing_completed', image: 'agent-service', createdAt: minutesBefore(5) }),
          ],
        }),
      );
      expect(vm.ai?.stage).toBe('waiting_for_scanners');
    });

    it('uses the pipeline lanes it gets and the containers for the rest', () => {
      const vm = view(
        scan({
          pipeline: { slotReleased: false, scanners: null, agent: null },
          containers: [
            container({ status: 'completed', image: 'appsec-sca' }),
            container({ status: 'running', image: 'agent-service', step: 'agent: parsing in progress' }),
          ],
        }),
      );
      expect(vm.scannerSummary).toEqual({ key: `${K}.lane.scannersProgress`, params: { done: 1, total: 1 } });
      expect(vm.ai?.stage).toBe('ingesting');
    });
  });

  it('has nothing to show before the scan creates its containers', () => {
    expect(view(scan({ state: 'waiting_for_file' })).isEmpty).toBe(true);
    expect(view(scan({ containers: undefined as unknown as ContainerDto[] })).isEmpty).toBe(true);
  });
});

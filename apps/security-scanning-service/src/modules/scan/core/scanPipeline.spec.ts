import {
  agentReadiness,
  AiCandidate,
  buildScanPipeline,
  CLOSED_CONTAINER_STATUSES,
  deriveAgentStage,
  deriveLegacyOutcome,
  holdsScanSlot,
  INTERRUPTED_OUTCOMES,
  isAgentContainer,
  isAgentSourceContainer,
  isClosedStatus,
  OUTCOME_REASON_PATTERN,
  pickAgentContainer,
  PipelineContainer,
  PipelineContext,
  selectAnalysesToStart,
  SKIPPED_OUTCOMES,
} from './scanPipeline';
import { SCAN_PIPELINE_DEFAULTS } from './scanPipelineConfig';

const sast = (status: string): PipelineContainer => ({
  status,
  image: 'cybedefend-scanners/sast',
  scanner: { scannerType: 'sast' },
});
const iac = (status: string): PipelineContainer => ({
  status,
  image: 'kics',
  scanner: { scannerType: 'iac' },
});
const sca = (status: string): PipelineContainer => ({
  status,
  image: 'cybedefend-scanners/sca',
  scanner: { scannerType: 'sca' },
});
const agent = (status: string): PipelineContainer => ({
  status,
  image: 'agent-service',
  podName: 'agent-0',
});

describe('isClosedStatus', () => {
  it.each(['completed', 'failed', 'completed_degraded'])('%s is closed', (s) =>
    expect(isClosedStatus(s)).toBe(true),
  );
  it.each([
    'running',
    'starting',
    'queued',
    'parsing_completed',
    '',
    null,
    undefined,
  ])('%s is open', (s) => expect(isClosedStatus(s as string)).toBe(false));

  it('is the closed set of ScanStateManager.isContainerTerminated', () =>
    expect([...CLOSED_CONTAINER_STATUSES].sort()).toEqual([
      'completed',
      'completed_degraded',
      'failed',
    ]));
});

describe('isAgentContainer', () => {
  it('matches the image, then the pod name', () => {
    expect(isAgentContainer({ image: 'agent-service' })).toBe(true);
    expect(isAgentContainer({ image: '', podName: 'agent-1' })).toBe(true);
    expect(
      isAgentContainer({
        image: 'cybedefend-scanners/sast',
        podName: 'sast-1',
      }),
    ).toBe(false);
  });

  it('is case-insensitive, like ScanStateManager', () =>
    expect(isAgentContainer({ image: 'Agent-Service' })).toBe(true));
});

describe('holdsScanSlot', () => {
  it('holds while a scanner is open', () =>
    expect(holdsScanSlot([sast('running'), agent('running')], true)).toBe(
      true,
    ));
  it('holds while a scanner is still queued', () =>
    expect(holdsScanSlot([sca('queued'), agent('starting')], true)).toBe(true));
  it('releases once every scanner is closed', () =>
    expect(
      holdsScanSlot(
        [sast('completed'), sca('failed'), agent('parsing_completed')],
        true,
      ),
    ).toBe(false));
  it('holds while no container exists yet', () =>
    expect(holdsScanSlot([], true)).toBe(true));
  it('holds for an agent-only scan', () =>
    expect(holdsScanSlot([agent('running')], true)).toBe(true));
  it('always holds when the kill switch is off', () =>
    expect(holdsScanSlot([sast('completed'), agent('running')], false)).toBe(
      true,
    ));
});

describe('agentReadiness', () => {
  it('is not_applicable without an agent or before parsing_completed', () => {
    expect(agentReadiness([sast('completed')])).toBe('not_applicable');
    expect(agentReadiness([sast('completed'), agent('running')])).toBe(
      'not_applicable',
    );
  });
  it('waits while a SAST or IaC container is open', () =>
    expect(
      agentReadiness([
        sast('running'),
        iac('completed'),
        agent('parsing_completed'),
      ]),
    ).toBe('not_ready'));
  it('is eligible with mixed SAST results (the old deadlock)', () =>
    expect(
      agentReadiness([
        sast('completed'),
        sast('failed'),
        agent('parsing_completed'),
      ]),
    ).toBe('eligible'));
  it('is eligible with a completed_degraded SAST', () =>
    expect(
      agentReadiness([sast('completed_degraded'), agent('parsing_completed')]),
    ).toBe('eligible'));
  it('has nothing to analyse without SAST or IaC', () =>
    expect(agentReadiness([sca('completed'), agent('parsing_completed')])).toBe(
      'nothing_to_analyze',
    ));
  it('has nothing to analyse when every SAST and IaC failed', () =>
    expect(
      agentReadiness([
        sast('failed'),
        iac('failed'),
        agent('parsing_completed'),
      ]),
    ).toBe('nothing_to_analyze'));
  it('ignores SCA while deciding', () =>
    expect(
      agentReadiness([
        sast('completed'),
        sca('running'),
        agent('parsing_completed'),
      ]),
    ).toBe('eligible'));

  // The SAST/IaC match is the one checkAndTriggerAgentAnalysis used:
  // scanner type, scanner name, then image ('kics' for IaC).
  it('recognises SAST and IaC by scanner name or image when the relation is not loaded', () => {
    expect(
      agentReadiness([
        { status: 'completed', image: 'semgrep', scanner: { name: 'SAST' } },
        agent('parsing_completed'),
      ]),
    ).toBe('eligible');
    expect(
      agentReadiness([
        { status: 'running', image: 'checkmarx-kics' },
        agent('parsing_completed'),
      ]),
    ).toBe('not_ready');
  });
});

describe('isAgentSourceContainer', () => {
  it('is a SAST or IaC scanner container', () => {
    expect(isAgentSourceContainer(sast('completed'))).toBe(true);
    expect(isAgentSourceContainer(iac('failed'))).toBe(true);
    expect(isAgentSourceContainer(sca('completed'))).toBe(false);
  });

  it('is never the agent itself', () =>
    expect(
      isAgentSourceContainer({
        status: 'running',
        image: 'agent-service',
        scanner: { scannerType: 'sast' },
      }),
    ).toBe(false));
});

// At most
// AI_MAX_CONCURRENT_ANALYSES analyses at once, first come first served, with
// at most one analysis per organisation while another organisation waits.
describe('selectAnalysesToStart', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 8, 25, 10, min));
  const cand = (scanId: string, org: string, min: number): AiCandidate => ({
    containerId: `c-${scanId}`,
    scanId,
    organizationId: org,
    queuedAt: at(min),
  });
  const ids = (xs: AiCandidate[]) => xs.map((x) => x.scanId);

  it('lets a lone organisation fill every free slot, oldest first', () => {
    const c = [
      cand('a3', 'A', 3),
      cand('a1', 'A', 1),
      cand('a2', 'A', 2),
      cand('a4', 'A', 4),
      cand('a5', 'A', 5),
    ];
    expect(ids(selectAnalysesToStart(c, new Map(), 0, 4))).toEqual([
      'a1',
      'a2',
      'a3',
      'a4',
    ]);
  });

  it('gives the next slot to an organisation that has none', () => {
    const c = [cand('a1', 'A', 1), cand('b1', 'B', 2), cand('a2', 'A', 3)];
    expect(ids(selectAnalysesToStart(c, new Map([['A', 1]]), 1, 3))).toEqual([
      'b1',
      'a1',
    ]);
  });

  it('balances two waiting organisations', () => {
    const c = [
      cand('a1', 'A', 1),
      cand('a2', 'A', 2),
      cand('b1', 'B', 3),
      cand('b2', 'B', 4),
    ];
    expect(ids(selectAnalysesToStart(c, new Map(), 0, 4))).toEqual([
      'a1',
      'b1',
      'a2',
      'b2',
    ]);
  });

  it('counts the analyses already running per organisation', () => {
    // B already analyses two scans, A none: A's two candidates go first even
    // though B queued earlier.
    const c = [cand('b1', 'B', 1), cand('a1', 'A', 5), cand('a2', 'A', 6)];
    expect(ids(selectAnalysesToStart(c, new Map([['B', 2]]), 2, 4))).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('starts nothing when the cap is reached or exceeded', () => {
    expect(
      selectAnalysesToStart([cand('a1', 'A', 1)], new Map([['A', 4]]), 4, 4),
    ).toEqual([]);
    expect(
      selectAnalysesToStart([cand('a1', 'A', 1)], new Map([['A', 5]]), 5, 4),
    ).toEqual([]);
  });

  it('starts everything when the cap is disabled', () => {
    const c = [cand('a2', 'A', 2), cand('a1', 'A', 1)];
    expect(ids(selectAnalysesToStart(c, new Map([['A', 9]]), 9, 0))).toEqual([
      'a1',
      'a2',
    ]);
    expect(ids(selectAnalysesToStart(c, new Map(), 0, -1))).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('breaks ties on scanId', () => {
    const c = [cand('b', 'A', 1), cand('a', 'B', 1)];
    expect(ids(selectAnalysesToStart(c, new Map(), 0, 1))).toEqual(['a']);
  });

  it('changes neither its inputs nor the running counts', () => {
    const c = [cand('a2', 'A', 2), cand('a1', 'A', 1)];
    const running = new Map([['A', 1]]);
    selectAnalysesToStart(c, running, 1, 4);
    expect(ids(c)).toEqual(['a2', 'a1']);
    expect([...running]).toEqual([['A', 1]]);
  });

  it('returns nothing without candidates', () =>
    expect(selectAnalysesToStart([], new Map(), 0, 4)).toEqual([]));
});

describe('outcome vocabulary', () => {
  it('accepts snake_case codes of up to 64 characters only', () => {
    expect(OUTCOME_REASON_PATTERN.test('parse_timeout')).toBe(true);
    expect(OUTCOME_REASON_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(OUTCOME_REASON_PATTERN.test('a'.repeat(65))).toBe(false);
    expect(OUTCOME_REASON_PATTERN.test('')).toBe(false);
    expect(OUTCOME_REASON_PATTERN.test('Parse_Timeout')).toBe(false);
    expect(OUTCOME_REASON_PATTERN.test('DROP TABLE;')).toBe(false);
    expect(OUTCOME_REASON_PATTERN.test('parse_timeout\n')).toBe(false);
  });

  // Sent by the agent when the project has AI result improvement
  // (improvingResults) turned off.
  it('treats disabled_for_project as a skip', () => {
    expect(OUTCOME_REASON_PATTERN.test('disabled_for_project')).toBe(true);
    expect(SKIPPED_OUTCOMES.has('disabled_for_project')).toBe(true);
    expect(INTERRUPTED_OUTCOMES.has('disabled_for_project')).toBe(false);
  });

  it('classifies the skipped and interrupted outcomes', () => {
    expect([...SKIPPED_OUTCOMES].sort()).toEqual([
      'ai_queue_timeout',
      'disabled_for_project',
      'ingestion_stalled',
      'nothing_to_analyze',
      'parse_failed',
      'parse_timeout',
      'quota_exhausted',
      'skipped_by_agent',
    ]);
    expect([...INTERRUPTED_OUTCOMES].sort()).toEqual([
      'analysis_timeout',
      'scan_time_limit',
    ]);
  });
});

// Agent containers closed before outcome codes existed carry only a step.
// Each string below is copied letter for letter from what was written:
// security-scanning's scan.service.ts and
// the AI agent's ingestion_handler.py, analysis_handler.py and core/progress.py.
describe('deriveLegacyOutcome', () => {
  describe('steps security-scanning wrote', () => {
    it.each([
      // The quota refusal of StartAgentAnalysis (status completed).
      ['agent: analysis skipped (analysis quota exceeded)', 'quota_exhausted'],
      // `agent: analysis skipped (${skipReason})`, the reason taken
      // from the agent's `skipped:` answer (status completed).
      [
        'agent: analysis skipped (improvingResults disabled)',
        'skipped_by_agent',
      ],
      // The two "nothing to analyse" branches of the trigger.
      [
        'agent: completed (no SAST or IAC scanners - no vulnerabilities to analyze)',
        'nothing_to_analyze',
      ],
      [
        'agent: completed (all scanners failed - no vulnerabilities to analyze)',
        'nothing_to_analyze',
      ],
      // agentFailureStep, written with status completed.
      [
        'agent: analysis failed (analysis service unavailable)',
        'service_unavailable',
      ],
      ['agent: analysis failed', 'analysis_failed'],
      // Its older form, with the gRPC message appended.
      ['agent: analysis failed - 13 INTERNAL: boom', 'analysis_failed'],
      // agentStartFailureStep (status failed): the codes the StartIngestion
      // fallback now stores with these very steps.
      [
        'agent: failed to start (analysis service unavailable)',
        'service_unavailable',
      ],
      ['agent: failed to start (code parsing failed)', 'parse_failed'],
      ['agent: failed to start', 'parse_failed'],
    ])('%s → %s', (step, outcome) =>
      expect(deriveLegacyOutcome(step)).toBe(outcome),
    );
  });

  describe('steps the AI agent wrote', () => {
    it.each([
      // ingestion_handler.py
      ['agent: analysis quota exceeded; ingestion skipped', 'quota_exhausted'],
      ['agent: potpie parse failed', 'parse_failed'],
      ['agent: parsing failed', 'parse_failed'],
      // analysis_handler.py
      [
        'agent: analysis skipped, improvingResults disabled',
        'disabled_for_project',
      ],
      ['agent: analysis skipped, quota exceeded', 'quota_exhausted'],
      [
        'agent: analysis completed (no matching vulnerabilities)',
        'nothing_to_analyze',
      ],
      [
        'agent: analysis failed (project settings unavailable)',
        'analysis_failed',
      ],
      // core/progress.py, the coverage report
      ['agent: coverage 3/12 - analysis incomplete', 'analysis_failed'],
    ])('%s → %s', (step, outcome) =>
      expect(deriveLegacyOutcome(step)).toBe(outcome),
    );
  });

  // Any other step derives nothing. The failures among them were written
  // with status `failed`, which already reads as a failed stage.
  it.each([
    'agent: ingesting codebase',
    'agent: starting vulnerability analysis',
    'agent: aborted (stuck 121 min, watchdog)',
    'agent: calling parse',
    'agent: parsing in progress',
    'agent: parsing completed',
    'agent: missing scan id',
    'agent: analysis not started, missing project id',
    'agent: analysis not started, missing branch',
    'agent: analysis not started, internal error',
    'agent: failed to fetch vulnerabilities: timed out',
    'agent: init failed: boom',
    'agent: analysis crashed: boom',
    'agent: deep analysis started',
    'agent: analyzed 12/12',
    'agent: completed: 12/12 analyzed',
    'agent: coverage 12/12',
    '{"kind": "agent_progress", "phase": "analysis", "action": "done"}',
    '',
    null,
    undefined,
  ])('%s → null', (step) => expect(deriveLegacyOutcome(step)).toBeNull());
});

// The stage of the agent container.
describe('deriveAgentStage', () => {
  const a = (over: Partial<PipelineContainer>): PipelineContainer => ({
    status: 'running',
    image: 'agent-service',
    ...over,
  });
  const at = new Date('2026-09-25T10:00:00Z');

  it.each([
    ['no agent', undefined, 'not_applicable'],
    ['starting', a({ status: 'starting' }), 'ingesting'],
    ['running, analysis not started', a({ status: 'running' }), 'ingesting'],
    [
      'parsing_completed, not queued',
      a({ status: 'parsing_completed' }),
      'waiting_for_scanners',
    ],
    [
      'parsing_completed, queued',
      a({ status: 'parsing_completed', analysisQueuedAt: at }),
      'queued_for_ai',
    ],
    [
      'running, analysis started',
      a({ status: 'running', analysisStartedAt: at }),
      'analyzing',
    ],
    ['completed, no reason', a({ status: 'completed' }), 'done'],
    [
      'completed_degraded, no reason',
      a({ status: 'completed_degraded' }),
      'done',
    ],
    [
      'completed, skipped',
      a({ status: 'completed', outcomeReason: 'ai_queue_timeout' }),
      'skipped',
    ],
    [
      'completed, disabled for the project',
      a({ status: 'completed', outcomeReason: 'disabled_for_project' }),
      'skipped',
    ],
    [
      'failed, analysis timeout',
      a({ status: 'failed', outcomeReason: 'analysis_timeout' }),
      'interrupted',
    ],
    [
      'failed, scan time limit',
      a({ status: 'failed', outcomeReason: 'scan_time_limit' }),
      'interrupted',
    ],
    [
      'failed, service unavailable',
      a({ status: 'failed', outcomeReason: 'service_unavailable' }),
      'failed',
    ],
    [
      'closed with a code this build does not know',
      a({ status: 'completed', outcomeReason: 'brand_new_code' }),
      'failed',
    ],
    ['failed, no reason', a({ status: 'failed' }), 'failed'],
    // Legacy rows: the outcome derived from the step.
    [
      'legacy quota refusal',
      a({
        status: 'completed',
        step: 'agent: analysis skipped (analysis quota exceeded)',
      }),
      'skipped',
    ],
    [
      'legacy failure closed completed',
      a({ status: 'completed', step: 'agent: analysis failed' }),
      'failed',
    ],
    [
      'legacy parse failure closed failed',
      a({
        status: 'failed',
        step: 'agent: failed to start (code parsing failed)',
      }),
      'skipped',
    ],
    [
      'a stored code wins over the step',
      a({
        status: 'failed',
        outcomeReason: 'analysis_timeout',
        step: 'agent: analysis failed',
      }),
      'interrupted',
    ],
  ])('%s → %s', (_label, agent, stage) =>
    expect(deriveAgentStage(agent as PipelineContainer | undefined)).toBe(
      stage,
    ),
  );
});

describe('pickAgentContainer', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 8, 25, 10, min));

  it('is undefined without an agent', () =>
    expect(pickAgentContainer([sast('running')])).toBeUndefined());

  it('prefers the agent still open over one already closed', () => {
    const open = { ...agent('parsing_completed'), createdAt: at(1) };
    const closed = { ...agent('completed'), createdAt: at(5) };
    expect(pickAgentContainer([sast('completed'), closed, open])).toBe(open);
  });

  it('takes the latest one otherwise', () => {
    const older = { ...agent('completed'), createdAt: at(1) };
    const newer = { ...agent('failed'), createdAt: at(5) };
    expect(pickAgentContainer([newer, older])).toBe(newer);
    expect(pickAgentContainer([older, newer])).toBe(newer);
  });
});

// The read model of getScan.
describe('buildScanPipeline', () => {
  const now = new Date('2026-09-25T12:00:00Z');
  const ctx = (over: Partial<PipelineContext> = {}): PipelineContext => ({
    config: SCAN_PIPELINE_DEFAULTS,
    ...over,
  });
  const minutesBefore = (m: number) => new Date(now.getTime() - m * 60_000);
  const iso = (d: Date) => d.toISOString();

  it('reports a released slot and an agent queued for AI with its deadline and position', () => {
    const queuedAt = minutesBefore(30);
    const p = buildScanPipeline(
      { state: 'running' },
      [
        sast('completed'),
        sca('failed'),
        { ...agent('parsing_completed'), analysisQueuedAt: queuedAt },
      ],
      ctx({ aiQueuePosition: 3 }),
    );
    expect(p.slotReleased).toBe(true);
    expect(p.scanners).toEqual({ total: 2, open: 0, completed: 1, failed: 1 });
    expect(p.agent).toEqual({
      stage: 'queued_for_ai',
      aiQueuePosition: 3,
      stageSince: iso(queuedAt),
      stageDeadline: iso(new Date(queuedAt.getTime() + 7_200_000)),
    });
    expect(p).not.toHaveProperty('queuePosition');
    expect(p).not.toHaveProperty('queueReason');
  });

  it('holds the slot while a scanner runs', () =>
    expect(
      buildScanPipeline(
        { state: 'running' },
        [sast('running'), { ...agent('starting'), createdAt: now }],
        ctx(),
      ).slotReleased,
    ).toBe(false));

  it('never releases the slot with the kill switch off', () =>
    expect(
      buildScanPipeline(
        { state: 'running' },
        [sast('completed'), { ...agent('running'), analysisStartedAt: now }],
        ctx({
          config: { ...SCAN_PIPELINE_DEFAULTS, slotReleaseEnabled: false },
        }),
      ).slotReleased,
    ).toBe(false));

  it('releases a slot only for a running scan', () => {
    for (const state of ['queued', 'completed', 'failed', 'cancelled']) {
      expect(
        buildScanPipeline({ state }, [sast('completed')], ctx()).slotReleased,
      ).toBe(false);
    }
  });

  it('keeps the slot of a running scan still creating its containers', () =>
    expect(
      buildScanPipeline({ state: 'running' }, [], ctx()).slotReleased,
    ).toBe(false));

  it('counts the scanner lane, completed_degraded as completed', () =>
    expect(
      buildScanPipeline(
        { state: 'running' },
        [
          sast('completed_degraded'),
          iac('completed'),
          sca('failed'),
          { status: 'starting', image: 'gitleaks' },
          { status: 'queued', image: 'cybedefend-scanners/aibom' },
          { status: 'running', image: 'trivy' },
          agent('running'),
        ],
        ctx(),
      ).scanners,
    ).toEqual({ total: 6, open: 3, completed: 2, failed: 1 }));

  it('exposes the progress and the budget of an analysis', () => {
    const startedAt = minutesBefore(45);
    const p = buildScanPipeline(
      { state: 'running' },
      [
        sast('completed'),
        {
          ...agent('running'),
          analysisStartedAt: startedAt,
          processedVulnerabilities: 45,
          totalVulnerabilities: 165,
        },
      ],
      ctx(),
    );
    expect(p.agent).toEqual({
      stage: 'analyzing',
      processed: 45,
      total: 165,
      stageSince: iso(startedAt),
      stageDeadline: iso(new Date(startedAt.getTime() + 7_200_000)),
    });
  });

  it('shows an analysis at 0/N from its first report', () =>
    expect(
      buildScanPipeline(
        { state: 'running' },
        [
          sast('completed'),
          {
            ...agent('running'),
            analysisStartedAt: now,
            processedVulnerabilities: 0,
            totalVulnerabilities: 12,
          },
        ],
        ctx(),
      ).agent,
    ).toMatchObject({ stage: 'analyzing', processed: 0, total: 12 }));

  it('times an ingestion from the container creation', () => {
    const createdAt = minutesBefore(10);
    expect(
      buildScanPipeline(
        { state: 'running' },
        [sast('running'), { ...agent('running'), createdAt }],
        ctx(),
      ).agent,
    ).toEqual({
      stage: 'ingesting',
      stageSince: iso(createdAt),
      stageDeadline: iso(new Date(createdAt.getTime() + 3_600_000)),
    });
  });

  it('gives an agent waiting for its scanners neither a start nor a deadline', () =>
    expect(
      buildScanPipeline(
        { state: 'running' },
        [
          sast('running'),
          { ...agent('parsing_completed'), createdAt: minutesBefore(20) },
        ],
        ctx(),
      ).agent,
    ).toEqual({ stage: 'waiting_for_scanners' }));

  it('reads each budget from the configuration', () => {
    const config = {
      ...SCAN_PIPELINE_DEFAULTS,
      agentIngestionMaxMs: 1_000,
      aiQueueMaxWaitMs: 2_000,
      aiAnalysisMaxMs: 3_000,
    };
    const since = minutesBefore(1);
    const deadline = (containers: PipelineContainer[]) =>
      buildScanPipeline({ state: 'running' }, containers, ctx({ config })).agent
        .stageDeadline;
    expect(deadline([{ ...agent('starting'), createdAt: since }])).toBe(
      iso(new Date(since.getTime() + 1_000)),
    );
    expect(
      deadline([
        sast('completed'),
        { ...agent('parsing_completed'), analysisQueuedAt: since },
      ]),
    ).toBe(iso(new Date(since.getTime() + 2_000)));
    expect(
      deadline([
        sast('completed'),
        { ...agent('running'), analysisStartedAt: since },
      ]),
    ).toBe(iso(new Date(since.getTime() + 3_000)));
  });

  it.each([
    ['done', { status: 'completed' }, undefined],
    [
      'skipped',
      { status: 'completed', outcomeReason: 'ai_queue_timeout' },
      'ai_queue_timeout',
    ],
    [
      'interrupted',
      { status: 'failed', outcomeReason: 'analysis_timeout' },
      'analysis_timeout',
    ],
    [
      'failed',
      { status: 'failed', outcomeReason: 'service_unavailable' },
      'service_unavailable',
    ],
  ])(
    'dates a %s agent from its end, with no deadline',
    (stage, over, outcomeReason) => {
      const finishedAt = minutesBefore(3);
      const p = buildScanPipeline(
        { state: 'completed' },
        [
          sast('completed'),
          {
            ...agent('running'),
            ...over,
            finishedAt,
            processedVulnerabilities: 12,
            totalVulnerabilities: 12,
          },
        ],
        ctx(),
      );
      expect(p.agent).toEqual({
        stage,
        ...(outcomeReason ? { outcomeReason } : {}),
        processed: 12,
        total: 12,
        stageSince: iso(finishedAt),
      });
    },
  );

  it('derives the outcome of a legacy closed agent', () => {
    const p = buildScanPipeline(
      { state: 'completed' },
      [
        sast('completed'),
        {
          ...agent('completed'),
          step: 'agent: analysis failed',
          finishedAt: now,
        },
      ],
      ctx(),
    );
    expect(p.agent).toMatchObject({
      stage: 'failed',
      outcomeReason: 'analysis_failed',
    });
  });

  it.each(['org_limit', 'platform_limit', 'starting'] as const)(
    'carries the queue position and the %s reason of a queued scan',
    (queueReason) => {
      const p = buildScanPipeline(
        { state: 'queued' },
        [],
        ctx({ queuePosition: 2, queueReason }),
      );
      expect(p).toEqual({
        slotReleased: false,
        queuePosition: 2,
        queueReason,
        scanners: { total: 0, open: 0, completed: 0, failed: 0 },
        agent: { stage: 'not_applicable' },
      });
    },
  );

  it('keeps the queue fields to a queued scan and the AI position to an agent queued for AI', () => {
    const p = buildScanPipeline(
      { state: 'running' },
      [sast('running'), { ...agent('running'), createdAt: now }],
      ctx({ queuePosition: 2, queueReason: 'org_limit', aiQueuePosition: 4 }),
    );
    expect(p).not.toHaveProperty('queuePosition');
    expect(p).not.toHaveProperty('queueReason');
    expect(p.agent).not.toHaveProperty('aiQueuePosition');
  });

  it('reads the agent still open when a scan has two', () =>
    expect(
      buildScanPipeline(
        { state: 'running' },
        [
          sast('completed'),
          {
            ...agent('failed'),
            createdAt: minutesBefore(50),
            finishedAt: minutesBefore(40),
          },
          {
            ...agent('running'),
            createdAt: minutesBefore(5),
            analysisStartedAt: minutesBefore(1),
          },
        ],
        ctx(),
      ).agent.stage,
    ).toBe('analyzing'));
});

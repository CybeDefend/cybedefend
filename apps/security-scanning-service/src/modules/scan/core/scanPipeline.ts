/**
 * Pure rules of the scan pipeline (scan slot release and AI queue). No I/O:
 * callers pass the containers they already loaded.
 */

import { ScanPipelineConfig } from './scanPipelineConfig';

/** Container statuses from which a container never moves again. */
export const CLOSED_CONTAINER_STATUSES: readonly string[] = [
  'completed',
  'failed',
  'completed_degraded',
];

/** `container.outcomeReason`: snake_case codes of a closed vocabulary. */
export const OUTCOME_REASON_PATTERN = /^[a-z_]{1,64}$/;

/** Outcomes of an agent that ended without analysing. */
export const SKIPPED_OUTCOMES: ReadonlySet<string> = new Set([
  'nothing_to_analyze',
  'skipped_by_agent',
  // Sent by the agent when the project has improvingResults turned off.
  'disabled_for_project',
  'quota_exhausted',
  'parse_timeout',
  'parse_failed',
  'ingestion_stalled',
  'ai_queue_timeout',
]);

/** Outcomes of an analysis cut short by a budget. */
export const INTERRUPTED_OUTCOMES: ReadonlySet<string> = new Set([
  'analysis_timeout',
  'scan_time_limit',
]);

/** The container fields the pipeline rules read. */
export interface PipelineContainer {
  status: string;
  image?: string | null;
  podName?: string | null;
  scanner?: { name?: string | null; scannerType?: string | null } | null;
  analysisQueuedAt?: Date | null;
  analysisStartedAt?: Date | null;
  outcomeReason?: string | null;
  step?: string | null;
  // Read by the read model only (buildScanPipeline): the stage clock and the
  // analysis progress.
  createdAt?: Date | null;
  finishedAt?: Date | null;
  processedVulnerabilities?: number | null;
  totalVulnerabilities?: number | null;
}

export function isClosedStatus(status: string | null | undefined): boolean {
  return CLOSED_CONTAINER_STATUSES.includes((status ?? '').toLowerCase());
}

/**
 * The agent container: `(image || podName)` contains `agent`,
 * case-insensitive — the rule ScanStateManager already applies. Every other
 * container is a scanner container.
 */
export function isAgentContainer(
  c: Pick<PipelineContainer, 'image' | 'podName'>,
): boolean {
  return (c.image || c.podName || '').toLowerCase().includes('agent');
}

/**
 * A `running` scan holds its organisation slot (and a place under the
 * platform cap) unless it has at least one scanner container and all of them
 * are closed. A scan still creating its containers keeps its slot, and so
 * does an agent-only scan. With the kill switch off, every scan holds it.
 */
export function holdsScanSlot(
  containers: PipelineContainer[],
  slotReleaseEnabled: boolean,
): boolean {
  if (!slotReleaseEnabled) return true;
  const scanners = containers.filter((c) => !isAgentContainer(c));
  if (scanners.length === 0) return true;
  return scanners.some((c) => !isClosedStatus(c.status));
}

export type AgentReadiness =
  | 'not_applicable'
  | 'not_ready'
  | 'nothing_to_analyze'
  | 'eligible';

/**
 * A SAST or IaC scanner container: the scanners whose findings the agent
 * analyses. Same match as the trigger always used: scanner type, scanner
 * name, then the image (`kics` for IaC), so it works without the scanner
 * relation. The agent itself is never one.
 */
export function isAgentSourceContainer(c: PipelineContainer): boolean {
  if (isAgentContainer(c)) return false;
  const type = c.scanner?.scannerType?.toLowerCase() ?? '';
  const name = c.scanner?.name?.toLowerCase() ?? '';
  const image = c.image?.toLowerCase() ?? '';
  const isSast =
    type === 'sast' || name.includes('sast') || image.includes('sast');
  const isIac =
    type === 'iac' || name.includes('iac') || image.includes('kics');
  return isSast || isIac;
}

/**
 * Whether the agent's analysis can run:
 * - `not_applicable`: no agent container, or it has not finished parsing;
 * - `nothing_to_analyze`: no SAST/IaC container, or all of them closed
 *   without a result;
 * - `not_ready`: a SAST/IaC container is still open;
 * - `eligible`: all closed, at least one `completed` or `completed_degraded`.
 *   Mixed results no longer block the analysis.
 */
export function agentReadiness(
  containers: PipelineContainer[],
): AgentReadiness {
  const agent = containers.find(isAgentContainer);
  if (!agent || agent.status !== 'parsing_completed') return 'not_applicable';
  const sources = containers.filter(isAgentSourceContainer);
  if (sources.length === 0) return 'nothing_to_analyze';
  if (sources.some((c) => !isClosedStatus(c.status))) return 'not_ready';
  return sources.some(
    (c) => c.status === 'completed' || c.status === 'completed_degraded',
  )
    ? 'eligible'
    : 'nothing_to_analyze';
}

/** An agent container waiting in the AI queue (`queued_for_ai`). */
export interface AiCandidate {
  containerId: string;
  scanId: string;
  organizationId: string;
  /** `analysisQueuedAt`: when the agent became eligible for an AI slot. */
  queuedAt: Date;
}

/**
 * The analyses to start in this tick of the AI queue.
 *
 * `maxConcurrent - analyzingTotal` slots are free. Each pick takes the
 * candidate whose organisation has the fewest analyses running, the picks of
 * this tick included, then the oldest `queuedAt`, then the smallest `scanId`.
 * An organisation alone in the queue can fill every free slot; as soon as
 * another organisation waits, it gets the next one. Running analyses are
 * never pre-empted. `maxConcurrent <= 0` removes the cap: every candidate
 * starts, oldest first.
 */
export function selectAnalysesToStart(
  candidates: readonly AiCandidate[],
  analyzingByOrg: ReadonlyMap<string, number>,
  analyzingTotal: number,
  maxConcurrent: number,
): AiCandidate[] {
  const remaining = [...candidates].sort(
    (a, b) =>
      a.queuedAt.getTime() - b.queuedAt.getTime() ||
      compareCodePoints(a.scanId, b.scanId),
  );
  if (maxConcurrent <= 0) return remaining;

  const busy = new Map(analyzingByOrg);
  const running = (c: AiCandidate) => busy.get(c.organizationId) ?? 0;
  const picked: AiCandidate[] = [];
  let free = maxConcurrent - analyzingTotal;
  while (free > 0 && remaining.length > 0) {
    // `remaining` is sorted, so the strict `<` keeps the oldest candidate
    // among the organisations with the fewest analyses running.
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (running(remaining[i]) < running(remaining[best])) best = i;
    }
    const [choice] = remaining.splice(best, 1);
    picked.push(choice);
    busy.set(choice.organizationId, running(choice) + 1);
    free--;
  }
  return picked;
}

/** Locale-independent string order, so the tie-break is the same everywhere. */
function compareCodePoints(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The stage of the agent container. */
export type AgentStage =
  | 'not_applicable'
  | 'ingesting'
  | 'waiting_for_scanners'
  | 'queued_for_ai'
  | 'analyzing'
  | 'done'
  | 'skipped'
  | 'interrupted'
  | 'failed';

/** Why a queued scan waits. */
export type QueueReason = 'org_limit' | 'platform_limit' | 'starting';

/**
 * The outcome of an agent container closed before outcome codes existed,
 * read from its step, most specific prefix first. Every string is one that
 * security-scanning (`scan.service.ts`) or the AI agent wrote;
 * `scanPipeline.spec.ts` pins each of them.
 */
const LEGACY_STEP_OUTCOMES: ReadonlyArray<readonly [string | RegExp, string]> =
  [
    // The AI agent, the early exits of StartAgentAnalysis.
    [
      'agent: analysis skipped, improvingResults disabled',
      'disabled_for_project',
    ],
    ['agent: analysis skipped, quota exceeded', 'quota_exhausted'],
    // security-scanning, the quota refusal of StartAgentAnalysis, then the
    // skip: `agent: analysis skipped (<the agent's reason>)`.
    ['agent: analysis skipped (analysis quota exceeded)', 'quota_exhausted'],
    ['agent: analysis skipped', 'skipped_by_agent'],
    // The AI agent, StartIngestion: quota gate, refused parse, failed parse.
    ['agent: analysis quota exceeded; ingestion skipped', 'quota_exhausted'],
    ['agent: potpie parse failed', 'parse_failed'],
    ['agent: parsing failed', 'parse_failed'],
    // security-scanning, the two "nothing to analyse" branches, and
    // the AI agent's own.
    ['agent: completed (no SAST or IAC scanners', 'nothing_to_analyze'],
    ['agent: completed (all scanners failed', 'nothing_to_analyze'],
    [
      'agent: analysis completed (no matching vulnerabilities)',
      'nothing_to_analyze',
    ],
    // security-scanning, agentFailureStep (and its older `- <message>` form).
    [
      'agent: analysis failed (analysis service unavailable)',
      'service_unavailable',
    ],
    ['agent: analysis failed', 'analysis_failed'],
    // security-scanning, agentStartFailureStep: the codes its StartIngestion
    // fallback now stores with these very steps.
    [
      'agent: failed to start (analysis service unavailable)',
      'service_unavailable',
    ],
    ['agent: failed to start', 'parse_failed'],
    // The AI agent, the coverage report of an incomplete analysis.
    [/^agent: coverage \d+\/\d+ - analysis incomplete/, 'analysis_failed'],
  ];

/**
 * The outcome code an agent step written before outcome codes existed stands
 * for, or null. Any step outside the list above derives nothing: a closed
 * container then reads as `done`, or `failed` when its status says so.
 */
export function deriveLegacyOutcome(
  step: string | null | undefined,
): string | null {
  const text = (step ?? '').trim();
  if (!text) return null;
  for (const [prefix, outcome] of LEGACY_STEP_OUTCOMES) {
    const matches =
      typeof prefix === 'string' ? text.startsWith(prefix) : prefix.test(text);
    if (matches) return outcome;
  }
  return null;
}

/** Why a closed agent ended: its stored code, else the one its step implies. */
function closedAgentOutcome(agent: PipelineContainer): string | null {
  return agent.outcomeReason || deriveLegacyOutcome(agent.step);
}

/**
 * The stage of the agent container:
 * - open: `waiting_for_scanners` / `queued_for_ai` while `parsing_completed`
 *   (`analysisQueuedAt` tells them apart), `analyzing` when `running` with
 *   its analysis started, `ingesting` otherwise;
 * - closed: `skipped` or `interrupted` by the class of its outcome, `failed`
 *   for any other outcome, and without one `done` — or `failed` when its
 *   status is `failed`. A container closed before outcome codes existed gets
 *   the outcome its step implies (`deriveLegacyOutcome`).
 */
export function deriveAgentStage(
  agent: PipelineContainer | undefined,
): AgentStage {
  if (!agent) return 'not_applicable';
  const status = (agent.status ?? '').toLowerCase();
  if (isClosedStatus(status)) {
    const outcome = closedAgentOutcome(agent);
    if (!outcome) return status === 'failed' ? 'failed' : 'done';
    if (SKIPPED_OUTCOMES.has(outcome)) return 'skipped';
    if (INTERRUPTED_OUTCOMES.has(outcome)) return 'interrupted';
    return 'failed';
  }
  if (status === 'parsing_completed') {
    return agent.analysisQueuedAt ? 'queued_for_ai' : 'waiting_for_scanners';
  }
  if (status === 'running' && agent.analysisStartedAt) return 'analyzing';
  return 'ingesting';
}

/**
 * The agent container a scan's AI lane shows: the one still open (the
 * pipeline waits for it), else the latest. A scan normally has one.
 */
export function pickAgentContainer<T extends PipelineContainer>(
  containers: readonly T[],
): T | undefined {
  const agents = containers.filter((c) => isAgentContainer(c));
  if (agents.length === 0) return undefined;
  const open = agents.filter((c) => !isClosedStatus(c.status));
  const pool = open.length > 0 ? open : agents;
  return pool.reduce((latest, c) =>
    (timeOf(c.createdAt) ?? -Infinity) > (timeOf(latest.createdAt) ?? -Infinity)
      ? c
      : latest,
  );
}

/** What `getScan` looked up to explain a queued scan or a queued analysis. */
export interface PipelineContext {
  config: ScanPipelineConfig;
  /** A queued scan: 1-based place in its organisation's queue. */
  queuePosition?: number;
  queueReason?: QueueReason;
  /** An agent queued for AI: approximate 1-based place, platform-wide. */
  aiQueuePosition?: number;
}

/** Mirrors `ScannerLane` of the proto. */
export interface ScannerLaneView {
  total: number;
  open: number;
  /** completed + completed_degraded */
  completed: number;
  failed: number;
}

/** Mirrors `AgentLane` of the proto (camelCase, as ts-proto emits it). */
export interface AgentLaneView {
  stage: AgentStage;
  outcomeReason?: string;
  aiQueuePosition?: number;
  processed?: number;
  total?: number;
  /** ISO-8601: when the current stage began. */
  stageSince?: string;
  /** ISO-8601: when the budget of the current stage ends. */
  stageDeadline?: string;
}

/** Mirrors `ScanPipeline` of the proto. */
export interface ScanPipelineView {
  slotReleased: boolean;
  queuePosition?: number;
  queueReason?: QueueReason;
  scanners: ScannerLaneView;
  agent: AgentLaneView;
}

/**
 * Where a scan really is: the read model `getScan` returns
 * with `include_pipeline`.
 *
 * - `slotReleased`: a `running` scan whose slot is no longer held.
 *   Never with the kill switch off.
 * - The scanner lane counts the scanner containers by status.
 * - The agent lane gives the stage, the outcome of a closed agent,
 *   the progress, when the stage began (`createdAt` while ingesting,
 *   `analysisQueuedAt`, `analysisStartedAt`, `finishedAt` once closed, none
 *   while waiting for the scanners) and when its budget ends.
 * - The positions come from `ctx`: the queue's for a queued scan, the AI
 *   queue's for an agent queued for AI.
 */
export function buildScanPipeline(
  scan: { state: string },
  containers: PipelineContainer[],
  ctx: PipelineContext,
): ScanPipelineView {
  const view: ScanPipelineView = {
    slotReleased:
      scan.state === 'running' &&
      !holdsScanSlot(containers, ctx.config.slotReleaseEnabled),
    scanners: scannerLane(containers),
    agent: agentLane(pickAgentContainer(containers), ctx),
  };
  if (scan.state === 'queued') {
    if (ctx.queuePosition !== undefined) {
      view.queuePosition = ctx.queuePosition;
    }
    if (ctx.queueReason !== undefined) view.queueReason = ctx.queueReason;
  }
  return view;
}

function scannerLane(containers: PipelineContainer[]): ScannerLaneView {
  const lane: ScannerLaneView = { total: 0, open: 0, completed: 0, failed: 0 };
  for (const c of containers) {
    if (isAgentContainer(c)) continue;
    lane.total++;
    const status = (c.status ?? '').toLowerCase();
    if (!isClosedStatus(status)) lane.open++;
    else if (status === 'failed') lane.failed++;
    else lane.completed++;
  }
  return lane;
}

function agentLane(
  agent: PipelineContainer | undefined,
  ctx: PipelineContext,
): AgentLaneView {
  const stage = deriveAgentStage(agent);
  const lane: AgentLaneView = { stage };
  if (!agent) return lane;

  if (isClosedStatus(agent.status)) {
    const outcome = closedAgentOutcome(agent);
    if (outcome) lane.outcomeReason = outcome;
  }
  if (stage === 'queued_for_ai' && ctx.aiQueuePosition !== undefined) {
    lane.aiQueuePosition = ctx.aiQueuePosition;
  }
  if (agent.processedVulnerabilities != null) {
    lane.processed = agent.processedVulnerabilities;
  }
  if (agent.totalVulnerabilities != null) {
    lane.total = agent.totalVulnerabilities;
  }

  const { since, budgetMs } = stageClock(stage, agent, ctx.config);
  if (since !== null) {
    lane.stageSince = new Date(since).toISOString();
    if (budgetMs !== null) {
      lane.stageDeadline = new Date(since + budgetMs).toISOString();
    }
  }
  return lane;
}

/** When the stage began, and the budget that bounds it. */
function stageClock(
  stage: AgentStage,
  agent: PipelineContainer,
  config: ScanPipelineConfig,
): { since: number | null; budgetMs: number | null } {
  switch (stage) {
    case 'ingesting':
      return {
        since: timeOf(agent.createdAt),
        budgetMs: config.agentIngestionMaxMs,
      };
    case 'queued_for_ai':
      return {
        since: timeOf(agent.analysisQueuedAt),
        budgetMs: config.aiQueueMaxWaitMs,
      };
    case 'analyzing':
      return {
        since: timeOf(agent.analysisStartedAt),
        budgetMs: config.aiAnalysisMaxMs,
      };
    case 'done':
    case 'skipped':
    case 'interrupted':
    case 'failed':
      return { since: timeOf(agent.finishedAt), budgetMs: null };
    default:
      // not_applicable, and waiting_for_scanners: no budget of its own.
      return { since: null, budgetMs: null };
  }
}

/** Epoch milliseconds of a stored date, or null when absent or invalid. */
function timeOf(value: Date | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

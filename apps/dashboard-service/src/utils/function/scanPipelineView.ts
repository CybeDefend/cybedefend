/**
 * Scan pipeline view model.
 *
 * Turns a scan into what the Results pages say about it: a one-line headline, a
 * chip per scanner type, the AI lane (stage, progress, elapsed time, time limit,
 * outcome) and the banners. It returns i18n keys and parameters, never text, and
 * never a raw step or error string: reasons are codes, mapped to translations.
 *
 * `scan.pipeline` is the read model security-scanning computes. Until it
 * is deployed the field is absent, and the view falls back to the containers,
 * reading the agent's progress from its step as the pages always did.
 */
import type {
  ContainerDto,
  ScanPipelineAgentLaneDto,
  ScanPipelineDto,
  ScanResponseDto,
} from '@/server/interfaces/Scan';
import { parseAgentStep } from '@/utils/function/agentParser';

export const PIPELINE_I18N = 'components.analyseWrapper.pipeline';

/** Stages of the agent container. */
export const AGENT_STAGES = [
  'not_applicable',
  'ingesting',
  'waiting_for_scanners',
  'queued_for_ai',
  'analyzing',
  'done',
  'skipped',
  'interrupted',
  'failed',
] as const;
export type AgentStage = (typeof AGENT_STAGES)[number];

/** Outcome codes, by class. Any other code is shown with a generic label. */
const SKIPPED_REASONS = [
  'nothing_to_analyze',
  'skipped_by_agent',
  'disabled_for_project',
  'quota_exhausted',
  'parse_timeout',
  'parse_failed',
  'ingestion_stalled',
  'ai_queue_timeout',
] as const;
const INTERRUPTED_REASONS = ['analysis_timeout', 'scan_time_limit'] as const;
export const OUTCOME_REASONS = [
  ...SKIPPED_REASONS,
  ...INTERRUPTED_REASONS,
  'analysis_failed',
  'service_unavailable',
  // Set on scanner containers only, never on the agent; named for completeness.
  'scanner_timeout',
] as const;

/** Why a scan waits in its organization's queue. */
export const QUEUE_REASONS = ['org_limit', 'platform_limit', 'starting'] as const;

/** One chip per type, in this order. `other` is a scanner nothing identifies. */
export const SCANNER_TYPES = ['sast', 'sca', 'iac', 'secret', 'container', 'cicd', 'aibom', 'other'] as const;
export type ScannerType = (typeof SCANNER_TYPES)[number];

export interface I18nText {
  key: string;
  params?: Record<string, string | number>;
}

export type ScannerChipState = 'running' | 'done' | 'failed' | 'waiting';

export interface ScannerChip {
  type: ScannerType;
  state: ScannerChipState;
  label: I18nText;
  stateLabel: I18nText;
}

export type AiTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger';

export type AiStepId = 'ingesting' | 'waiting_for_scanners' | 'queued_for_ai' | 'analyzing' | 'outcome';

export interface AiStepperStep {
  id: AiStepId;
  label: I18nText;
  state: 'done' | 'current' | 'upcoming';
}

export interface AiStepView {
  stage: AgentStage;
  label: I18nText;
  /** Why the AI ended; only on a closed stage that carries a code. */
  reason?: I18nText;
  progress?: { processed: number; total: number; percent: number };
  since?: string;
  deadline?: string;
  elapsed?: I18nText;
  limit?: I18nText;
  tone: AiTone;
  /** The five steps while the AI is under way; empty once it has an outcome. */
  steps: AiStepperStep[];
}

export interface ScanPipelineViewModel {
  headline: I18nText;
  scanners: ScannerChip[];
  /** "n/N done", with the failures when there are any; null without scanners. */
  scannerSummary: I18nText | null;
  /** Null when the scan has no agent container. */
  ai: AiStepView | null;
  /** Slot released / scanner results ready, or the queue position and reason. */
  banners: I18nText[];
  bannerTone: 'info' | 'success';
  /** False when built from the containers alone (no `pipeline` in the response). */
  fromPipeline: boolean;
  /** Nothing to show yet: no banner, no scanner, no AI lane. */
  isEmpty: boolean;
}

interface LaneCounts {
  total: number;
  open: number;
  completed: number;
  failed: number;
}

/** What the AI lane is built from, whichever source it came from. */
interface AgentFacts {
  stage: AgentStage;
  outcomeReason?: string;
  aiQueuePosition?: number;
  processed?: number;
  total?: number;
  since?: string;
  deadline?: string;
}

const CLOSED_STATUSES = new Set(['completed', 'failed', 'completed_degraded']);
const TERMINAL_SCAN_STATES = new Set(['completed', 'completed_degraded', 'failed', 'cancelled']);
const KNOWN_STAGES = new Set<string>(AGENT_STAGES);
const OUTCOME_SET = new Set<string>(OUTCOME_REASONS);
const SKIPPED_SET = new Set<string>(SKIPPED_REASONS);
const INTERRUPTED_SET = new Set<string>(INTERRUPTED_REASONS);
const QUEUE_REASON_SET = new Set<string>(QUEUE_REASONS);
const SCANNER_TYPE_SET = new Set<string>(SCANNER_TYPES);

/** The four steps the AI goes through before its outcome. */
const AI_STEPS = ['ingesting', 'waiting_for_scanners', 'queued_for_ai', 'analyzing'] as const;
// Step security-scanning reports while a scan waits for its results to be final.
const HELD_FOR_RESULTS_STEP = 'processing results';
const ACTIVE_STAGES = new Set<AgentStage>(AI_STEPS);

const TONE_BY_STAGE: Record<AgentStage, AiTone> = {
  not_applicable: 'neutral',
  ingesting: 'active',
  waiting_for_scanners: 'active',
  queued_for_ai: 'active',
  analyzing: 'active',
  done: 'success',
  skipped: 'warning',
  interrupted: 'warning',
  failed: 'danger',
};

// A Map, not an object literal: an image called `constructor-…` must not
// resolve to Object.prototype.constructor.
const TYPE_BY_NAME_TOKEN = new Map<string, ScannerType>([
  ['sast', 'sast'],
  ['sca', 'sca'],
  ['iac', 'iac'],
  ['kics', 'iac'],
  ['secret', 'secret'],
  ['gitleaks', 'secret'],
  ['container', 'container'],
  ['cicd', 'cicd'],
  ['aibom', 'aibom'],
]);

/** A running chip outweighs a waiting one, which outweighs a failure, then a success. */
const CHIP_PRECEDENCE: ScannerChipState[] = ['running', 'waiting', 'failed', 'done'];

/** Steps the agent and security-scanning write once the analysis has started. */
const ANALYSIS_STEP = /^agent: (analyzed|starting vulnerability analysis)/i;
const ANALYZED_STEP = /^agent: analyzed (\d+)\s*\/\s*(\d+)/i;
const ANALYSIS_PHASES = new Set(['analysis', 'vuln', 'prioritization']);

const text = (key: string, params?: I18nText['params']): I18nText =>
  params ? { key: `${PIPELINE_I18N}.${key}`, params } : { key: `${PIPELINE_I18N}.${key}` };

const isClosed = (status: string | undefined): boolean => CLOSED_STATUSES.has(status ?? '');

/** The agent-container rule every service shares: `(image || podName)` contains "agent". */
const isAgent = (c: ContainerDto): boolean =>
  String(c.image || c.podName || '').toLowerCase().includes('agent');

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** A 1-based position, or undefined when there is none worth showing. */
const position = (value: unknown): number | undefined => {
  const n = count(value);
  return n >= 1 ? n : undefined;
};

const timeOf = (iso: string | undefined): number => {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 0 : t;
};

// ── scanners ──────────────────────────────────────────────────────────────────

function typeFromName(name: string | undefined): ScannerType | null {
  if (!name) return null;
  // Last path segment, without tag or digest:
  // `registry.example.test/team/appsec-sast-opengrep:1.0.0` → `appsec-sast-opengrep`.
  const bare = (name.toLowerCase().split('/').pop() ?? '').split(/[:@]/)[0];
  for (const token of bare.split(/[^a-z0-9]+/)) {
    const type = TYPE_BY_NAME_TOKEN.get(token);
    if (type) return type;
  }
  return null;
}

/** `scannerType` when the API sends it, else the image, else the pod name (`scan-pod-<type>-<uuid>`). */
export function scannerTypeOf(c: ContainerDto): ScannerType {
  const declared = (c.scannerType ?? '').trim().toLowerCase();
  if (declared) return SCANNER_TYPE_SET.has(declared) ? (declared as ScannerType) : 'other';
  return typeFromName(c.image) ?? typeFromName(c.podName) ?? 'other';
}

function chipStateOf(status: string): ScannerChipState {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  if (status === 'completed' || status === 'completed_degraded') return 'done';
  return 'waiting';
}

function chipsOf(scanners: ContainerDto[]): ScannerChip[] {
  const statesByType = new Map<ScannerType, ScannerChipState[]>();
  for (const c of scanners) {
    const type = scannerTypeOf(c);
    statesByType.set(type, [...(statesByType.get(type) ?? []), chipStateOf(c.status)]);
  }
  return SCANNER_TYPES.filter((type) => statesByType.has(type)).map((type) => {
    const states = statesByType.get(type) ?? [];
    const state = CHIP_PRECEDENCE.find((s) => states.includes(s)) ?? 'waiting';
    return { type, state, label: text(`scanner.${type}`), stateLabel: text(`scannerState.${state}`) };
  });
}

function countLane(scanners: ContainerDto[]): LaneCounts {
  const lane: LaneCounts = { total: scanners.length, open: 0, completed: 0, failed: 0 };
  for (const c of scanners) {
    if (c.status === 'failed') lane.failed += 1;
    else if (isClosed(c.status)) lane.completed += 1;
    else lane.open += 1;
  }
  return lane;
}

function laneOf(pipeline: ScanPipelineDto | null, scanners: ContainerDto[]): LaneCounts {
  const lane = pipeline?.scanners;
  if (!lane) return countLane(scanners);
  return {
    total: count(lane.total),
    open: count(lane.open),
    completed: count(lane.completed),
    failed: count(lane.failed),
  };
}

function summaryOf(lane: LaneCounts): I18nText | null {
  if (lane.total === 0) return null;
  const done = Math.max(0, lane.total - lane.open);
  return lane.failed > 0
    ? text('lane.scannersProgressWithFailures', { done, total: lane.total, failed: lane.failed })
    : text('lane.scannersProgress', { done, total: lane.total });
}

// ── agent ─────────────────────────────────────────────────────────────────────

/** The open agent container if there is one, else the latest. */
function pickAgent(agents: ContainerDto[]): ContainerDto | undefined {
  const open = agents.filter((c) => !isClosed(c.status));
  if (open.length > 0) return open.find((c) => c.status === 'running') ?? open[0];
  return [...agents].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt))[0];
}

/** Progress written in the step: a JSON step (read by the agent parser) or `agent: analyzed 3/10`. */
function stepProgress(step: string | undefined): { processed: number; total: number } | null {
  if (!step) return null;
  const parsed = parseAgentStep(step);
  if (typeof parsed?.processed === 'number' && typeof parsed?.total === 'number') {
    return { processed: parsed.processed, total: parsed.total };
  }
  const match = ANALYZED_STEP.exec(step.trim());
  return match ? { processed: Number(match[1]), total: Number(match[2]) } : null;
}

function isAnalysisStep(step: string | undefined): boolean {
  if (!step) return false;
  if (ANALYSIS_STEP.test(step.trim())) return true;
  return ANALYSIS_PHASES.has(String(parseAgentStep(step)?.phase ?? ''));
}

/** The stage of a closed container: the class of its outcome code, else its status. */
function closedStage(status: string, reason: string | undefined): AgentStage {
  if (reason) {
    if (SKIPPED_SET.has(reason)) return 'skipped';
    if (INTERRUPTED_SET.has(reason)) return 'interrupted';
    return 'failed';
  }
  return status === 'failed' ? 'failed' : 'done';
}

/** The stage read from the container alone, for an API that sends no pipeline. */
function containerStage(agent: ContainerDto | undefined): AgentStage {
  if (!agent) return 'not_applicable';
  if (isClosed(agent.status)) return closedStage(agent.status, agent.outcomeReason);
  if (agent.status === 'parsing_completed') {
    return agent.analysisQueuedAt ? 'queued_for_ai' : 'waiting_for_scanners';
  }
  if (
    agent.status === 'running' &&
    (Boolean(agent.analysisStartedAt) || isAnalysisStep(agent.step) || stepProgress(agent.step) !== null)
  ) {
    return 'analyzing';
  }
  return 'ingesting';
}

function containerFacts(agent: ContainerDto | undefined): AgentFacts {
  const stage = containerStage(agent);
  const facts: AgentFacts = { stage, outcomeReason: agent?.outcomeReason };
  if (stage === 'analyzing' && agent) {
    const progress =
      count(agent.totalVulnerabilities) > 0
        ? { processed: count(agent.processedVulnerabilities), total: count(agent.totalVulnerabilities) }
        : stepProgress(agent.step);
    if (progress) {
      facts.processed = progress.processed;
      facts.total = progress.total;
    }
  }
  return facts;
}

function laneFacts(lane: ScanPipelineAgentLaneDto): AgentFacts {
  return {
    stage: lane.stage as AgentStage,
    outcomeReason: lane.outcomeReason,
    aiQueuePosition: lane.aiQueuePosition,
    processed: lane.processed,
    total: lane.total,
    since: lane.stageSince,
    deadline: lane.stageDeadline,
  };
}

function agentFacts(pipeline: ScanPipelineDto | null, agent: ContainerDto | undefined): AgentFacts {
  const lane = pipeline?.agent;
  // A stage this dashboard does not know yet is read from the container instead.
  return lane && KNOWN_STAGES.has(lane.stage) ? laneFacts(lane) : containerFacts(agent);
}

function progressOf(facts: AgentFacts): AiStepView['progress'] {
  const total = count(facts.total);
  if (total === 0) return undefined;
  const processed = Math.min(count(facts.processed), total);
  return { processed, total, percent: Math.round((processed / total) * 100) };
}

function elapsedText(since: string, now: Date): I18nText | undefined {
  const start = Date.parse(since);
  if (Number.isNaN(start)) return undefined;
  const minutes = Math.max(0, Math.floor((now.getTime() - start) / 60_000));
  if (minutes < 1) return text('time.elapsedJustNow');
  if (minutes < 60) return text('time.elapsedMinutes', { minutes });
  return text('time.elapsedHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** "time limit at HH:MM", in the viewer's time zone. */
function limitText(deadline: string): I18nText | undefined {
  const at = new Date(deadline);
  if (!deadline || Number.isNaN(at.getTime())) return undefined;
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return text('time.limitAt', { time });
}

function stageLabel(stage: AgentStage, queuePosition: number | undefined, progress: AiStepView['progress']): I18nText {
  if (stage === 'queued_for_ai') {
    return queuePosition ? text('stage.queued_for_ai', { position: queuePosition }) : text('step.queued_for_ai');
  }
  if (stage === 'analyzing') {
    return progress
      ? text('stage.analyzing', { processed: progress.processed, total: progress.total })
      : text('step.analyzing');
  }
  return text(`stage.${stage}`);
}

function stepsOf(stage: AgentStage, currentLabel: I18nText): AiStepperStep[] {
  const current = AI_STEPS.findIndex((id) => id === stage);
  const steps: AiStepperStep[] = AI_STEPS.map((id, index) => ({
    id,
    label: index === current ? currentLabel : text(`step.${id}`),
    state: index < current ? 'done' : index === current ? 'current' : 'upcoming',
  }));
  steps.push({ id: 'outcome', label: text('step.outcome'), state: 'upcoming' });
  return steps;
}

function aiViewOf(facts: AgentFacts, now: Date): AiStepView | null {
  const { stage } = facts;
  if (stage === 'not_applicable') return null;
  const active = ACTIVE_STAGES.has(stage);
  const progress = stage === 'analyzing' ? progressOf(facts) : undefined;
  const queuePosition = stage === 'queued_for_ai' ? position(facts.aiQueuePosition) : undefined;
  const label = stageLabel(stage, queuePosition, progress);
  const ai: AiStepView = { stage, label, tone: TONE_BY_STAGE[stage], steps: active ? stepsOf(stage, label) : [] };
  if (progress) ai.progress = progress;
  if (!active && facts.outcomeReason) {
    ai.reason = text(`reason.${OUTCOME_SET.has(facts.outcomeReason) ? facts.outcomeReason : 'unknown'}`);
  }
  if (active && facts.since) {
    ai.since = facts.since;
    const elapsed = elapsedText(facts.since, now);
    if (elapsed) ai.elapsed = elapsed;
  }
  if (active && facts.deadline) {
    ai.deadline = facts.deadline;
    const limit = limitText(facts.deadline);
    if (limit) ai.limit = limit;
  }
  return ai;
}

// ── scan ──────────────────────────────────────────────────────────────────────

function headlineOf(state: string, pipeline: ScanPipelineDto | null, lane: LaneCounts, facts: AgentFacts): I18nText {
  if (TERMINAL_SCAN_STATES.has(state)) return text('headline.finished');
  if (state === 'waiting_for_file') return text('headline.waitingForFile');
  if (state === 'queued') {
    const queuePosition = position(pipeline?.queuePosition);
    return queuePosition ? text('headline.queued', { position: queuePosition }) : text('headline.queuedNoPosition');
  }
  if (lane.total === 0) return text('headline.starting');
  if (lane.open > 0) return text('headline.scanners', { done: lane.total - lane.open, total: lane.total });
  switch (facts.stage) {
    case 'ingesting':
      return text('headline.aiIngesting');
    case 'waiting_for_scanners':
      return text('headline.aiWaitingForScanners');
    case 'queued_for_ai': {
      const aiPosition = position(facts.aiQueuePosition);
      return aiPosition ? text('headline.aiQueued', { position: aiPosition }) : text('headline.aiQueuedNoPosition');
    }
    case 'analyzing': {
      const progress = progressOf(facts);
      return progress
        ? text('headline.aiAnalyzing', { processed: progress.processed, total: progress.total })
        : text('headline.aiAnalyzingNoProgress');
    }
    default:
      return text('headline.scannersDone');
  }
}

function bannersOf(
  state: string,
  pipeline: ScanPipelineDto | null,
  lane: LaneCounts,
  facts: AgentFacts,
  heldForResults: boolean,
): Pick<ScanPipelineViewModel, 'banners' | 'bannerTone'> {
  if (state === 'queued') {
    const banners: I18nText[] = [];
    const queuePosition = position(pipeline?.queuePosition);
    if (queuePosition) banners.push(text('queue.position', { position: queuePosition }));
    const reason = pipeline?.queueReason ?? '';
    if (QUEUE_REASON_SET.has(reason)) banners.push(text(`queue.${reason}`));
    return { banners, bannerTone: 'info' };
  }
  // Every container is closed but the scan waits for its results to be stored:
  // they are not ready yet, whatever the slot says.
  if (state === 'running' && heldForResults) {
    return { banners: [text('banner.resultsSaving')], bannerTone: 'info' };
  }
  // The slot banner claims scanner results and a background AI analysis: only
  // true while the agent is really at work.
  if (state === 'running' && pipeline?.slotReleased && ACTIVE_STAGES.has(facts.stage)) {
    return { banners: [text('banner.slotReleased')], bannerTone: 'success' };
  }
  // Scanners done, AI still at work, slot not released (kill switch off, or an
  // API without the pipeline): the results are there all the same.
  if (state === 'running' && lane.total > 0 && lane.open === 0 && ACTIVE_STAGES.has(facts.stage)) {
    return { banners: [text('banner.scannersDone')], bannerTone: 'success' };
  }
  return { banners: [], bannerTone: 'info' };
}

export function buildScanPipelineView(scan: ScanResponseDto, now: Date = new Date()): ScanPipelineViewModel {
  const pipeline = scan.pipeline ?? null;
  const containers = Array.isArray(scan.containers) ? scan.containers : [];
  const scannerContainers = containers.filter((c) => !isAgent(c));
  const lane = laneOf(pipeline, scannerContainers);
  const facts = agentFacts(pipeline, pickAgent(containers.filter(isAgent)));
  const state = scan.state ?? '';

  const scanners = chipsOf(scannerContainers);
  const ai = aiViewOf(facts, now);
  const { banners, bannerTone } = bannersOf(state, pipeline, lane, facts, scan.step === HELD_FOR_RESULTS_STEP);

  return {
    headline: headlineOf(state, pipeline, lane, facts),
    scanners,
    scannerSummary: summaryOf(lane),
    ai,
    banners,
    bannerTone,
    fromPipeline: pipeline !== null,
    isEmpty: banners.length === 0 && scanners.length === 0 && ai === null,
  };
}

export default buildScanPipelineView;

import type { TFunction } from 'i18next';
import type { AgentStep } from '@/utils/function/agentParser';

const KEY = 'components.loaderScan.agentStatus';

/** The step fields the sentence reads (the parsed agent step). */
type StatusStep = Pick<AgentStep, 'phase' | 'action' | 'processed' | 'total' | 'tp' | 'fp' | 'err'>;

/**
 * What the AI agent is doing, as the scan loader writes it after its label:
 * one sentence in the interface's language (« Analysis completed, 3 of 10
 * findings reviewed, 2 confirmed »), never the log shape it replaced
 * (« Analysis completed 3/10 | TP=2 »). `phase` and `action` are the page's
 * reading of the step (a plain « parsing » step has neither in its JSON);
 * the step's own fields fill in what they leave out.
 */
export function agentStatusMessage(
  step: StatusStep | null | undefined,
  phase: string | undefined,
  action: string | undefined,
  t: TFunction,
): string | undefined {
  if (!step) return undefined;
  const stepPhase = phase || step.phase;
  const stepAction = action || step.action;

  if (stepPhase === 'analysis') {
    const facts: string[] = [];
    if (typeof step.processed === 'number' && typeof step.total === 'number') {
      facts.push(t(`${KEY}.reviewed`, { processed: step.processed, total: step.total }));
    }
    if (typeof step.tp === 'number') facts.push(t(`${KEY}.confirmed`, { count: step.tp }));
    if (typeof step.fp === 'number') facts.push(t(`${KEY}.falsePositives`, { count: step.fp }));
    if (typeof step.err === 'number') facts.push(t(`${KEY}.failed`, { count: step.err }));

    const lead =
      stepAction === 'done'
        ? t(`${KEY}.analysisDone`)
        : stepAction === 'start'
          ? t(`${KEY}.analysisStarted`)
          : facts.length > 0
            ? t(`${KEY}.analysisRunning`)
            : null;
    if (lead === null) return t(`${KEY}.analyzing`);
    return [lead, ...facts].join(', ');
  }

  if (stepPhase === 'vuln') {
    if (stepAction === 'start') return t(`${KEY}.vulnStart`);
    if (stepAction === 'result') return t(`${KEY}.vulnResult`);
    if (stepAction === 'done') return t(`${KEY}.vulnDone`);
    return t(`${KEY}.vulnRunning`);
  }

  if (stepPhase === 'prioritization') {
    if (stepAction === 'start') return t(`${KEY}.prioritizationStart`);
    if (stepAction === 'decided') return t(`${KEY}.prioritizationDecided`);
    return t(`${KEY}.prioritizationRunning`);
  }

  if (stepPhase === 'parsing') return t(`${KEY}.parsing`);
  if (stepPhase === 'ingestion') return t(`${KEY}.ingestion`);
  return undefined;
}

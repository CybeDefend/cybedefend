import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '@/components/atoms/button/Button';
import { ArrowRight, ChevronRight } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import type { SeverityType, StateType, TotalBySeverity, TotalByState } from '@/server/interfaces/Vulnerability';
import PosturePanel from './PosturePanel';
import { EYEBROW_CLASS, SEVERITY_WORD, STATE_WORD, countOf, useFigures } from './postureTokens';

export type NextStepId = 'fixCritical' | 'fixHigh' | 'triage' | 'fixConfirmed' | 'review';

export interface NextStep {
  id: NextStepId;
  count: number;
  severity?: SeverityType;
  state?: StateType;
}

/**
 * What the figures say to do, in order: the critical findings, then the high
 * ones, then what waits for triage, for a fix, for a review. Only steps with
 * something to do are listed; an empty list is good news.
 */
export function nextSteps(severity: ReadonlyArray<TotalBySeverity>, state: ReadonlyArray<TotalByState>): NextStep[] {
  const steps: NextStep[] = [];
  const critical = countOf(severity, 'severity', 'CRITICAL');
  if (critical > 0) steps.push({ id: 'fixCritical', count: critical, severity: 'CRITICAL' });
  const high = countOf(severity, 'severity', 'HIGH');
  if (high > 0) steps.push({ id: 'fixHigh', count: high, severity: 'HIGH' });
  const toVerify = countOf(state, 'state', 'to_verify');
  if (toVerify > 0) steps.push({ id: 'triage', count: toVerify, state: 'to_verify' });
  const confirmed = countOf(state, 'state', 'confirmed');
  if (confirmed > 0) steps.push({ id: 'fixConfirmed', count: confirmed, state: 'confirmed' });
  const proposed = countOf(state, 'state', 'proposed_not_exploitable');
  if (proposed > 0) steps.push({ id: 'review', count: proposed, state: 'proposed_not_exploitable' });
  return steps;
}

interface NextStepsProps {
  severity: TotalBySeverity[];
  state: TotalByState[];
  /** Where the findings of a severity are listed. */
  severityHref: (severity: SeverityType) => string;
  /** Where the findings in a state are listed. */
  stateHref: (state: StateType) => string;
  title?: string;
  actions?: React.ReactNode;
  testId?: string;
}

/** A step's figure is written in the colour of what it counts (no dot). */
const stepTone = (step: NextStep): string =>
  step.severity ? SEVERITY_WORD[step.severity] : STATE_WORD[step.state ?? 'ignored'] ?? STATE_WORD.ignored;

/**
 * « Next step »: the one thing to start with, then the two or three that
 * follow. Everything here is derived from the severity and state counts the
 * page already holds; each line leads to the filtered list it names.
 */
const NextSteps: React.FC<NextStepsProps> = ({ severity, state, severityHref, stateHref, title, actions, testId }) => {
  const { t } = useTranslation();
  const { n } = useFigures();

  const steps = useMemo(() => nextSteps(severity, state), [severity, state]);
  const [lead, ...rest] = steps;
  const following = rest.slice(0, 3);

  const hrefOf = (step: NextStep) => (step.severity ? severityHref(step.severity) : stateHref(step.state as StateType));
  const labelOf = (step: NextStep) => t(`components.projectOverview.posture.nextSteps.${step.id}`, { count: step.count });

  return (
    <PosturePanel
      title={title ?? t('components.projectOverview.posture.nextSteps.title')}
      meta={t('components.projectOverview.posture.nextSteps.meta')}
      actions={actions}
      testId={testId}
    >
      {lead ? (
        <div>
          <div data-testid="next-step-lead">
            <p className={cn('font-mono text-[32px] font-medium leading-9 tracking-[-0.03em] tabular-nums', stepTone(lead))}>
              {n(lead.count)}
            </p>
            <p className="mt-1 text-[14px] leading-5 text-zinc-700 dark:text-zinc-200">{labelOf(lead)}</p>
          </div>
          <Button
            variant="white"
            size="sm"
            to={hrefOf(lead)}
            icon={<ArrowRight className="h-3.5 w-3.5" />}
            iconPosition="right"
            className="mt-4"
          >
            {t('components.projectOverview.posture.nextSteps.open')}
          </Button>
        </div>
      ) : (
        <p className="text-[13px] leading-5 text-zinc-600 dark:text-zinc-300" data-testid="next-step-lead">
          {t('components.projectOverview.posture.nextSteps.nothing')}
        </p>
      )}

      {following.length > 0 && (
        <div className="mt-auto pt-5">
          <div className="border-t border-zinc-100 pt-4 dark:border-as-line">
          <p className={EYEBROW_CLASS}>{t('components.projectOverview.posture.nextSteps.then')}</p>
          <ul className="mt-1.5 -mx-2 space-y-0.5">
            {following.map((step) => (
              <li key={step.id}>
                <Button
                  variant="row"
                  size="xs"
                  to={hrefOf(step)}
                  className="group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-zinc-50 max-md:min-h-11 dark:hover:bg-white/[0.03]"
                >
                  <span className="min-w-0 flex-1 text-[13px] text-zinc-700 dark:text-zinc-200">
                    <span className={cn('font-mono tabular-nums', stepTone(step))}>{n(step.count)}</span> {labelOf(step)}
                  </span>
                  <ChevronRight
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-zinc-300 transition-colors duration-[120ms] group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-300"
                  />
                </Button>
              </li>
            ))}
          </ul>
          </div>
        </div>
      )}
    </PosturePanel>
  );
};

export default NextSteps;

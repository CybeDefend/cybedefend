import React from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle, ChevronRight, Clock, XCircle } from '@/components/atoms/icon/icons';
import type {
  AiStepperStep,
  AiStepView,
  AiTone,
  I18nText,
  ScannerChipState,
  ScanPipelineViewModel,
} from '@/utils/function/scanPipelineView';
import { AS_TAG, AS_WORD_TONE } from '@/components/atoms/appsec/styles';

/**
 * Where a scan really is: its queue position, a chip per scanner type, and the
 * AI lane (indexing → waiting for the scanners → waiting for an AI slot →
 * analysing → outcome). Everything it shows comes from `buildScanPipelineView`,
 * as i18n keys: this component only lays them out.
 */
interface ScanPipelinePanelProps {
  view: ScanPipelineViewModel;
}

const LANE_TITLE = 'text-xs font-medium text-zinc-500 dark:text-zinc-400';
const LANE_DETAIL = 'text-xs text-zinc-600 dark:text-zinc-300';

const Spinner: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <span
    aria-hidden
    className={`inline-block flex-shrink-0 border-2 border-secondary/30 border-t-secondary rounded-full animate-spin ${className}`}
  />
);

/* Quiet tags: the hairline is the chip, the icon carries the status colour, the word stays ink. */
const CHIP_CLASS: Record<ScannerChipState, string> = {
  done: 'text-zinc-700 dark:text-zinc-200',
  failed: 'text-red-700 dark:text-red-400',
  running: 'text-zinc-700 dark:text-zinc-200',
  waiting: 'text-zinc-500 dark:text-zinc-400',
};

const ChipIcon: React.FC<{ state: ScannerChipState }> = ({ state }) => {
  if (state === 'done') return <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />;
  if (state === 'failed') return <XCircle className="w-3.5 h-3.5 flex-shrink-0" />;
  if (state === 'running') return <Spinner className="w-3 h-3" />;
  return <Clock className="w-3.5 h-3.5 flex-shrink-0" />;
};

const STEP_CLASS: Record<AiStepperStep['state'], string> = {
  done: 'text-zinc-600 dark:text-zinc-300',
  current: 'font-semibold text-secondary dark:text-secondary-light',
  upcoming: 'text-zinc-400 dark:text-zinc-500',
};

const StepIcon: React.FC<{ state: AiStepperStep['state'] }> = ({ state }) => {
  if (state === 'done') return <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-green-500" />;
  if (state === 'current') return <Spinner />;
  return (
    <span aria-hidden className="inline-block w-3 h-3 flex-shrink-0 rounded-full border-2 border-zinc-300 dark:border-as-line-strong" />
  );
};

const OUTCOME_CLASS: Record<AiTone, string> = {
  success: 'text-green-700 dark:text-green-400',
  warning: 'text-medium-risk',
  danger: 'text-red-600 dark:text-red-400',
  active: 'text-secondary dark:text-secondary-light',
  neutral: 'text-zinc-700 dark:text-zinc-300',
};

const OutcomeIcon: React.FC<{ tone: AiTone }> = ({ tone }) => {
  if (tone === 'success') return <CheckCircle className="w-4 h-4 flex-shrink-0" />;
  if (tone === 'danger') return <XCircle className="w-5 h-5 flex-shrink-0" />;
  return <AlertTriangle className="w-5 h-5 flex-shrink-0" />;
};

const ScanPipelinePanel: React.FC<ScanPipelinePanelProps> = ({ view }) => {
  const { t } = useTranslation();
  const tx = (text: I18nText): string => t(text.key, text.params);

  if (view.isEmpty) return null;

  const aiTitle = t('components.analyseWrapper.pipeline.lane.ai');
  const scannersTitle = t('components.analyseWrapper.pipeline.lane.scanners');

  const renderAiLane = (ai: AiStepView) => {
    // One phrase, no separator: « 25 min elapsed, time limit at 14:05 ».
    const clock = [ai.elapsed, ai.limit].filter((x): x is I18nText => Boolean(x)).map(tx).join(', ');
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
          <span className={LANE_TITLE}>{aiTitle}</span>
          {clock && <span className={LANE_DETAIL}>{clock}</span>}
        </div>
        {ai.steps.length > 0 ? (
          <>
            <ol aria-label={aiTitle} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {ai.steps.map((step, index) => (
                <li
                  key={step.id}
                  data-state={step.state}
                  aria-current={step.state === 'current' ? 'step' : undefined}
                  className={`inline-flex items-center gap-1.5 text-xs ${STEP_CLASS[step.state]}`}
                >
                  <StepIcon state={step.state} />
                  <span>{tx(step.label)}</span>
                  {index < ai.steps.length - 1 && (
                    <ChevronRight className="w-2.5 h-2.5 flex-shrink-0 text-zinc-300 dark:text-zinc-500" />
                  )}
                </li>
              ))}
            </ol>
            {ai.progress && (
              <div
                role="progressbar"
                aria-label={tx(ai.label)}
                aria-valuenow={ai.progress.percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-2 h-1.5 w-full bg-secondary/10 rounded overflow-hidden"
              >
                <div className="h-full bg-secondary transition-all duration-500" style={{ width: `${ai.progress.percent}%` }} />
              </div>
            )}
          </>
        ) : (
          <div data-testid="scan-pipeline-outcome" data-tone={ai.tone} className={`flex items-start gap-2 ${OUTCOME_CLASS[ai.tone]}`}>
            <OutcomeIcon tone={ai.tone} />
            <div className="min-w-0">
              <p className="font-medium">{tx(ai.label)}</p>
              {ai.reason && <p className={LANE_DETAIL}>{tx(ai.reason)}</p>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      data-testid="scan-pipeline-panel"
      aria-label={t('components.analyseWrapper.pipeline.title')}
      className="mt-3 p-3 rounded-lg bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line text-[13px] space-y-3"
    >
      {view.banners.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 text-zinc-700 dark:text-zinc-200"
        >
          {/* A success is written in green; the other banners stay ink (no dot). */}
          <div className="min-w-0 space-y-0.5">
            {view.banners.map((banner) => (
              <p key={banner.key} className={`font-medium ${view.bannerTone === 'success' ? AS_WORD_TONE.good : ''}`}>
                {tx(banner)}
              </p>
            ))}
          </div>
        </div>
      )}

      {view.scanners.length > 0 && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
            <span className={LANE_TITLE}>{scannersTitle}</span>
            {view.scannerSummary && <span className={LANE_DETAIL}>{tx(view.scannerSummary)}</span>}
          </div>
          <ul aria-label={scannersTitle} className="flex flex-wrap gap-1.5">
            {view.scanners.map((chip) => (
              <li
                key={chip.type}
                data-state={chip.state}
                className={`${AS_TAG} ${CHIP_CLASS[chip.state]}`}
              >
                <ChipIcon state={chip.state} />
                <span>{tx(chip.label)}</span>
                <span className="sr-only">{tx(chip.stateLabel)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.ai && renderAiLane(view.ai)}
    </section>
  );
};

export default ScanPipelinePanel;

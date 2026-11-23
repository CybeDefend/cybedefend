// ============================================================================
// StepIndicator - Visual step progress indicator
// ============================================================================

import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { Check } from '@/components/atoms/icon/icons';
import type { IconProps } from '@/components/atoms/icon/icons';

import { AS_HAIRLINE, AS_FOCUS, AS_TOUCH } from '@/components/atoms/appsec/styles';
/** Any icon from the registry: a component taking the shared icon props. */
type IconComponent = React.ComponentType<IconProps>;

interface Step {
  id: number;
  key: string;
  label: string;
  icon: IconComponent;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
  onStepClick: (step: number) => void;
  stepErrors: Record<number, string[]>;
}

/**
 * The wizard's steps as one compact row, the way the reports wizard shows
 * them: a numbered circle and the step's name side by
 * side, hairlines between them, left-aligned instead of spread over the page
 * width. The current step's number sits on the accent, a done step is
 * checked, a step with errors carries a red mark. On a phone only the current
 * step keeps its name, and the row scrolls sideways without a scrollbar.
 */
const StepIndicator: React.FC<StepIndicatorProps> = ({
  steps,
  currentStep,
  onStepClick,
  stepErrors,
}) => {
  const { t } = useTranslation();
  return (
    <div className="-mx-1 flex items-center gap-2 overflow-x-auto overflow-y-hidden px-1 py-1 scrollbar-hide">
      {steps.map((step, index) => {
        const isCompleted = step.id < currentStep;
        const isCurrent = step.id === currentStep;
        const hasErrors = (stepErrors[step.id] || []).length > 0;

        return (
          <React.Fragment key={step.id}>
            <button
              onClick={() => onStepClick(step.id)}
              aria-current={isCurrent ? 'step' : undefined}
              className={cn(
                'relative flex shrink-0 items-center gap-2 rounded-md px-1 py-1 group transition-colors duration-[120ms]',
                AS_FOCUS, AS_TOUCH
              )}
            >
              {/* Step Circle */}
              <span
                className={cn(
                  'relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-medium tabular-nums transition-colors duration-[120ms]',
                  isCompleted && !hasErrors
                    ? 'bg-zinc-100 text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300'
                    : isCurrent
                    ? 'bg-secondary text-white'
                    : hasErrors
                    ? 'border border-red-500 text-red-600 dark:text-red-400'
                    : 'border border-zinc-300 text-zinc-500 group-hover:border-zinc-400 dark:border-as-line-strong dark:text-zinc-400 dark:group-hover:border-white/[0.2]'
                )}
              >
                {isCompleted && !hasErrors ? <Check className="h-3 w-3" /> : step.id}

                {/* Error indicator */}
                {hasErrors && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[11px] font-medium leading-none text-white">
                    !
                  </span>
                )}
              </span>

              {/* Step Label */}
              <span className="sr-only">{t('common.stepNumber', { number: step.id })}</span>
              <span
                className={cn(
                  'whitespace-nowrap text-[13px] font-medium transition-colors duration-[120ms]',
                  isCurrent
                    ? 'text-zinc-900 dark:text-zinc-100'
                    : hasErrors
                    ? 'text-red-600 dark:text-red-400 max-sm:sr-only'
                    : 'text-zinc-500 group-hover:text-zinc-800 dark:text-zinc-400 dark:group-hover:text-zinc-200 max-sm:sr-only'
                )}
              >
                {step.label}
              </span>
            </button>
            {index < steps.length - 1 && (
              <span
                aria-hidden="true"
                className={cn('h-px w-6 shrink-0 sm:w-10', isCompleted ? 'bg-secondary/50' : AS_HAIRLINE)}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default StepIndicator;

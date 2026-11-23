import React from "react";
import { useTranslation } from "react-i18next";

import { AS_HAIRLINE } from '@/components/atoms/appsec/styles';
interface StepIndicatorProps {
  current: number;
  total: number;
  titles: string[];
  /**
   * `zinc`: the zinc kit's look — the counter
   * in mono, then one 2 px segment per step (ink when reached), its title
   * under it in zinc. Omitted: today's numbered discs.
   */
  variant?: "default" | "zinc";
}

const StepIndicator: React.FC<StepIndicatorProps> = ({ current, total, titles, variant = "default" }) => {
  const { t } = useTranslation();
  if (variant === "zinc") {
    return (
      <div className="mb-5">
        <p className="mb-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          {t("components.modal.createProject.stepIndicator.current", {
            current,
            total,
          })}
        </p>
        <ol className="flex gap-2">
          {titles.map((title, idx) => {
            const step = idx + 1;
            const reached = step <= current;
            return (
              <li
                key={step}
                aria-current={step === current ? "step" : undefined}
                className="min-w-0 flex-1"
              >
                <span
                  aria-hidden="true"
                  className={`block h-0.5 rounded-full transition-colors duration-200 ${
                    reached ? "bg-zinc-900 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-white/[0.08]"
                  }`}
                />
                <span
                  className={`mt-1.5 block text-xs [overflow-wrap:anywhere] ${
                    step === current
                      ? "font-medium text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {title}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }
  return (
    <div className="mb-6">
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
        {t("components.modal.createProject.stepIndicator.current", {
          current,
          total,
        })}
      </p>
      {/* Wraps: three French titles on one row ran out of the dialog at 320 px. */}
      <div className="flex flex-wrap items-center gap-2 gap-y-1">
        {titles.map((title, idx) => {
          const step = idx + 1;
          const active = step === current;
          const done = step < current;
          return (
            <React.Fragment key={step}>
              <div
                className={`flex min-w-0 items-center gap-2 ${
                  active || done
                    ? "text-secondary dark:text-secondary-light"
                    : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                <span
                  className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                    active
                      ? "bg-secondary text-white"
                      : done
                        ? "bg-secondary/15 text-secondary dark:bg-secondary/20 dark:text-secondary-light"
                        : "bg-zinc-100 text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400"
                  }`}
                >
                  {step}
                </span>
                <span className="min-w-0 text-[13px] font-medium [overflow-wrap:anywhere]">{title}</span>
              </div>
              {step < total && (
                <div className={`h-px flex-1 ${AS_HAIRLINE}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default StepIndicator;

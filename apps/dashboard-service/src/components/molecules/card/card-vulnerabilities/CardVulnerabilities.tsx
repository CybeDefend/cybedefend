import React from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../../atoms/skeleton/Skeleton";
import { ShieldCheck } from "@/components/atoms/icon/icons";
import SeverityCount from "@/components/atoms/badge/SeverityCount";
import { AS_KPI_LABEL, AS_KPI_NOTE } from "@/components/atoms/appsec/styles";
import { AS_GLYPH } from "@/components/atoms/appsec/recipes";
import { cn } from "@/utils/function/utils";

interface CardVulnerabilitiesProps {
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  borderWidth?: number;
  loading?: boolean;
  /** The headline, when the page counts something other than vulnerabilities. */
  title?: string;
  /** What the card says when there is nothing to count. */
  emptyLabel?: string;
}

/** Severity order, worst first — also the order of the ring's arcs. */
const SEVERITIES = [
  { key: "critical", ring: "var(--color-critical-risk)" },
  { key: "high", ring: "var(--color-high-risk)" },
  { key: "medium", ring: "var(--color-medium-risk)" },
  { key: "low", ring: "var(--color-low-risk)" },
] as const;

/**
 * Fourth card of the dashboard KPI row. It carries the same « figure first »
 * reading as its three `CardIcon` neighbours — the mono total, the label, the
 * breakdown — because a grid of four cards where one is built differently
 * reads as a rendering fault rather than as a different measure. The conic
 * ring stays: it is the one place the four severity shares are seen at once.
 *
 * With no vulnerabilities the ring has nothing to divide, so it says that in
 * words instead of showing four zeros against a `NaN%` gradient.
 */
const CardVulnerabilities: React.FC<CardVulnerabilitiesProps> = ({
  criticalCount,
  highCount,
  mediumCount,
  lowCount,
  borderWidth = 6,
  loading,
  title,
  emptyLabel,
}) => {
  const { t } = useTranslation();

  const counts: Record<string, number> = {
    critical: criticalCount,
    high: highCount,
    medium: mediumCount,
    low: lowCount,
  };
  const total = criticalCount + highCount + mediumCount + lowCount;

  // Arcs are laid out worst-first so the eye meets the critical share at 12
  // o'clock; an empty total gets a flat neutral ring rather than a division.
  let cursor = 0;
  const stops = SEVERITIES.map(({ key, ring }) => {
    const start = cursor;
    cursor += (counts[key] / total) * 100;
    return `${ring} ${start}% ${cursor}%`;
  });
  const ringBackground = total > 0
    ? `conic-gradient(${stops.join(", ")})`
    : "conic-gradient(var(--color-low-risk) 0% 100%)";

  if (loading) {
    return (
      <div className="h-full p-4 sm:p-5">
        <div className="flex items-center h-full">
          <Skeleton type="avatar" height="40px" width="40px" />
          <div className="flex flex-col ml-3 flex-1">
            <Skeleton type="text" rows={1} width="60%" />
            <div className="mb-2"></div>
            <Skeleton type="text" rows={1} width="80%" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full p-4 sm:p-5">
      <div className="flex items-start h-full gap-3">
        {total > 0 ? (
          <div
            data-testid="card-vulnerabilities-ring"
            className="w-14 h-14 rounded-full flex-shrink-0"
            style={{ background: ringBackground, padding: `${borderWidth}px` }}
          >
            <div className="w-full h-full bg-white dark:bg-as-surface rounded-full" />
          </div>
        ) : (
          <div className="flex items-center justify-center h-10 w-10 flex-shrink-0">
            <ShieldCheck className={AS_GLYPH} />
          </div>
        )}

        <div className="flex flex-col min-w-0">
          {title ? (
            <p
              data-testid="card-vulnerabilities-total"
              className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100 leading-tight"
            >
              {title}
            </p>
          ) : (
            <div data-testid="card-vulnerabilities-total">
              <p className="font-mono text-2xl font-medium leading-7 tracking-[-0.03em] tabular-nums text-zinc-900 dark:text-zinc-50">
                {total}
              </p>
              <p className={cn(AS_KPI_LABEL, "mt-1 truncate")}>
                {t("common.vulnerability", { count: total })}
              </p>
            </div>
          )}

          {total > 0 ? (
            <div
              data-testid="card-vulnerabilities-legend"
              className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              {/* The legend has room for the word, so it is written out (the home list's column has not, and keeps the initial). */}
              {SEVERITIES.map(({ key }) => (
                <SeverityCount
                  key={key}
                  severity={key}
                  count={counts[key]}
                  label={t(`common.severity.${key}`)}
                />
              ))}
            </div>
          ) : (
            <p
              data-testid="card-vulnerabilities-empty"
              className={cn(AS_KPI_NOTE, "mt-1")}
            >
              {emptyLabel ?? t("common.severity.none")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CardVulnerabilities;

import { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import SeverityChip from "@/components/atoms/badge/SeverityChip";
import { AS_SENTENCE_CASE } from "@/components/atoms/appsec/styles";

export type CyberRiskLevel = "none" | "low" | "medium" | "high" | "critical";

interface Props {
  level: CyberRiskLevel;
  score?: number;
}

/**
 * Shared CybeRisk badge with a pure-Tailwind group-hover tooltip.
 * The score scale is unbounded (no "/100"). The tooltip shows ONLY the
 * CybeRisk Score; the level is already conveyed by the chip itself.
 *
 * The level is the shared soft chip in the risk colour (the level is
 * outlined), read in sentence case. The string stays
 * `CRITICAL` (tests and every consumer read it so); only CSS lowers its case.
 */
export function CyberRiskBadge({ level, score }: Props): ReactElement {
  const { t, i18n } = useTranslation();

  const formattedScore =
    typeof score === "number"
      ? new Intl.NumberFormat(i18n.language).format(score)
      : null;

  return (
    <div className="group relative inline-block">
      <SeverityChip level={level || "none"}>
        <span className={AS_SENTENCE_CASE}>{level ? level.toUpperCase() : "NONE"}</span>
      </SeverityChip>
      <div
        data-testid="cyberisk-tooltip"
        className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 rounded-md bg-zinc-900 px-2 py-1 text-xs leading-4 text-white dark:bg-zinc-100 dark:text-zinc-900 whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-[120ms] pointer-events-none z-10"
      >
        <div>
          {t("components.analysisTable.cyberRiskScore")}: {formattedScore ?? t("common.notAvailable")}
        </div>
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-px">
          <div className="border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-100" />
        </div>
      </div>
    </div>
  );
}

export default CyberRiskBadge;

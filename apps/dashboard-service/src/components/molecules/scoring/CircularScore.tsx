import React from 'react';
import { useTranslation } from 'react-i18next';

/*
 * The round score gauge of the scoring tab's cards (CVSS, and the cloud's
 * EPSS card), moved out of ScoringExploitabilityTab.tsx unchanged so that a
 * card the closed tree registers draws the same gauge.
 */

/* ---------- helpers ---------- */

const getScoreStrokeColor = (score: number): string => {
  if (score >= 9.0) return '#ff6659';
  if (score >= 7.0) return '#ff8c4a';
  if (score >= 4.0) return '#e6b800';
  return '#4a90e2';
};

/* ---------- sub-components ---------- */

export const CircularScore: React.FC<{ score: number | null | undefined; displayValue?: string; size?: number }> = ({
  score,
  displayValue,
  size = 80,
}) => {
  const { t } = useTranslation();
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const hasValue = typeof score === 'number' && score > 0;
  const offset = hasValue ? circumference - (score / 10) * circumference : circumference;
  const stroke = hasValue ? getScoreStrokeColor(score) : '#9ca3af';

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        className="-rotate-90"
        viewBox="0 0 100 100"
        width={size}
        height={size}
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke="#e0e0e0"
          strokeWidth="6"
          className="dark:stroke-zinc-700"
        />
        {hasValue && (
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={stroke}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {/* No score: a short word in the UI font, never a dash. */}
        {hasValue ? (
          <span className="text-xl font-medium" style={{ color: stroke }}>
            {displayValue ?? score.toFixed(1)}
          </span>
        ) : (
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('pages.issuePage.scoring.unavailableShort')}</span>
        )}
      </div>
    </div>
  );
};

export default CircularScore;

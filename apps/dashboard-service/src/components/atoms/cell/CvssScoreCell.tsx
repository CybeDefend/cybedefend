import React from 'react';
import { useTranslation } from 'react-i18next';
import UnavailableValue from '@/components/atoms/unavailable-value/UnavailableValue';

export interface CvssScoreCellProps {
  score: number | null | undefined;
  size?: number;
}

const getStrokeColor = (score: number): string => {
  if (score >= 9.0) return '#ff6659';
  if (score >= 7.0) return '#ff8c4a';
  if (score >= 4.0) return '#e6b800';
  return '#4a90e2';
};

const CvssScoreCell: React.FC<CvssScoreCellProps> = ({ score, size = 36 }) => {
  const { t } = useTranslation();
  const hasValue = typeof score === 'number' && score > 0;
  // A score that was not read is said in words, in the interface's font: never a dash, never 0.
  if (!hasValue) {
    return <UnavailableValue label={t('common.notAvailable')} className="text-xs text-zinc-500 dark:text-zinc-450" />;
  }
  const stroke = getStrokeColor(score);
  const radius = 15.9155;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 10) * circumference;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        className="w-full h-full -rotate-90"
        viewBox="0 0 36 36"
      >
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke="#e0e0e0"
          strokeWidth="3"
          // The chart grid token: zinc-200 on light, a faint white on dark.
          style={{ stroke: 'var(--as-chart-grid)' }}
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-medium font-mono text-xs tabular-nums"
        style={{ color: stroke }}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
};

export default CvssScoreCell;

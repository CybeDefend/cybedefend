import React from 'react';

export interface BarRowProps {
  label: string;
  weight: number;
  contribution: number;
  barColor: string;
  valueColor: string;
}

/** One row of the decomposition: a factor, its weight and its share; exported for the rows a slot adds. */
export const DecompositionBarRow: React.FC<BarRowProps> = ({
  label,
  weight,
  contribution,
  barColor,
  valueColor,
}) => {
  const barWidth = weight > 0 ? Math.min((contribution / weight) * 100, 100) : 0;
  const displayScore = Math.round(barWidth);

  return (
    <div className="grid grid-cols-[110px_1fr_45px] gap-3 items-center">
      <div>
        <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          {label}
        </div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {Math.round(weight * 100)}%
        </div>
      </div>
      <div className="h-6 rounded-lg bg-zinc-100 dark:bg-as-raised overflow-hidden relative">
        <div
          className={`h-full rounded-lg ${barColor}`}
          style={{ width: `${barWidth}%` }}
        />
        <div className="absolute inset-0 flex items-center px-3">
          <span className="text-[11px] font-medium text-white drop-shadow-sm">
            {displayScore}
          </span>
        </div>
      </div>
      <div className={`text-right text-xs font-medium ${valueColor}`}>
        {displayScore}
        <span className="text-[11px] font-normal text-zinc-500 dark:text-zinc-400">/100</span>
      </div>
    </div>
  );
};

export default DecompositionBarRow;

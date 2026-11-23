import React from 'react';
import { cn } from '@/utils/function/utils';
import { AS_KPI_SPARK } from '@/components/atoms/appsec/styles';
import { sparklinePoints, SPARK_HEIGHT, SPARK_WIDTH } from './sparklinePoints';

interface KpiSparklineProps {
  /** The series the page already holds, oldest first. */
  series: readonly (number | null | undefined)[];
  /** What the line shows, as a sentence; without it the line is decoration (the figure and the page's own chart or table carry the data). */
  label?: string;
  className?: string;
}

/**
 * A KPI's last readings as one thin zinc polyline, 64 × 20.
 * Not recharts: at this size a polyline is all a sparkline needs.
 * Below two readings it draws nothing at all, so a card never shows a stub.
 */
const KpiSparkline: React.FC<KpiSparklineProps> = ({ series, label, className }) => {
  const points = sparklinePoints(series);
  if (!points) return null;
  return (
    <svg
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio="none"
      className={cn(AS_KPI_SPARK, 'overflow-visible', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      data-testid="kpi-sparkline"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export default KpiSparkline;

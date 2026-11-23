import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Cell, Pie, PieChart } from 'recharts';
import { useReducedMotion } from 'framer-motion';
import Button from '@/components/atoms/button/Button';
import { ChevronRight } from '@/components/atoms/icon/icons';
import { cn } from '@/utils/function/utils';
import { projectPath } from '@/utils/product';
import type { TotalByAnalysisType } from '@/server/interfaces/Vulnerability';
import { useDocumentTheme } from '@/utils/theme/useDocumentTheme';
import PosturePanel from './PosturePanel';
import { SCANNER_LABEL, SCANNER_SEGMENT, scannerKey, sumCounts, useFigures } from './postureTokens';

interface ScannerRankingProps {
  data: TotalByAnalysisType[];
  /** Given, each row (and each slice) opens that scanner's results tab of the project. */
  projectId?: string;
  title?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  testId?: string;
}

/*
  One hue per scanner, fixed (a scanner keeps its colour whatever its rank and
  on both overview pages): the brand violet first, then muted tones kept away
  from the four severity colours so a slice never reads as a severity. Each
  theme has its own steps, validated as a set (dataviz validator, all pairs,
  OKLab ΔE×100): light worst pair SCA / AI-BOM 14.8 normal, 8.7 protan or
  deutan, every other pair 16.8 and up; dark worst pair SCA / AI-BOM 14.4 and
  7.9, every other pair 16.2 and up. The 2 px gaps between slices and the
  named legend beside the ring are the second channel those two pairs need.
  Container's light step sits at 2.6:1 on white: its count is written in the
  legend, which is the relief the rule asks for. The hues are literal hex,
  chosen from the theme the document shows: the PNG / PDF export copies the
  ring's SVG as it is, where a CSS variable defined on a parent resolves to
  nothing and every slice came out black.
*/
const SCANNER_HUE: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    SAST: '#7845FF',
    IAC: '#189E8C',
    SCA: '#1C67A4',
    SECRET: '#BD8B31',
    CICD: '#386C2D',
    CONTAINER: '#8F9CE0',
    AIBOM: '#683C71',
  },
  dark: {
    SAST: '#9878F6',
    IAC: '#37B19E',
    SCA: '#3179B7',
    SECRET: '#D19E47',
    CICD: '#4A7E3E',
    CONTAINER: '#AEB6EE',
    AIBOM: '#7C4F86',
  },
};
/** A scanner the palette does not know yet: zinc, never a borrowed hue. */
const OTHER_HUE = { light: '#A1A1AA', dark: '#71717A' } as const;

/** The ring: 148 px across, 11 px thick, a 2 px gap between two slices (1.6° at its middle radius). */
const SIZE = 148;
const OUTER = 73;
const INNER = 62;
const GAP_DEG = 1.6;

/** A slice that is not the one pointed at fades back, so the pointed one stands out; at rest every slice is a step under full. */
const REST_OPACITY = 0.92;
const DIM_OPACITY = 0.28;

const ROW_CLASS = 'group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors duration-[120ms] max-md:min-h-11';
const ROW_ON = 'bg-zinc-50 dark:bg-white/[0.03]';

interface Row {
  key: string;
  label: string;
  count: number;
  hue: string;
  href?: string;
}

/**
 * « Where they are »: the open findings by scanner, as a thin ring (one hue
 * per scanner, the total in its centre) and, beside it, the scanners ranked
 * by count, each with its colour, its count and its share. Pointing at a
 * slice or a row brings that scanner forward and writes its count in the
 * centre. On a project page a row, and a slice, opens that scanner's results;
 * the organisation has no such page, so there the rows are plain.
 */
const ScannerRanking: React.FC<ScannerRankingProps> = ({ data, projectId, title, meta, actions, testId }) => {
  const { t } = useTranslation();
  const { n, pct } = useFigures();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const theme = useDocumentTheme().isDark ? 'dark' : 'light';
  const [active, setActive] = useState<string | null>(null);

  const rows = useMemo<Row[]>(
    () =>
      data
        .filter((item) => item.count > 0)
        .map((item) => {
          const key = scannerKey(item.analysisType);
          const segment = SCANNER_SEGMENT[key];
          return {
            key: item.analysisType,
            label: SCANNER_LABEL[key] ? t(SCANNER_LABEL[key]) : item.analysisType,
            count: item.count,
            hue: SCANNER_HUE[theme][key] ?? OTHER_HUE[theme],
            href: projectId && segment ? projectPath('appsec', projectId, segment) : undefined,
          };
        })
        .sort((a, b) => b.count - a.count),
    [data, projectId, t, theme],
  );

  // What the ring draws: the label and the count only (recharts writes every field of a slice onto its path).
  const slices = useMemo(() => rows.map((row) => ({ label: row.label, count: row.count })), [rows]);

  const total = sumCounts(rows);
  const pointed = rows.find((row) => row.key === active) ?? null;
  const centre = pointed
    ? { value: pointed.count, word: pointed.label }
    : { value: total, word: t('components.projectOverview.posture.scanners.centre', { count: total }) };

  const opacityOf = (key: string) => (active === null ? REST_OPACITY : active === key ? 1 : DIM_OPACITY);

  return (
    <PosturePanel
      title={title ?? t('components.projectOverview.posture.scanners.title')}
      meta={meta ?? t('components.projectOverview.posture.scanners.meta')}
      actions={actions}
      testId={testId}
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
          {t('components.projectOverview.posture.scanners.empty')}
        </p>
      ) : (
        // Side by side where the panel is wide; on a phone and in the two-column band between lg and xl, the ring above its legend.
        <div className="my-auto flex items-center gap-x-7 gap-y-5 max-sm:flex-col lg:max-xl:flex-col">
          <div
            role="img"
            aria-label={rows.map((row) => `${row.label} ${n(row.count)}`).join(', ')}
            className="relative shrink-0"
            style={{ width: SIZE, height: SIZE }}
            data-testid="scanner-donut"
          >
            <PieChart width={SIZE} height={SIZE}>
              <Pie
                data={slices}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                startAngle={90}
                endAngle={-270}
                innerRadius={INNER}
                outerRadius={OUTER}
                paddingAngle={rows.length > 1 ? GAP_DEG : 0}
                minAngle={rows.length > 1 ? 2 : 0}
                cornerRadius={1.5}
                stroke="none"
                isAnimationActive={!reducedMotion}
                animationDuration={600}
                animationEasing="ease-out"
                onMouseEnter={(_, index) => setActive(rows[index]?.key ?? null)}
                onMouseLeave={() => setActive(null)}
                onClick={(_, index) => {
                  const href = rows[index]?.href;
                  if (href) navigate(href);
                }}
              >
                {rows.map((row) => (
                  <Cell
                    key={row.key}
                    fill={row.hue}
                    fillOpacity={opacityOf(row.key)}
                    style={{ transition: 'fill-opacity 160ms ease-out', cursor: row.href ? 'pointer' : 'default', outline: 'none' }}
                  />
                ))}
              </Pie>
            </PieChart>
            {/* The centre: the total at rest, the pointed scanner's count and name while a slice or a row is pointed at. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-[24px] font-medium leading-8 tracking-[-0.03em] tabular-nums text-zinc-900 dark:text-zinc-50">
                {n(centre.value)}
              </span>
              <span className="whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">{centre.word}</span>
            </div>
          </div>

          <ul className="-mx-2 min-w-0 flex-1 space-y-0.5 max-sm:self-stretch lg:max-xl:self-stretch">
            {rows.map((row) => {
              const on = active === row.key;
              const content = (
                <>
                  <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: row.hue }} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-700 dark:text-zinc-200">{row.label}</span>
                  <span className="w-10 shrink-0 text-right font-mono text-[13px] tabular-nums text-zinc-900 dark:text-zinc-50">
                    {n(row.count)}
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {pct(total > 0 ? row.count / total : 0)}
                  </span>
                  {row.href && (
                    <ChevronRight
                      aria-hidden="true"
                      className="h-3.5 w-3.5 shrink-0 text-zinc-300 transition-colors duration-[120ms] group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-300"
                    />
                  )}
                </>
              );
              return (
                <li
                  key={row.key}
                  onMouseEnter={() => setActive(row.key)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(row.key)}
                  onBlur={() => setActive(null)}
                >
                  {row.href ? (
                    <Button
                      variant="row"
                      size="xs"
                      to={row.href}
                      aria-label={`${row.label}: ${n(row.count)}`}
                      className={cn(ROW_CLASS, on ? ROW_ON : 'hover:bg-zinc-50 dark:hover:bg-white/[0.03]')}
                    >
                      {content}
                    </Button>
                  ) : (
                    <div className={cn(ROW_CLASS, on && ROW_ON)}>{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </PosturePanel>
  );
};

export default ScannerRanking;

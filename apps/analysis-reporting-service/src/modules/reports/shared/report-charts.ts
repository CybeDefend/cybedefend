// report-charts.ts
//
// Report charts, rendered server side as static SVG / HTML. Chart.js (canvas
// + script) had two flaws: the dashboard preview shows the HTML in a
// `sandbox=""` iframe where no script runs, hence empty frames; and the PDF
// had to wait for the animations to end. A static SVG shows everywhere,
// weighs a few hundred bytes and inherits the report's font.

import { escapeHtml } from '../../../core/utils/html-escape';

export interface ChartDatum {
  label: string;
  value: number;
  color: string;
  /** Identifier shown in discreet mono before the label (e.g. CWE-400). */
  id?: string;
}

const fmt = (n: number): string => n.toLocaleString('en-US');

const RADIUS = 42;
const STROKE = 13;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TRACK = '#eeebf3';
// Dot of a zero entry: greyed, colour stays reserved for values.
const ZERO_DOT = '#d9d4e0';

/**
 * Whole shares (%) of the values, by largest remainder: rounded one by one,
 * they could add up to 101 %. Two equal values always get the same share (1
 * and 1 out of 13: never 8 % and 7 %), even if the total is then 99 %.
 */
function roundedShares(values: number[], total: number): number[] {
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((v) => (Math.max(0, v) / total) * 100);
  const shares = exact.map((x) => Math.floor(x));
  let left = 100 - shares.reduce((sum, x) => sum + x, 0);
  const remainder = (v: number) => ((v / total) * 100) % 1;
  const byRemainder = Array.from(new Set(values)).sort(
    (a, b) => remainder(b) - remainder(a),
  );
  for (const value of byRemainder) {
    const same = values
      .map((v, i) => (v === value ? i : -1))
      .filter((i) => i >= 0);
    if (remainder(value) === 0 || same.length > left) continue;
    same.forEach((i) => (shares[i] += 1));
    left -= same.length;
  }
  return shares;
}

// A non-zero share that rounds to 0 reads « <1% », never « 0% ».
const pctText = (value: number, share: number): string =>
  value > 0 && share === 0 ? '&lt;1%' : `${share}%`;

/** Distribution ring + total in the centre + legend (value and share). */
export function donutChart(
  data: ChartDatum[],
  opts: { centerLabel?: string; size?: number } = {},
): string {
  const size = opts.size ?? 132;
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  let offset = 0;
  const arcs = data
    .filter((d) => d.value > 0 && total > 0)
    .map((d) => {
      // A tiny non-zero share stays visible; its real value is in the legend.
      const length = Math.max(1.5, (d.value / total) * CIRCUMFERENCE);
      const arc = `<circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="${escapeHtml(d.color)}" stroke-width="${STROKE}" stroke-dasharray="${length.toFixed(3)} ${(CIRCUMFERENCE - length).toFixed(3)}" stroke-dashoffset="${(-offset).toFixed(3)}" transform="rotate(-90 50 50)"/>`;
      offset += length;
      return arc;
    })
    .join('');
  const center = opts.centerLabel
    ? `<text x="50" y="50" text-anchor="middle" class="donut-total">${fmt(total)}</text><text x="50" y="63" text-anchor="middle" class="donut-caption">${escapeHtml(opts.centerLabel)}</text>`
    : `<text x="50" y="56" text-anchor="middle" class="donut-total">${fmt(total)}</text>`;
  const shares = roundedShares(
    data.map((d) => d.value),
    total,
  );
  const legend = data
    .map(
      (d, i) =>
        `<li${d.value === 0 ? ' class="is-zero"' : ''}><span class="legend-dot" style="background:${d.value === 0 ? ZERO_DOT : escapeHtml(d.color)};"></span><span class="legend-label">${escapeHtml(d.label)}</span><span class="legend-value">${fmt(d.value)}</span><span class="legend-pct">${pctText(d.value, shares[i])}</span></li>`,
    )
    .join('');
  return `<div class="donut">
  <svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img"><circle cx="50" cy="50" r="${RADIUS}" fill="none" stroke="${TRACK}" stroke-width="${STROKE}"/>${arcs}${center}</svg>
  <ul class="chart-legend">${legend}</ul>
</div>`;
}

/** Horizontal bars (legible labels, never slanted). */
export function horizontalBars(
  data: ChartDatum[],
  opts: { labelWidth?: string } = {},
): string {
  const labelStyle = opts.labelWidth
    ? ` style="width: ${escapeHtml(opts.labelWidth)};"`
    : '';
  const max = Math.max(0, ...data.map((d) => d.value));
  const rows = data
    .map((d) => {
      const width = max > 0 ? Math.round((d.value / max) * 100) : 0;
      return `<div class="hbar-row"><span class="hbar-label"${labelStyle}>${d.id ? `<span class="hbar-id">${escapeHtml(d.id)}</span>` : ''}${escapeHtml(d.label)}</span><span class="hbar-track"><span class="hbar-fill" style="width: ${width}%; background:${escapeHtml(d.color)};"></span></span><span class="hbar-value">${fmt(d.value)}</span></div>`;
    })
    .join('');
  return `<div class="hbars">${rows}</div>`;
}

/** Single segmented bar (e.g. severity distribution under a title). */
export function stackedBar(data: ChartDatum[]): string {
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const segments = data
    .filter((d) => d.value > 0 && total > 0)
    .map(
      (d) =>
        `<span class="stack-seg" title="${escapeHtml(d.label)}" style="width: ${((d.value / total) * 100).toFixed(2)}%; background:${escapeHtml(d.color)};"></span>`,
    )
    .join('');
  return `<div class="stack-bar">${segments}</div>`;
}

/** Chart CSS, to include once per document. */
export const REPORT_CHARTS_CSS = `
  .donut { display: flex; align-items: center; gap: 20px; }
  .donut svg { flex: none; }
  .donut-total { font-size: 20px; font-weight: 700; fill: #281434; }
  .donut-caption { font-size: 7.5px; font-weight: 500; fill: #736c7f; letter-spacing: 0.1px; text-transform: uppercase; }
  .chart-legend { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 0; }
  .chart-legend li { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 11px; color: #3f3a4a; }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .legend-label { flex: 1; }
  .chart-legend li.is-zero { color: #736c7f; }
  .chart-legend li.is-zero .legend-value { color: #b8b2c2; font-weight: 400; }
  .legend-value { font-weight: 600; color: #281434; font-variant-numeric: tabular-nums; }
  .legend-pct { width: 34px; text-align: right; color: #736c7f; font-variant-numeric: tabular-nums; }
  .hbars { display: flex; flex-direction: column; gap: 7px; }
  .hbar-row { display: flex; align-items: center; gap: 10px; font-size: 11px; color: #3f3a4a; }
  .hbar-label { width: 72px; flex: none; }
  .hbar-id { font-family: 'JetBrains Mono', 'FreeMono', monospace; font-size: 9.5px; color: #736c7f; margin-right: 5px; }
  .hbar-track { flex: 1; height: 8px; background: ${TRACK}; border-radius: 2px; overflow: hidden; }
  .hbar-fill { display: block; height: 100%; border-radius: 2px; }
  .hbar-value { width: 36px; flex: none; text-align: right; font-weight: 600; color: #281434; font-variant-numeric: tabular-nums; }
  .stack-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; background: ${TRACK}; }
  .stack-seg { display: block; height: 100%; }
`;

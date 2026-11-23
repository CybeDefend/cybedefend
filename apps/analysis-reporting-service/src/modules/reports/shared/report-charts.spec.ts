import {
  REPORT_CHARTS_CSS,
  donutChart,
  horizontalBars,
  stackedBar,
} from './report-charts';

const SEGMENTS = [
  { label: 'Critical', value: 31, color: '#d92d20' },
  { label: 'High', value: 168, color: '#f97316' },
  { label: 'Medium', value: 0, color: '#eab308' },
  { label: 'Low', value: 24, color: '#3b82f6' },
];

describe('report-charts', () => {
  describe('donutChart', () => {
    it('renders static SVG (no script), so it shows in the sandboxed preview and needs no wait in Puppeteer', () => {
      const html = donutChart(SEGMENTS);
      expect(html).toContain('<svg');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<canvas');
    });

    it('draws one arc per non-empty segment, sized by its share', () => {
      const html = donutChart(SEGMENTS);
      const arcs = html.match(/<circle[^>]*stroke-dasharray="[^"]+"/g) ?? [];
      expect(arcs).toHaveLength(3);
      // 168 / 223 of the circumference, the largest arc
      const lengths = arcs.map((a) =>
        Number(/stroke-dasharray="([\d.]+)/.exec(a)[1]),
      );
      expect(Math.max(...lengths)).toBeCloseTo(
        (168 / 223) * 2 * Math.PI * 42,
        0,
      );
    });

    it('prints the total in the centre and a legend with values and percentages', () => {
      const html = donutChart(SEGMENTS, { centerLabel: 'Findings' });
      expect(html).toContain('>223<');
      expect(html).toContain('Findings');
      expect(html).toMatch(/Critical[\s\S]*31[\s\S]*14%/);
      expect(html).toMatch(/Medium[\s\S]*0/);
    });

    it('shows <1% for a small non-zero share instead of 0%', () => {
      const html = donutChart([
        { label: 'Permissive', value: 1164, color: '#000' },
        { label: 'Weak copyleft', value: 3, color: '#111' },
      ]);
      expect(html).toMatch(/Weak copyleft[\s\S]*?&lt;1%/);
    });

    // Shares rounded one by one can add up to 101%; equal values never read
    // two different shares (1 of 13 and 1 of 13: never 8% and 7%).
    it('rounds the shares so they never add up to more than 100%', () => {
      const html = donutChart([
        { label: 'Text generation', value: 11, color: '#000' },
        { label: 'Embeddings', value: 1, color: '#111' },
        { label: 'Unspecified', value: 1, color: '#222' },
      ]);
      const shares = [...html.matchAll(/legend-pct">(\d+)%/g)].map((m) =>
        Number(m[1]),
      );
      expect(shares).toEqual([84, 8, 8]);
      const thirds = donutChart(
        [1, 1, 1].map((value, i) => ({ label: `x${i}`, value, color: '#000' })),
      );
      expect(
        [...thirds.matchAll(/legend-pct">(\d+)%/g)].map((m) => m[1]),
      ).toEqual(['33', '33', '33']);
    });

    it('sets the legend figures and the centre caption at a readable contrast', () => {
      expect(REPORT_CHARTS_CSS).not.toContain('#8a8494');
      expect(REPORT_CHARTS_CSS).toMatch(/\.legend-pct \{[^}]*color: #736c7f/);
      // 8 units with letter spacing let "COMPONENTS" touch the ring
      expect(REPORT_CHARTS_CSS).toMatch(
        /\.donut-caption \{[^}]*font-size: 7\.5px;[^}]*fill: #736c7f;[^}]*letter-spacing: 0\.1px/,
      );
    });

    it('shows an empty ring when every value is zero', () => {
      const html = donutChart(SEGMENTS.map((s) => ({ ...s, value: 0 })));
      expect(html).not.toMatch(/stroke-dasharray/);
      expect(html).toContain('>0<');
    });

    it('escapes labels', () => {
      const html = donutChart([{ label: '<b>x</b>', value: 1, color: '#000' }]);
      expect(html).not.toContain('<b>x</b>');
      expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    });
  });

  describe('number formatting', () => {
    it('groups thousands in the donut total, the legend and the bars', () => {
      const d = donutChart([{ label: 'A', value: 1176, color: '#000' }]);
      expect(d).toContain('>1,176<');
      const b = horizontalBars([{ label: 'A', value: 12345, color: '#000' }]);
      expect(b).toContain('>12,345<');
    });

    it('mutes a zero in the legend', () => {
      const d = donutChart([
        { label: 'A', value: 3, color: '#000' },
        { label: 'B', value: 0, color: '#111' },
      ]);
      expect(d).toMatch(/<li class="is-zero">[^]*?B/);
    });

    it('greys the dot of a zero entry and keeps a tiny share visible as an arc', () => {
      const d = donutChart([
        { label: 'A', value: 895, color: '#000' },
        { label: 'B', value: 2, color: '#111' },
        { label: 'C', value: 0, color: '#222' },
      ]);
      const arcs = d.match(/stroke-dasharray="([\d.]+)/g) ?? [];
      const smallest = Math.min(...arcs.map((a) => Number(a.split('"')[1])));
      expect(smallest).toBeGreaterThanOrEqual(1.5);
      expect(d).toMatch(
        /<li class="is-zero"><span class="legend-dot" style="background:#d9d4e0;">/,
      );
    });

    it('shows a mono identifier before a bar label', () => {
      const b = horizontalBars([
        {
          id: 'CWE-400',
          label: 'Resource exhaustion',
          value: 2,
          color: '#000',
        },
      ]);
      expect(b).toContain('<span class="hbar-id">CWE-400</span>');
      expect(b).toContain('Resource exhaustion');
    });
  });

  describe('horizontalBars', () => {
    it('lets the caller widen the label column for plain-language labels', () => {
      const html = horizontalBars(
        [{ label: 'Cross-site scripting', value: 3, color: '#000' }],
        {
          labelWidth: '132px',
        },
      );
      expect(html).toContain('style="width: 132px;"');
    });

    it('renders one bar per item, width relative to the largest value', () => {
      const html = horizontalBars([
        { label: 'SCA', value: 280, color: '#2563eb' },
        { label: 'SAST', value: 70, color: '#4f46e5' },
      ]);
      expect(html).toMatch(/SCA[\s\S]*width:\s*100%/);
      expect(html).toMatch(/SAST[\s\S]*width:\s*25%/);
      expect(html).toContain('>280<');
    });

    it('keeps a zero-value row visible with an empty track', () => {
      const html = horizontalBars([
        { label: 'Secrets', value: 0, color: '#000' },
        { label: 'SCA', value: 10, color: '#000' },
      ]);
      expect(html).toMatch(/Secrets[\s\S]*width:\s*0%/);
    });
  });

  describe('stackedBar', () => {
    it('renders proportional segments and skips empty ones', () => {
      const html = stackedBar(SEGMENTS);
      const segments = html.match(/class="stack-seg"/g) ?? [];
      expect(segments).toHaveLength(3);
      expect(html).toMatch(/width:\s*75\.3\d*%/);
    });
  });
});

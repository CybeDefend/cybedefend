import * as handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The weekly/monthly overview badges rendered invisible (white on white): the
 * partial did `background:#{{color}}` while `severityBadges()` already returns a
 * hash-prefixed color (`#D32F2F`), producing an invalid `##D32F2F`. This asserts
 * a single, valid hex background per badge.
 */
const OVERVIEW = join(
  __dirname,
  'templates/reports/partials/reportOverview.hbs',
);

function render(ctx: Record<string, unknown>): string {
  const hb = handlebars.create();
  return hb.compile(readFileSync(OVERVIEW, 'utf8'))(ctx);
}

describe('reportOverview severity badges', () => {
  it('renders a valid single-# background color for each severity badge', () => {
    const html = render({
      totalVulnerabilities: 16,
      severities: [
        { label: 'Critical', count: 6, color: '#D32F2F' },
        { label: 'High', count: 3, color: '#F57C00' },
      ],
      dashboardUrl: 'https://app.example.com/',
    });

    expect(html).toContain('background:#D32F2F');
    expect(html).toContain('background:#F57C00');
    // no double-hash (invalid CSS → invisible badge)
    expect(html).not.toContain('##');
  });
});

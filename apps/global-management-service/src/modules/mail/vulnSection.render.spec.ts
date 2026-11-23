import * as handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Real Handlebars render of the vulnerability section partial: the mails are
 * in English, so the empty state is too.
 */
const PARTIAL = join(__dirname, 'templates/partials/vulnSection.hbs');

function render(context: Record<string, unknown>): string {
  const hb = handlebars.create();
  return hb.compile(readFileSync(PARTIAL, 'utf8'))(context);
}

describe('mail vulnerability section partial', () => {
  it('says in English that no vulnerability is listed when the list is empty', () => {
    const html = render({ title: 'Critical', items: [] });
    expect(html).toContain('No vulnerabilities listed.');
    expect(html).not.toMatch(/[éèàçêù]/);
  });
});

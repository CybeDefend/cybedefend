import * as handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Real Handlebars render of the transactional email footer partial. It used
 * to carry three social icons (X, LinkedIn, YouTube — shown as their alt text
 * "X / In / Yt" by clients that block remote images) and a
 * "Visit Us | Privacy Policy | Terms of Use" menu whose links were all empty
 * (`href=""`). Only the copyright line stays.
 */
const FOOTER = join(__dirname, 'templates/partials/footer.hbs');

function render(): string {
  const hb = handlebars.create();
  return hb.compile(readFileSync(FOOTER, 'utf8'))({});
}

describe('mail footer partial', () => {
  it('keeps the copyright line', () => {
    const html = render();
    expect(html).toContain('CybeDefend ©');
    expect(html).toContain('All Rights Reserved.');
  });

  it('no longer renders the social icons row (X / In / Yt)', () => {
    const html = render();
    expect(html).not.toContain('es-social');
    expect(html).not.toContain('social-icons');
    expect(html).not.toMatch(/alt="(X|In|Yt)"/);
  });

  it('no longer renders the Visit Us / Privacy Policy / Terms of Use menu', () => {
    const html = render();
    expect(html).not.toContain('es-menu');
    expect(html).not.toContain('Visit Us');
    expect(html).not.toContain('Privacy Policy');
    expect(html).not.toContain('Terms of Use');
    expect(html).not.toContain('href=""');
  });
});

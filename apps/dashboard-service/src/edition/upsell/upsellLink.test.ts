import { describe, expect, it } from 'vitest';
import { upsellLink } from './upsellLink';

describe('upsellLink', () => {
  it('points at the public site, tagged with the slot that shows it', () => {
    expect(upsellLink('upsell-cloud')).toBe(
      'https://cybedefend.com?utm_source=community&utm_medium=app&utm_campaign=upsell-cloud',
    );
  });

  it('opens the pricing page on its Open Source section, the fragment after the tags', () => {
    expect(upsellLink('upsell-ai-analysis', '/pricing')).toBe(
      'https://cybedefend.com/pricing?utm_source=community&utm_medium=app&utm_campaign=upsell-ai-analysis#open-source',
    );
  });

  it('appends any other page of the site before the tags, with no fragment', () => {
    expect(upsellLink('get-started-private-cloud', '/contact')).toBe(
      'https://cybedefend.com/contact?utm_source=community&utm_medium=app&utm_campaign=get-started-private-cloud',
    );
  });
});

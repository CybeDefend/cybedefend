import { webhookIgnoredLabel } from './push-scan-product';

/** The one `WEBHOOK_IGNORED_*` word each reason logs, GitHub and GitLab alike. */
describe('webhookIgnoredLabel', () => {
  it('labels the community reason', () => {
    expect(webhookIgnoredLabel('community_edition')).toBe('COMMUNITY_EDITION');
  });

  it.each([
    ['writes_blocked', 'WRITES_BLOCKED'],
    ['no_product', 'NO_PRODUCT'],
    ['products_unknown', 'PRODUCTS_UNKNOWN'],
    ['trial_scans_exhausted', 'TRIAL_SCANS_EXHAUSTED'],
  ] as const)('%s → %s', (reason, label) => {
    expect(webhookIgnoredLabel(reason)).toBe(label);
  });
});

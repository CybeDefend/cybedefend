import { pushProjectSettings } from './project-settings.utils';

/**
 * The settings a push reads from the project. Whether the project is an
 * AppSec project is the edition's reading of the project (the entitlements
 * port), handed in: the core reads no product mark itself.
 */
describe('pushProjectSettings', () => {
  const project = {
    scanOnCommitEnabled: true,
    sastEnabled: true,
    iacEnabled: false,
    scaEnabled: true,
    appsecEnabled: false,
  };

  it('carries the AppSec mark it is given', () => {
    expect(pushProjectSettings(project, true).appsecProject).toBe(true);
  });

  it('leaves the mark out when the edition gives none, whatever the row says', () => {
    expect(pushProjectSettings(project, undefined)).not.toHaveProperty(
      'appsecProject',
    );
  });
});

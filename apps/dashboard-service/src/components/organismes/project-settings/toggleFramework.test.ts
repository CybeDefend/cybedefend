// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toggleFramework } from './toggleFramework';

// The compliance checkboxes show five frameworks. A project may hold
// another value (set through the API, or a framework the backend knows and
// this list does not): a click on one box must never drop it, since the
// frameworks decide which compliance rules agents are served.

const OPTIONS = ['SOC2', 'HIPAA', 'PCI_DSS', 'GDPR', 'ISO27001'];

describe('toggleFramework', () => {
  it('adds a framework in the order of the options', () => {
    expect(toggleFramework(['GDPR'], OPTIONS, 'SOC2', true)).toEqual(['SOC2', 'GDPR']);
  });

  it('removes a framework', () => {
    expect(toggleFramework(['SOC2', 'GDPR'], OPTIONS, 'SOC2', false)).toEqual(['GDPR']);
  });

  it('keeps a stored value that is not among the options', () => {
    expect(toggleFramework(['NIST_CSF', 'GDPR'], OPTIONS, 'SOC2', true)).toEqual(['NIST_CSF', 'SOC2', 'GDPR']);
    expect(toggleFramework(['NIST_CSF', 'GDPR'], OPTIONS, 'GDPR', false)).toEqual(['NIST_CSF']);
  });
});

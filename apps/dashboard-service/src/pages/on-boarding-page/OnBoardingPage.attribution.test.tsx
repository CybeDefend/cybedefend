import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOrgCreatePayload } from './OnBoardingPage';

// The marketing captures now reach the page through the edition extension
// (`ACTIVE_EXTENSIONS.marketing`); the extension's own storage reads are
// tested with it. Here the extension is a stub.
const marketing = vi.hoisted(() => ({
  present: true,
  readOrgCreateExtras: vi.fn((): Record<string, unknown> => ({})),
}));

vi.mock('@/edition/active', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/edition/active')>();
  return {
    ...actual,
    ACTIVE_EXTENSIONS: {
      ...actual.ACTIVE_EXTENSIONS,
      get marketing() {
        return marketing.present ? marketing : null;
      },
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn(),
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('react-toastify', async () => {
  const actual = await vi.importActual('react-toastify');
  return {
    ...actual,
    toast: { success: vi.fn(), error: vi.fn() },
  };
});

vi.mock('../../server/services/organizationService', async () => {
  const actual = await vi.importActual('../../server/services/organizationService');
  return {
    ...actual,
    createOrganization: vi.fn(),
  };
});

vi.mock('@/server/hooks/useOnboardingProgress', async () => {
  const actual = await vi.importActual('@/server/hooks/useOnboardingProgress');
  return {
    ...actual,
    useOnboardingProgress: () => ({ step: 1, setStep: vi.fn() }),
  };
});

vi.mock('react-redux', async () => {
  const actual = await vi.importActual('react-redux');
  return {
    ...actual,
    useSelector: vi.fn(),
  };
});

describe('buildOrgCreatePayload', () => {
  beforeEach(() => {
    marketing.present = true;
    marketing.readOrgCreateExtras.mockReset().mockReturnValue({});
  });

  it('includes the captured attribution + selected hdyhau', () => {
    marketing.readOrgCreateExtras.mockReturnValue({
      attribution: { first: { source: 'meta' }, last: { source: 'google' } },
    });
    const payload = buildOrgCreatePayload(
      { name: 'Acme', industry: 'software', country: 'FR', customerType: 'company', companyName: 'Acme' },
      'advertising'
    );
    expect(payload.hdyhau).toBe('advertising');
    expect(payload.attribution?.first.source).toBe('meta');
  });

  it('omits attribution when nothing was captured', () => {
    const payload = buildOrgCreatePayload(
      { name: 'Acme', industry: 'software', country: 'FR', customerType: 'company', companyName: 'Acme' },
      undefined,
    );
    expect(payload.attribution).toBeUndefined();
    expect(payload.hdyhau).toBeUndefined();
  });

  it('includes intendedPlan when captured from the pricing CTA', () => {
    marketing.readOrgCreateExtras.mockReturnValue({ intendedPlan: 'scale' });
    const payload = buildOrgCreatePayload(
      { name: 'Acme', industry: 'software', country: 'FR', customerType: 'company', companyName: 'Acme' },
      undefined,
    );
    expect(payload.intendedPlan).toBe('scale');
  });

  it('omits intendedPlan when none was captured', () => {
    const payload = buildOrgCreatePayload(
      { name: 'Acme', industry: 'software', country: 'FR', customerType: 'company', companyName: 'Acme' },
      undefined,
    );
    expect(payload.intendedPlan).toBeUndefined();
  });

  it('includes leadId when the invite link was captured', () => {
    marketing.readOrgCreateExtras.mockReturnValue({ leadId: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f' });
    const payload = buildOrgCreatePayload({ name: 'Acme' }, undefined);
    expect(payload.leadId).toBe('6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f');
  });

  it('omits leadId when none was captured', () => {
    const payload = buildOrgCreatePayload({ name: 'Acme' }, undefined);
    expect(payload.leadId).toBeUndefined();
  });

  it('attaches no marketing extra without the extension (the Community Edition)', () => {
    marketing.present = false;
    const payload = buildOrgCreatePayload({ name: 'Acme' }, 'advertising');
    expect(payload.attribution).toBeUndefined();
    expect(payload.intendedPlan).toBeUndefined();
    expect(payload.leadId).toBeUndefined();
    expect(payload.hdyhau).toBe('advertising');
  });
});

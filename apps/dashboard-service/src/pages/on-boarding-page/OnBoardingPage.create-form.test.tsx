import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import OnboardingPage from './OnBoardingPage';
import { createOrganization } from '../../server/services/organizationService';
import { toast } from 'react-toastify';

// ---------------------------------------------------------------------------
// Signup slimming — the org-creation step must ask for a NAME and nothing else.
//
// Creating an organization needs no billing profile (billing is a closed
// extension). What remains is the organization name (required) and
// the optional "How did you hear about us?" question.
//
// `@/test/i18n-mock` resolves keys against the REAL `en` locale, so asserting
// on visible English text also proves the key exists in the bundle.
// ---------------------------------------------------------------------------

const mockState = {
  user: {
    id: 'user-1',
    email: 'dev@example.com',
    isProfileLoaded: true,
    myOrganizations: [],
  },
};

vi.mock('react-redux', () => ({
  useSelector: (fn: (s: any) => any) => fn(mockState),
  useDispatch: () => vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

vi.mock('react-toastify', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('../../server/services/organizationService', () => ({
  createOrganization: vi.fn(),
}));

vi.mock('@/server/hooks/useOnboardingProgress', () => ({
  useOnboardingProgress: () => ({ complete: vi.fn() }),
}));


/** Render the page and walk into the « create » branch of the chooser. */
const renderCreateForm = () => {
  render(<OnboardingPage />);
  fireEvent.click(screen.getByTestId('chooser-create-card'));
  return screen.getByTestId('onboarding-create-form') as HTMLFormElement;
};

// Every label that must no longer appear anywhere in the create form. Checked
// against the form's text rather than by role, because the removed Country
// field was a bare <label> + react-select with no input association at all.
const REMOVED_FIELD_LABELS = [
  'Industry',
  'Customer Type',
  'First Name',
  'Last Name',
  'Company Name',
  'VAT Number',
  'Country',
  'Billing Address Line 1',
  'Billing Address Line 2',
  'City',
  'Postal Code',
  'Region',
];

describe('OnBoardingPage — slimmed organization creation form', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(createOrganization).mockReset();
    vi.mocked(createOrganization).mockResolvedValue({} as never);
    vi.mocked(toast.error).mockReset();
  });

  it('renders the organization name input and the hdyhau select', () => {
    renderCreateForm();

    const nameInput = screen.getByLabelText('Organization Name') as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    expect(nameInput.getAttribute('name')).toBe('name');
    expect(nameInput.required).toBe(true);
    expect(nameInput.getAttribute('maxlength')).toBe('255');

    // Optional question — the label carries the "(optional)" suffix and the
    // collapsed select shows the shared default placeholder.
    const hdyhau = screen.getByLabelText('How did you hear about us? (optional)');
    expect(hdyhau).toBeTruthy();
    expect(hdyhau.textContent).toContain('Select an option');
  });

  it('renders none of the billing-profile fields', () => {
    const form = renderCreateForm();

    for (const label of REMOVED_FIELD_LABELS) {
      expect(form.textContent).not.toContain(label);
    }
    // Structural, not just textual: the name is the only text field left, and
    // the hdyhau select the only other control besides submit.
    expect(within(form).getAllByRole('textbox')).toHaveLength(1);
    expect(form.querySelectorAll('input, textarea, select')).toHaveLength(1);
  });

  it('submits with only a name and sends no billing keys', async () => {
    const form = renderCreateForm();

    fireEvent.change(screen.getByLabelText('Organization Name'), {
      target: { name: 'name', value: 'Acme' },
    });
    fireEvent.submit(form);

    await vi.waitFor(() => expect(createOrganization).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(createOrganization).mock.calls[0][0] as unknown as Record<
      string,
      unknown
    >;
    expect(payload.name).toBe('Acme');
    for (const key of [
      'industry',
      'country',
      'customerType',
      'firstName',
      'lastName',
      'companyName',
      'vatNumber',
      'billingAddressLine1',
      'billingAddressLine2',
      'billingCity',
      'billingPostalCode',
      'billingRegion',
    ]) {
      expect(Object.prototype.hasOwnProperty.call(payload, key)).toBe(false);
    }
  });

  it('still refuses an empty name', async () => {
    const form = renderCreateForm();

    fireEvent.submit(form);

    expect(toast.error).toHaveBeenCalledWith('Please fill in all required fields.');
    expect(createOrganization).not.toHaveBeenCalled();
  });

  it('drops the chooser subtitle once a branch is picked', () => {
    render(<OnboardingPage />);

    const subtitle = "Create a new organization, or join one you've been invited to.";
    expect(document.body.textContent).toContain(subtitle);

    // It is an instruction for a decision the user has now made; leaving it
    // above the form contradicts the screen they are looking at.
    fireEvent.click(screen.getByTestId('chooser-create-card'));
    expect(document.body.textContent).not.toContain(subtitle);

    // The logo and page title stay: they are the page's identity, not a prompt.
    expect(screen.getByText('Get started with CybeDefend')).toBeTruthy();
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { translate } from '@/test/i18n-mock';
import { AUTH_REFUSAL_KEYS } from '@/pages/community-auth/authRefusals';
import type { PersonalAccessTokenView } from '../../../server/interfaces/PersonalAccessToken';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const { toast, patService, state } = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  patService: {
    createToken: vi.fn(),
    revokeToken: vi.fn(),
    updatePersonalAccessTokenName: vi.fn(),
  },
  state: { edition: 'cloud' as 'cloud' | 'community', listFailed: false },
}));

vi.mock('@/edition/edition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/edition/edition')>()),
  get EDITION() {
    return state.edition;
  },
}));
vi.mock('react-toastify', () => ({ toast }));
vi.mock('../../../server/services/patService', () => ({
  ...patService,
  get canRenameTokens() {
    return state.edition !== 'community';
  },
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      user: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', picture: '' },
      organization: { selectedOrganization: { subscription: { featuresDisabled: '' } } },
    }),
}));
vi.mock('@/edition/auth/useAuth', () => ({
  useAuth: () => ({ loading: false }),
}));
const TOKEN: PersonalAccessTokenView = {
  id: '6f9a1c2e-0000-4000-8000-000000000001',
  name: 'ci',
  lastFour: null,
  createdAt: null,
  lastUsedAt: null,
  expiresAt: null,
};
vi.mock('../../../server/hooks/usePersonalAccessTokens', () => ({
  default: () => ({
    tokens: [TOKEN],
    usage: { current: 1, max: 10 },
    loading: false,
    error: state.listFailed ? 'a sentence from the server' : null,
    failed: state.listFailed,
    refresh: vi.fn(),
  }),
}));

vi.mock('../../../components/molecules/wrapper/ProfileWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/molecules/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./PatTable', () => ({
  default: ({
    tokens,
    error,
    onAdd,
    onDelete,
    onRename,
  }: {
    tokens: PersonalAccessTokenView[];
    error: string | null;
    onAdd: () => void;
    onDelete: (token: PersonalAccessTokenView) => void;
    onRename?: (token: PersonalAccessTokenView) => void;
  }) => (
    <div>
      {error && <p data-testid="table-error">{error}</p>}
      <button onClick={onAdd}>open create</button>
      <button onClick={() => onDelete(tokens[0])}>open delete</button>
      {onRename && <button onClick={() => onRename(tokens[0])}>open rename</button>}
    </div>
  ),
}));
vi.mock('./PatUsageGuide', () => ({ default: () => null }));
vi.mock('./DisplayPatModal', () => ({
  default: ({ tokenValue, onClose, onCopy }: { tokenValue: string; onClose: () => void; onCopy: (value: string) => void }) => (
    <div>
      <output data-testid="shown-once">{tokenValue}</output>
      <button onClick={onClose}>close display</button>
      <button onClick={() => onCopy(tokenValue)}>copy display</button>
    </div>
  ),
}));
vi.mock('./DeletePatModal', () => ({
  default: ({ onConfirm }: { onConfirm: () => void }) => <button onClick={onConfirm}>confirm delete</button>,
}));
vi.mock('./CreatePatModal', () => ({
  default: ({ onCreate }: { onCreate: (name: string, expiresAt: number) => void }) => (
    <>
      <button onClick={() => onCreate('test', 0)}>submit create</button>
      <button onClick={() => onCreate('test', Date.UTC(2030, 0, 1))}>submit create expiring</button>
    </>
  ),
}));
vi.mock('./RenamePatModal', () => ({
  default: ({ onRename }: { onRename: (newName: string) => void }) => (
    <button onClick={() => onRename('test')}>submit rename</button>
  ),
}));

import PersonalAccessTokensPage from './PersonalAccessTokensPage';

/** What gatewayAPI (axios) rejects with on a non-2xx answer. */
const httpError = (status: number, data?: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data },
  });

const NAME_TAKEN =
  'A personal access token with this name already exists. Choose a different name.';
const SERVER_TEXT = 'a sentence from the server';

const SECRET = `cdp_${'B'.repeat(43)}`;

describe('PersonalAccessTokensPage — name already taken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.edition = 'cloud';
    state.listFailed = false;
  });

  it('says so when a creation is refused with 409', async () => {
    patService.createToken.mockRejectedValue(httpError(409));
    render(<PersonalAccessTokensPage />);

    fireEvent.click(screen.getByText('open create'));
    fireEvent.click(screen.getByText('submit create'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NAME_TAKEN));
  });

  it('says so when a rename is refused with 409', async () => {
    patService.updatePersonalAccessTokenName.mockRejectedValue(httpError(409));
    render(<PersonalAccessTokensPage />);

    fireEvent.click(screen.getByText('open rename'));
    fireEvent.click(screen.getByText('submit rename'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NAME_TAKEN));
  });

  it('keeps the generic message for any other creation failure', async () => {
    patService.createToken.mockRejectedValue(httpError(500));
    render(<PersonalAccessTokensPage />);

    fireEvent.click(screen.getByText('open create'));
    fireEvent.click(screen.getByText('submit create'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Failed to create personal access token'),
    );
  });

  it('the cloud still says the cap is reached on a 429', async () => {
    patService.createToken.mockRejectedValue(httpError(429));
    render(<PersonalAccessTokensPage />);
    fireEvent.click(screen.getByText('open create'));
    fireEvent.click(screen.getByText('submit create'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(translate('pages.patPage.toast.capReached')));
  });

  it('the cloud sends the expiry as an ISO date and shows the value once', async () => {
    patService.createToken.mockResolvedValue({ view: TOKEN, token: 'pat_value' });
    render(<PersonalAccessTokensPage />);
    fireEvent.click(screen.getByText('open create'));
    fireEvent.click(screen.getByText('submit create expiring'));
    await waitFor(() => expect(screen.getByTestId('shown-once')).toHaveTextContent('pat_value'));
    expect(patService.createToken).toHaveBeenCalledWith('test', '2030-01-01T00:00:00.000Z');
  });

  it('the cloud keeps the list error it had', () => {
    state.listFailed = true;
    render(<PersonalAccessTokensPage />);
    expect(screen.getByTestId('table-error')).toHaveTextContent(SERVER_TEXT);
  });
});

describe('PersonalAccessTokensPage — Community Edition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.edition = 'community';
    state.listFailed = false;
  });

  it('the rename action is absent in community', () => {
    render(<PersonalAccessTokensPage />);
    expect(screen.queryByText('open rename')).not.toBeInTheDocument();
  });

  it.each(['PAT_NAME_TAKEN', 'PAT_LIMIT_REACHED'] as const)(
    'PAT_NAME_TAKEN and PAT_LIMIT_REACHED show their sentences, never the server\'s message (%s)',
    async (code) => {
      patService.createToken.mockRejectedValue(httpError(409, { code, message: SERVER_TEXT }));
      render(<PersonalAccessTokensPage />);
      fireEvent.click(screen.getByText('open create'));
      fireEvent.click(screen.getByText('submit create'));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(translate(AUTH_REFUSAL_KEYS[code])));
      expect(JSON.stringify(toast.error.mock.calls)).not.toContain(SERVER_TEXT);
    },
  );

  it.each(['PAT_NAME_INVALID', 'PAT_EXPIRY_INVALID', 'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT'] as const)(
    '%s shows its sentence',
    async (code) => {
      patService.createToken.mockRejectedValue(httpError(code === 'PAT_FORBIDDEN_FOR_PAT_MANAGEMENT' ? 403 : 400, { code }));
      render(<PersonalAccessTokensPage />);
      fireEvent.click(screen.getByText('open create'));
      fireEvent.click(screen.getByText('submit create'));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(translate(AUTH_REFUSAL_KEYS[code])));
    },
  );

  it('an answer outside the list keeps the generic creation sentence', async () => {
    patService.createToken.mockRejectedValue(httpError(400, { message: [SERVER_TEXT] }));
    render(<PersonalAccessTokensPage />);
    fireEvent.click(screen.getByText('open create'));
    fireEvent.click(screen.getByText('submit create'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to create personal access token'));
  });

  it('a revoke refused with PAT_NOT_FOUND shows its sentence', async () => {
    patService.revokeToken.mockRejectedValue(httpError(404, { code: 'PAT_NOT_FOUND', message: SERVER_TEXT }));
    render(<PersonalAccessTokensPage />);
    fireEvent.click(screen.getByText('open delete'));
    fireEvent.click(screen.getByText('confirm delete'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(translate(AUTH_REFUSAL_KEYS.PAT_NOT_FOUND)));
    expect(patService.revokeToken).toHaveBeenCalledWith(TOKEN);
  });

  it('a creation shows the cdp_ token once', async () => {
    patService.createToken.mockResolvedValue({ view: TOKEN, token: SECRET });
    render(<PersonalAccessTokensPage />);
    fireEvent.click(screen.getByText('open create'));
    fireEvent.click(screen.getByText('submit create'));
    await waitFor(() => expect(screen.getByTestId('shown-once')).toHaveTextContent(SECRET));
    expect(patService.createToken).toHaveBeenCalledWith('test', undefined);

    fireEvent.click(screen.getByText('close display'));
    await waitFor(() => expect(screen.queryByTestId('shown-once')).not.toBeInTheDocument());
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('once copied, the cdp_ token is no longer rendered anywhere', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    patService.createToken.mockResolvedValue({ view: TOKEN, token: SECRET });
    render(<PersonalAccessTokensPage />);
    fireEvent.click(screen.getByText('open create'));
    fireEvent.click(screen.getByText('submit create'));
    await waitFor(() => expect(screen.getByTestId('shown-once')).toHaveTextContent(SECRET));

    fireEvent.click(screen.getByText('copy display'));
    await waitFor(() => expect(screen.queryByTestId('shown-once')).not.toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('a list failure shows a fixed sentence, never the server\'s text', () => {
    state.listFailed = true;
    render(<PersonalAccessTokensPage />);
    expect(screen.getByTestId('table-error')).toHaveTextContent(translate('components.patTable.loadError'));
    expect(screen.getByTestId('table-error')).not.toHaveTextContent(SERVER_TEXT);
  });
});

describe('PatUsageGuide', () => {
  beforeEach(() => {
    state.edition = 'community';
  });
  afterEach(cleanup);

  async function renderGuide() {
    const { default: PatUsageGuide } = await vi.importActual<typeof import('./PatUsageGuide')>('./PatUsageGuide');
    render(<PatUsageGuide />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(translate('components.patUsageGuide.title')) }));
  }

  it('in community the guide shows `Authorization: Bearer cdp_…` and no token exchange', async () => {
    await renderGuide();
    expect(document.body.textContent).toContain('Authorization: Bearer cdp_');
    expect(document.body.textContent).not.toContain('token-exchange');
    expect(document.body.textContent).not.toContain('/oidc/token');
    expect(document.body.textContent).not.toContain('client-apps');
  }, 30_000);

  it('the cloud guide keeps its token exchange', async () => {
    state.edition = 'cloud';
    await renderGuide();
    expect(document.body.textContent).toContain('token-exchange');
  }, 30_000);
});

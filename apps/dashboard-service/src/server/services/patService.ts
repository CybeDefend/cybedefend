import gatewayAPI from '../api/gatewayAPI';
import { EDITION } from '@/edition/edition';
import type {
  ListPersonalAccessTokensResponse,
  CreatePersonalAccessTokenRequest,
  CreatePersonalAccessTokenResponse,
  UpdatePersonalAccessTokenNameResponse,
  PersonalAccessToken,
  PersonalAccessTokenView,
  CreatedToken,
  PersonalAccessTokenList,
} from '../interfaces/PersonalAccessToken';

/**
 * Personal access tokens in both editions.
 *
 * - Cloud: today's `/user/personal-access-tokens` routes, a token known by
 *   its name (`id = name`).
 * - Community: the gateway's `/me/personal-access-tokens`,
 *   a token known by its id, no rename route.
 *
 * The secret comes back once, from {@link createToken}; this module never
 * keeps it, logs it or puts it in a URL.
 */

const COMMUNITY_PATH = '/me/personal-access-tokens';

/** The per-user cap of active tokens, the same in both editions (global-management). */
const MAX_ACTIVE_TOKENS = 10;

const isCommunity = (): boolean => EDITION === 'community';

/** The cloud has a rename route; the Community Edition has none. */
export const canRenameTokens: boolean = !isCommunity();

/** Epoch ms (a number, or the string the gRPC int64 arrives as) → ISO 8601; 0 or unreadable → null. */
function msToIso(ms: unknown): string | null {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

/** An ISO 8601 date the gateway sent, kept as is; anything else → null. */
function isoOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value)) ? value : null;
}

const stringOr = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

function cloudView(token: Pick<PersonalAccessToken, 'name' | 'createdAt' | 'expiresAt'>): PersonalAccessTokenView {
  return {
    id: token.name,
    name: token.name,
    lastFour: null,
    createdAt: msToIso(token.createdAt),
    lastUsedAt: null,
    expiresAt: msToIso(token.expiresAt),
  };
}

/** Only the fields of the contract are read: a list item never carries the secret. */
function communityView(raw: unknown): PersonalAccessTokenView {
  const item = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    id: stringOr(item.id, ''),
    name: stringOr(item.name, ''),
    lastFour: typeof item.lastFour === 'string' && item.lastFour !== '' ? item.lastFour : null,
    createdAt: isoOrNull(item.createdAt),
    lastUsedAt: isoOrNull(item.lastUsedAt),
    expiresAt: isoOrNull(item.expiresAt),
  };
}

const isActive = (view: PersonalAccessTokenView, now: number): boolean =>
  view.expiresAt === null || Date.parse(view.expiresAt) > now;

/** The list and the count against the cap (the cloud's own `usage`, else the active tokens). */
export async function fetchTokenList(): Promise<PersonalAccessTokenList> {
  if (isCommunity()) {
    const { data } = await gatewayAPI.get<{ tokens?: unknown }>(COMMUNITY_PATH);
    const tokens = (Array.isArray(data?.tokens) ? data.tokens : []).map(communityView);
    const now = Date.now();
    return { tokens, usage: { current: tokens.filter((v) => isActive(v, now)).length, max: MAX_ACTIVE_TOKENS } };
  }
  const { data } = await gatewayAPI.get<ListPersonalAccessTokensResponse>('/user/personal-access-tokens');
  const tokens = (data?.tokens ?? []).map(cloudView);
  return { tokens, usage: data?.usage };
}

export async function listTokens(): Promise<PersonalAccessTokenView[]> {
  return (await fetchTokenList()).tokens;
}

/**
 * Creates a token; `expiresAt` is ISO 8601, absent for « never ». The secret is in `token`, shown once.
 * In the Community Edition `currentPassword` (the account's password) is required: a token outlives
 * every session, so the server asks for it. It is sent in the body only, never kept or logged.
 */
export async function createToken(name: string, expiresAt?: string, currentPassword?: string): Promise<CreatedToken> {
  if (isCommunity()) {
    const body: { name: string; expiresAt?: string; currentPassword: string } = {
      name,
      currentPassword: currentPassword ?? '',
    };
    if (expiresAt) body.expiresAt = expiresAt;
    const { data } = await gatewayAPI.post<Record<string, unknown>>(COMMUNITY_PATH, body);
    const token = data?.token;
    if (typeof token !== 'string' || token === '') {
      throw new Error('PAT_CREATE_ANSWER_INVALID');
    }
    return { view: { ...communityView(data), lastUsedAt: null }, token };
  }
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const data = await createPersonalAccessToken({
    name,
    expiresAt: Number.isFinite(expiresAtMs) && expiresAtMs > 0 ? expiresAtMs : undefined,
  });
  return { view: cloudView(data), token: data.value };
}

/** Revokes a token: by id in Community, by name in the cloud. */
export async function revokeToken(view: PersonalAccessTokenView): Promise<void> {
  if (isCommunity()) {
    await gatewayAPI.delete(`${COMMUNITY_PATH}/${encodeURIComponent(view.id)}`);
    return;
  }
  await deletePersonalAccessToken(view.name);
}

/**
 * Create a new personal access token (cloud route).
 */
export const createPersonalAccessToken = async (
  data: CreatePersonalAccessTokenRequest,
): Promise<CreatePersonalAccessTokenResponse> => {
  const response = await gatewayAPI.post<CreatePersonalAccessTokenResponse>(
    '/user/personal-access-tokens',
    data,
  );
  return response.data;
};

/**
 * Delete a personal access token by name (cloud route).
 */
export const deletePersonalAccessToken = async (
  name: string,
): Promise<void> => {
  await gatewayAPI.post('/user/personal-access-tokens/delete', { name });
};

/**
 * Rename an existing personal access token (cloud only: see {@link canRenameTokens}).
 */
export const updatePersonalAccessTokenName = async (
  currentName: string,
  newName: string,
): Promise<UpdatePersonalAccessTokenNameResponse> => {
  const response =
    await gatewayAPI.patch<UpdatePersonalAccessTokenNameResponse>(
      '/user/personal-access-tokens/name',
      { currentName, newName },
    );
  return response.data;
};

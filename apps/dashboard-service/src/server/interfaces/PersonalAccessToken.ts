export interface PersonalAccessToken {
  name: string;
  /**
   * SECURITY: the list endpoint NEVER returns the
   * raw token value. This field is always an empty string for tokens
   * surfaced via list/rename, and only populated on the
   * CreatePersonalAccessTokenResponse — exactly once, right after creation.
   */
  value: string;
  /** Epoch ms */
  createdAt: number;
  /** Epoch ms, 0 = never expires */
  expiresAt: number;
}

/** Mirrors `PersonalAccessTokenUsage` in libs/protos/global-management/user.proto. */
export interface PersonalAccessTokenUsage {
  /** Active PAT count for the user */
  current: number;
  /** Hard cap (10 — see MAX_PATS_PER_USER server-side). */
  max: number;
}

export interface ListPersonalAccessTokensResponse {
  tokens: PersonalAccessToken[];
  usage?: PersonalAccessTokenUsage;
}

export interface CreatePersonalAccessTokenRequest {
  name: string;
  /** Epoch ms, 0 = never expires */
  expiresAt?: number;
}

export interface CreatePersonalAccessTokenResponse {
  name: string;
  /** Full PAT value (pat_...) — shown only once */
  value: string;
  createdAt: number;
  expiresAt: number;
}

export interface UpdatePersonalAccessTokenNameResponse {
  name: string;
  value: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * A personal access token as every screen shows it, in both editions. Dates
 * are ISO 8601, `null` for « never » or « not known ». The secret is never
 * part of it: it exists only in {@link CreatedToken}, shown once.
 *
 * - Cloud: `id` is the name (the cloud routes know a token by its name),
 *   `lastFour` and `lastUsedAt` are null.
 * - Community: the gateway's `/me/personal-access-tokens` item.
 */
export interface PersonalAccessTokenView {
  id: string;
  name: string;
  lastFour: string | null;
  createdAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** A token just created: its view, and the secret (`cdp_…` in Community), shown once and never kept. */
export interface CreatedToken {
  view: PersonalAccessTokenView;
  token: string;
}

/** The list and, when known, the count against the per-user cap. */
export interface PersonalAccessTokenList {
  tokens: PersonalAccessTokenView[];
  usage?: PersonalAccessTokenUsage;
}

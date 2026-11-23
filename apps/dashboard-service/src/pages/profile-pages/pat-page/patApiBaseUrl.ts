/**
 * The API the token guide's examples call: the build's own setting
 * (`VITE_API_BASE_URL`) first, then the edition's public API
 * (`ACTIVE_EXTENSIONS.publicApiUrl`), and without one (the Community Edition)
 * the instance itself, whose gateway is served under `/api`.
 */
export function patApiBaseUrl({
  envUrl,
  editionUrl,
  origin,
}: {
  envUrl: string | undefined;
  editionUrl: string | null;
  origin: string;
}): string {
  return envUrl || editionUrl || `${origin}/api`;
}

import { isCommunityEdition } from 'src/edition/edition';

/**
 * Whether main.ts mounts the Swagger UI and document (`/api`, `/api-json`).
 * Not in the Community edition in production: a self-hosted instance on the
 * internet would publish its whole route map to anyone. Every other case
 * (cloud, enterprise, a Community instance in development) is unchanged.
 */
export function shouldServeSwagger(nodeEnv: string | undefined): boolean {
  return !(isCommunityEdition() && nodeEnv === 'production');
}

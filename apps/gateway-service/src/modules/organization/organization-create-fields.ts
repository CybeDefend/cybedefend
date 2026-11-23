import type { OrganizationCreateRequest } from '@grpc/global-management/organization';

/** What a closed extension reads to map its own sign-up fields. */
export interface OrganizationCreateContext {
  /** The request, as Fastify hands it to the controller. */
  request: unknown;
  /** NODE_ENV: the edge headers are trusted in production only. */
  nodeEnv: string | undefined;
}

/**
 * Maps the fields a closed extension adds to POST /organization (it declares
 * them on the core body DTO itself) onto the creation request.
 */
export type OrganizationCreateExtension = (
  body: Readonly<Record<string, unknown>>,
  context: OrganizationCreateContext,
) => Partial<OrganizationCreateRequest>;

/**
 * The sign-up fields a closed product adds to POST /organization, so the core
 * names none of them. The closed side registers its mapping at instantiation
 * time (a factory provider of a closed module); the controller applies each
 * one, in registration order, over the core fields. Empty in the core alone.
 */
const extensions: OrganizationCreateExtension[] = [];

/** Idempotent: an extension is registered once. */
export function registerOrganizationCreateExtension(
  extension: OrganizationCreateExtension,
): void {
  if (!extensions.includes(extension)) extensions.push(extension);
}

/** The registered extensions, in registration order. `[]` in the core. */
export function organizationCreateExtensions(): readonly OrganizationCreateExtension[] {
  return [...extensions];
}

/** Back to empty (tests). */
export function resetOrganizationCreateExtensionsForTests(): void {
  extensions.length = 0;
}

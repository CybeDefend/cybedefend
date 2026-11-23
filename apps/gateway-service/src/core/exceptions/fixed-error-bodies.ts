import type { StandardErrorResponse } from './global-exception.filter';

/**
 * The core seam for refusal bodies that must stay fixed: the closed side
 * registers one builder per `code` at instantiation time (a factory provider
 * of a closed module), and the global filter applies it to any
 * `HttpException` whose object response carries that `code`.
 */
export type FixedErrorBody = (
  resp: Record<string, unknown>,
) => Partial<StandardErrorResponse>;

const fixedErrorBodies = new Map<string, FixedErrorBody>();

/** Idempotent: re-registering a code replaces its builder. */
export function registerFixedErrorBody(
  code: string,
  build: FixedErrorBody,
): void {
  fixedErrorBodies.set(code, build);
}

export function fixedErrorBodyFor(code: unknown): FixedErrorBody | undefined {
  return typeof code === 'string' ? fixedErrorBodies.get(code) : undefined;
}

export function resetFixedErrorBodiesForTests(): void {
  fixedErrorBodies.clear();
}

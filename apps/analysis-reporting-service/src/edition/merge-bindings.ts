import type { InjectionToken, Provider } from '@nestjs/common';

export type { InjectionToken };

/**
 * The token a provider registers under: the class itself for a class
 * provider, `.provide` for every other provider form.
 */
export function bindingToken(provider: Provider): InjectionToken {
  return typeof provider === 'function' ? provider : provider.provide;
}

function tokenName(token: InjectionToken): string {
  if (typeof token === 'string') {
    return token;
  }
  if (typeof token === 'symbol') {
    return String(token);
  }
  return token.name !== '' ? token.name : String(token);
}

function assertNoDuplicateToken(list: Provider[]): void {
  const seen = new Set<InjectionToken>();
  for (const provider of list) {
    const token = bindingToken(provider);
    if (seen.has(token)) {
      throw new Error(
        `Duplicate edition binding for token ${tokenName(token)}`,
      );
    }
    seen.add(token);
  }
}

/**
 * Merges the community bindings with the cloud (ee) ones. An override whose
 * token a base provider already carries replaces it in place; an override
 * with a new token is appended after the base, in override order. Both inputs
 * are left untouched. Two providers with the same token inside one list would
 * silently shadow each other, so they throw.
 */
export function mergeBindings(
  base: Provider[],
  overrides: Provider[],
): Provider[] {
  assertNoDuplicateToken(base);
  assertNoDuplicateToken(overrides);
  const overrideByToken = new Map<InjectionToken, Provider>();
  for (const provider of overrides) {
    overrideByToken.set(bindingToken(provider), provider);
  }
  const baseTokens = new Set<InjectionToken>();
  const result: Provider[] = base.map((provider) => {
    const token = bindingToken(provider);
    baseTokens.add(token);
    return overrideByToken.get(token) ?? provider;
  });
  for (const provider of overrides) {
    const token = bindingToken(provider);
    if (!baseTokens.has(token)) {
      result.push(provider);
    }
  }
  return result;
}

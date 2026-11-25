import type { ReactElement, ReactNode } from 'react';
import type { RouteObject } from 'react-router-dom';

/**
 * Route parameters that never reach an API path as they are, so they need no
 * id guard: a closed set (`type`), a value the page encodes as one segment
 * (`spdxId`), a value only copied into `?issue=`, which the quick view checks
 * (`issueId`), and the splat.
 */
const PARAM_EXEMPT: ReadonlySet<string> = new Set(['type', 'spdxId', 'issueId']);

/**
 * Elements that only redirect, building the target from the router's own
 * encoded pathname, or read their parameter with a shape check of their own
 * and send it in a request body: they call no API path with it.
 */
const SAFE_ELEMENTS: ReadonlySet<string> = new Set(['Navigate', 'AppSecLegacyRedirect', 'OrganizationInvitationPage']);

const nameOf = (element: ReactElement): string | undefined => {
  const type = element.type as { displayName?: string; name?: string } | string;
  return typeof type === 'string' ? type : (type.displayName ?? type.name);
};

/** Every route of a table, nested ones included. */
export const flatRoutes = (routes: readonly RouteObject[]): RouteObject[] =>
  routes.flatMap((route) => [route, ...flatRoutes(route.children ?? [])]);

/**
 * The id parameters of `path` that no guard on `element`'s single-child chain
 * checks, as `<path> (<params>)`; empty when every one is guarded or the
 * element is safe. `safeElements` adds the names of an edition's own safe
 * elements.
 */
export const missingIdGuards = (
  path: string,
  element: ReactElement | undefined,
  safeElements: readonly string[] = [],
): string[] => {
  const params = [...path.matchAll(/:([A-Za-z]+)/g)].map((match) => match[1]).filter((p) => !PARAM_EXEMPT.has(p));
  if (params.length === 0) return [];
  const guarded = new Set<string>();
  let current = element as ReactElement<{ children?: ReactNode; params?: readonly string[] }> | undefined;
  while (current) {
    const name = nameOf(current);
    if (name && (SAFE_ELEMENTS.has(name) || safeElements.includes(name))) return [];
    if (name === 'ProjectIdGuard') guarded.add('projectId');
    if (name === 'RouteIdGuard') (current.props.params ?? ['projectId']).forEach((p) => guarded.add(p));
    const child = current.props?.children;
    current =
      child && typeof child === 'object' && !Array.isArray(child)
        ? (child as ReactElement<{ children?: ReactNode; params?: readonly string[] }>)
        : undefined;
  }
  const missing = params.filter((p) => !guarded.has(p));
  return missing.length ? [`${path} (${missing.join(', ')})`] : [];
};

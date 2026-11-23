import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `/integrations/linear/callback` is registered at Linear as the OAuth redirect
 * URI of the CybeDefend app, so it never moves (like the GitHub, GitLab, Slack
 * and Jira callbacks). Rendering the whole App to prove the route exists would
 * mean standing up Logto, Redux, Permify and a dozen hooks; the declaration is
 * a static fact, read as such (same approach as `App.subscriptionRoute.test.ts`).
 */
const APP = fs.readFileSync(path.resolve(__dirname, 'App.tsx'), 'utf8');

/** The JSX between `path="<route>"` and the end of its `<Route …/>` block. */
const routeBlock = (route: string): string => {
  const start = APP.indexOf(`path="${route}"`);
  expect(start, `route ${route} is not declared in App.tsx`).toBeGreaterThan(-1);
  return APP.slice(start, APP.indexOf('/>', start));
};

describe('/integrations/linear/callback route', () => {
  it('is declared and renders the Linear callback page', () => {
    expect(routeBlock('/integrations/linear/callback')).toContain('<IntegrationLinearCallbackPage');
  });

  it('stays behind the auth wrapper, like the other OAuth callbacks', () => {
    expect(routeBlock('/integrations/linear/callback')).toContain('<ProtectedRouteWrapper>');
    expect(routeBlock('/integrations/jira/callback')).toContain('<ProtectedRouteWrapper>');
  });
});

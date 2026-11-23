import { describe, it, expect } from 'vitest';
import { cybedefendFindingUrl } from './cybedefendFindingUrl';

/**
 * external-integrations prints `cybedefendUrl` as « Open in CybeDefend » in
 * every Jira or Linear ticket it creates. It must be a page of the dashboard:
 * the AppSec finding route, which opens the results list with the drawer on
 * that finding. (Carried over from the Jira-only tracker's tests.)
 */
const ORIGIN = 'https://app.cybedefend.test';
const P = '11111111-2222-4333-8444-555555555555';

describe('cybedefendFindingUrl — the « Open in CybeDefend » link of a created ticket', () => {
  it.each(['sast', 'iac', 'cicd', 'secret', 'sca', 'container'])(
    'is the AppSec finding page of a %s finding',
    (scannerType) => {
      expect(cybedefendFindingUrl(ORIGIN, P, scannerType, 'v-1')).toBe(
        `${ORIGIN}/appsec/project/${P}/${scannerType}/issue/v-1`,
      );
    },
  );

  it('encodes each id into a single path segment', () => {
    expect(cybedefendFindingUrl(ORIGIN, 'p/1', 'sast', 'v/1?x#y')).toBe(
      `${ORIGIN}/appsec/project/p%2F1/sast/issue/v%2F1%3Fx%23y`,
    );
  });

  it('is the project overview for a scanner type that has no results page', () => {
    expect(cybedefendFindingUrl(ORIGIN, P, 'unknown', 'v-1')).toBe(`${ORIGIN}/appsec/project/${P}`);
  });
});

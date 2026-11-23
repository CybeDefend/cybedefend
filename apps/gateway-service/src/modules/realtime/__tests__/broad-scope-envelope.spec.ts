import {
  BROAD_SCOPE_PAYLOAD_TYPES,
  isBroadScopeChannel,
  toBroadScopeEnvelope,
} from '../broad-scope-envelope';
import * as publisherEventTypes from '../../../../../../libs/realtime-publisher/src/event-types';

describe('toBroadScopeEnvelope', () => {
  const scanFailed = {
    eventId: 'evt-1',
    type: 'SCAN_STATUS_CHANGED',
    timestamp: '2026-10-09T10:00:00.000Z',
    traceparent: '00-abc-def-01',
    scope: {
      organizationId: 'org-1',
      projectId: 'proj-secret',
      scanId: 'scan-secret',
    },
    payload: {
      scanStatusChanged: {
        state: 'failed',
        errorMessage: 'git clone of acme/private failed',
      },
    },
  };

  it('reduces a project event to an invalidation: no project field, no payload', () => {
    expect(toBroadScopeEnvelope(scanFailed)).toEqual({
      eventId: 'evt-1',
      type: 'SCAN_STATUS_CHANGED',
      timestamp: '2026-10-09T10:00:00.000Z',
      scope: { organizationId: 'org-1' },
    });
  });

  it.each(['projectId', 'scanId', 'vulnerabilityId', 'jobId'])(
    'treats a scope carrying %s as project-level',
    (key) => {
      const env = {
        eventId: 'e',
        type: 'X',
        timestamp: 't',
        scope: { organizationId: 'o', [key]: 'secret' },
        payload: { anything: 'secret' },
      };
      const out = toBroadScopeEnvelope(env);
      expect(JSON.stringify(out)).not.toContain('secret');
      expect(out).toEqual({
        eventId: 'e',
        type: 'X',
        timestamp: 't',
        scope: { organizationId: 'o' },
      });
    },
  );

  it('keeps the team id for a team stream event about a project', () => {
    const out = toBroadScopeEnvelope({
      eventId: 'e',
      type: 'X',
      timestamp: 't',
      scope: { organizationId: 'o', teamId: 'tm', projectId: 'p' },
      payload: { p: 1 },
    });
    expect(out).toEqual({
      eventId: 'e',
      type: 'X',
      timestamp: 't',
      scope: { organizationId: 'o', teamId: 'tm' },
    });
  });

  it('keeps the legacy snake_case event id', () => {
    const out = toBroadScopeEnvelope({
      event_id: 'snake',
      type: 'X',
      scope: { organizationId: 'o', projectId: 'p' },
    });
    expect((out as { eventId?: string }).eventId).toBe('snake');
  });

  it('passes an organisation-level event (billing usage) unchanged', () => {
    const usage = {
      eventId: 'evt-2',
      type: 'USAGE_UPDATED',
      timestamp: 't',
      scope: { organizationId: 'org-1' },
      payload: {
        usageUpdated: { organizationId: 'org-1', usageKind: 'scans' },
      },
    };
    expect(toBroadScopeEnvelope(usage)).toBe(usage);
  });

  it('passes a membership event (user id, no project) unchanged', () => {
    const membership = {
      eventId: 'evt-3',
      type: 'MEMBERSHIP_CHANGED',
      scope: { organizationId: 'org-1', userId: 'u1' },
      payload: { membershipChanged: { userId: 'u1', changeType: 'added' } },
    };
    expect(toBroadScopeEnvelope(membership)).toBe(membership);
  });

  it('passes a value that is not an object unchanged', () => {
    expect(toBroadScopeEnvelope(null)).toBeNull();
  });

  it('forwards a payload only for the allowlisted organisation / team types', () => {
    expect([...BROAD_SCOPE_PAYLOAD_TYPES].sort()).toEqual([
      'AGGREGATED_REPORT_READY',
      'MEMBERSHIP_CHANGED',
      'SUBSCRIPTION_CHANGED',
      'TRIAL_UPDATED',
      'USAGE_UPDATED',
    ]);
  });

  it('reduces a type outside the allowlist even when only its payload names a project', () => {
    const out = toBroadScopeEnvelope({
      eventId: 'e',
      type: 'PROJECT_STATE_CHANGED',
      timestamp: 't',
      scope: { organizationId: 'o' },
      payload: { projectStateChanged: { projectId: 'p-hidden', name: 'x' } },
    });
    expect(out).toEqual({
      eventId: 'e',
      type: 'PROJECT_STATE_CHANGED',
      timestamp: 't',
      scope: { organizationId: 'o' },
    });
    expect(JSON.stringify(out)).not.toContain('p-hidden');
  });

  it('reduces an envelope without scope or type to an invalidation', () => {
    expect(toBroadScopeEnvelope({ type: 'X', payload: { a: 1 } })).toEqual({
      type: 'X',
      scope: {},
    });
  });

  it('reduces an allowlisted type whose scope names a project', () => {
    expect(
      toBroadScopeEnvelope({
        eventId: 'e',
        type: 'USAGE_UPDATED',
        timestamp: 't',
        scope: { organizationId: 'o', projectId: 'p' },
        payload: { usageUpdated: { projectId: 'p' } },
      }),
    ).toEqual({
      eventId: 'e',
      type: 'USAGE_UPDATED',
      timestamp: 't',
      scope: { organizationId: 'o' },
    });
  });
});

describe('isBroadScopeChannel', () => {
  it.each([
    'cybe:event:org:o:projects',
    'cybe:event:org:o:overview',
    'cybe:event:org:o:members',
    'cybe:event:org:o:reports',
    'cybe:event:billing:org:o',
    'cybe:event:team:t',
    'cybe:event:team:t:reports',
  ])('%s is a broad channel', (ch) => {
    expect(isBroadScopeChannel(ch)).toBe(true);
  });

  it.each([
    'cybe:event:project:p:issues',
    'cybe:event:project:p:vuln:v',
    'cybe:event:job:j',
  ])('%s is not', (ch) => {
    expect(isBroadScopeChannel(ch)).toBe(false);
  });
});

// The gateway does not depend on @cybedefend/realtime-publisher (adding it
// would change the gateway's Dockerfile), so it keeps its own copy of the
// allowlist and prefixes. This test-only relative import of the library's
// source ties the two: change one, this fails until the other follows.
describe('broad-scope rules match libs/realtime-publisher', () => {
  it('same payload allowlist', () => {
    expect([...BROAD_SCOPE_PAYLOAD_TYPES].sort()).toEqual(
      [...publisherEventTypes.BROAD_SCOPE_PAYLOAD_TYPES].sort(),
    );
  });

  it('same broad channel prefixes', () => {
    for (const prefix of publisherEventTypes.BROAD_SCOPE_CHANNEL_PREFIXES) {
      expect(isBroadScopeChannel(`${prefix}x`)).toBe(true);
    }
    expect(isBroadScopeChannel('cybe:event:project:p:issues')).toBe(false);
  });
});

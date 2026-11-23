import { resolveChannels } from '../channel-router';

describe('resolveChannels', () => {
  // --- SCAN_STATUS_CHANGED ---
  it('SCAN_STATUS_CHANGED publishes to org projects + project issues + project stats + org overview', () => {
    expect(resolveChannels({ type: 'SCAN_STATUS_CHANGED', scope: { organizationId: 'o', projectId: 'p', scanId: 's' } } as any))
      .toEqual([
        'cybe:event:org:o:projects',
        'cybe:event:project:p:issues',
        'cybe:event:project:p:stats',
        'cybe:event:org:o:overview',
      ]);
  });

  // --- VULNERABILITY_BATCH_APPENDED ---
  it('VULNERABILITY_BATCH_APPENDED with org scope publishes to project issues + project stats + org overview', () => {
    expect(resolveChannels({ type: 'VULNERABILITY_BATCH_APPENDED', scope: { organizationId: 'o', projectId: 'p' } } as any))
      .toEqual([
        'cybe:event:project:p:issues',
        'cybe:event:project:p:stats',
        'cybe:event:org:o:overview',
      ]);
  });
  it('VULNERABILITY_BATCH_APPENDED without org id publishes only to project channels', () => {
    expect(resolveChannels({ type: 'VULNERABILITY_BATCH_APPENDED', scope: { projectId: 'p' } } as any))
      .toEqual(['cybe:event:project:p:issues', 'cybe:event:project:p:stats']);
  });

  // --- PROJECT_STATE_CHANGED ---
  it('PROJECT_STATE_CHANGED publishes to org projects + org overview', () => {
    expect(resolveChannels({ type: 'PROJECT_STATE_CHANGED', scope: { organizationId: 'o' } } as any))
      .toEqual(['cybe:event:org:o:projects', 'cybe:event:org:o:overview']);
  });

  // --- POLICY_EVALUATION_COMPLETED ---
  it('POLICY_EVALUATION_COMPLETED publishes to project policies + project issues + project stats + org overview when org id present', () => {
    expect(resolveChannels({ type: 'POLICY_EVALUATION_COMPLETED', scope: { organizationId: 'o', projectId: 'p' } } as any))
      .toEqual([
        'cybe:event:project:p:policies',
        'cybe:event:project:p:issues',
        'cybe:event:project:p:stats',
        'cybe:event:org:o:overview',
      ]);
  });
  it('POLICY_EVALUATION_COMPLETED omits org overview when org id is absent', () => {
    expect(resolveChannels({ type: 'POLICY_EVALUATION_COMPLETED', scope: { projectId: 'p' } } as any))
      .toEqual([
        'cybe:event:project:p:policies',
        'cybe:event:project:p:issues',
        'cybe:event:project:p:stats',
      ]);
  });

  // --- ZERO_DAY_DETECTED ---
  it('ZERO_DAY_DETECTED with org scope publishes to org projects + org overview', () => {
    expect(resolveChannels({ type: 'ZERO_DAY_DETECTED', scope: { organizationId: 'o' } } as any))
      .toEqual(['cybe:event:org:o:projects', 'cybe:event:org:o:overview']);
  });
  it('ZERO_DAY_DETECTED with project scope only publishes to project channels', () => {
    expect(resolveChannels({ type: 'ZERO_DAY_DETECTED', scope: { projectId: 'p' } } as any))
      .toEqual(['cybe:event:project:p:issues', 'cybe:event:project:p:stats']);
  });
  it('ZERO_DAY_DETECTED with both org and project scope publishes to all four channels', () => {
    expect(resolveChannels({ type: 'ZERO_DAY_DETECTED', scope: { organizationId: 'o', projectId: 'p' } } as any))
      .toEqual([
        'cybe:event:org:o:projects',
        'cybe:event:org:o:overview',
        'cybe:event:project:p:issues',
        'cybe:event:project:p:stats',
      ]);
  });

  // --- VULNERABILITY_UPDATED ---
  // The per-vuln channel is nested under the vulnerability's project, like
  // every other project stream, so a vulnerability id of another project never
  // matches a channel the caller was authorized for. No unscoped channel exists.
  it('VULNERABILITY_UPDATED publishes to the project-scoped per-vuln channel + project issues when both ids are present', () => {
    expect(
      resolveChannels({
        type: 'VULNERABILITY_UPDATED',
        scope: { projectId: 'p', vulnerabilityId: 'v' },
      } as any),
    ).toEqual(['cybe:event:project:p:vuln:v', 'cybe:event:project:p:issues']);
  });
  it('VULNERABILITY_UPDATED publishes nothing without a projectId (no unscoped per-vuln fallback)', () => {
    expect(
      resolveChannels({
        type: 'VULNERABILITY_UPDATED',
        scope: { vulnerabilityId: 'v' },
      } as any),
    ).toEqual([]);
  });
  it.each([
    { label: 'project + vulnerability', scope: { projectId: 'p', vulnerabilityId: 'v' } },
    { label: 'org + project + vulnerability', scope: { organizationId: 'o', projectId: 'p', vulnerabilityId: 'v' } },
    { label: 'vulnerability only', scope: { vulnerabilityId: 'v' } },
  ])('VULNERABILITY_UPDATED never emits the unscoped cybe:event:vuln:<id> channel ($label)', ({ scope }) => {
    const channels = resolveChannels({ type: 'VULNERABILITY_UPDATED', scope });
    expect(channels.filter((ch) => /^cybe:event:vuln:/.test(ch))).toEqual([]);
    for (const perVuln of channels.filter((ch) => ch.includes(':vuln:'))) {
      expect(perVuln).toMatch(new RegExp(`^cybe:event:project:${scope.projectId}:`));
    }
  });
  it('VULNERABILITY_UPDATED for the same vulnerabilityId under two projects yields disjoint per-vuln channels', () => {
    const perVulnChannels = (projectId: string) =>
      resolveChannels({ type: 'VULNERABILITY_UPDATED', scope: { projectId, vulnerabilityId: 'v' } })
        .filter((ch) => ch.includes(':vuln:'));
    const victim = perVulnChannels('p-victim');
    const attacker = perVulnChannels('p-attacker');
    expect(victim).toHaveLength(1);
    expect(attacker).toHaveLength(1);
    expect(victim.filter((ch) => attacker.includes(ch))).toEqual([]);
  });

  // --- REPORT_READY ---
  it('REPORT_READY publishes to the project reports channel', () => {
    expect(resolveChannels({ type: 'REPORT_READY', scope: { organizationId: 'o', projectId: 'p' } } as any))
      .toEqual(['cybe:event:project:p:reports']);
  });
  it('REPORT_READY returns empty array when projectId is absent', () => {
    expect(resolveChannels({ type: 'REPORT_READY', scope: { organizationId: 'o' } } as any))
      .toEqual([]);
  });

  // --- STATS_AGGREGATE_CHANGED ---
  it('STATS_AGGREGATE_CHANGED with project scope publishes to project stats', () => {
    expect(resolveChannels({ type: 'STATS_AGGREGATE_CHANGED', scope: { organizationId: 'o', projectId: 'p' } } as any))
      .toEqual(['cybe:event:project:p:stats']);
  });
  it('STATS_AGGREGATE_CHANGED with only org scope publishes to org overview', () => {
    expect(resolveChannels({ type: 'STATS_AGGREGATE_CHANGED', scope: { organizationId: 'o' } } as any))
      .toEqual(['cybe:event:org:o:overview']);
  });

  // --- MEMBERSHIP_CHANGED ---
  it('MEMBERSHIP_CHANGED publishes to control + org members channel for org scope', () => {
    expect(resolveChannels({ type: 'MEMBERSHIP_CHANGED', scope: { organizationId: 'o', userId: 'u' } } as any))
      .toEqual(['cybe:event:membership', 'cybe:event:org:o:members']);
  });
  it('MEMBERSHIP_CHANGED on team scope publishes to control + team channel', () => {
    expect(resolveChannels({ type: 'MEMBERSHIP_CHANGED', scope: { organizationId: 'o', teamId: 't', userId: 'u' } } as any))
      .toEqual(['cybe:event:membership', 'cybe:event:team:t']);
  });

  // --- Billing events ---
  it('TRIAL_UPDATED publishes to billing org channel', () => {
    expect(resolveChannels({ type: 'TRIAL_UPDATED', scope: { organizationId: 'o' } } as any))
      .toEqual(['cybe:event:billing:org:o']);
  });
  it('SUBSCRIPTION_CHANGED publishes to billing org channel', () => {
    expect(resolveChannels({ type: 'SUBSCRIPTION_CHANGED', scope: { organizationId: 'o' } } as any))
      .toEqual(['cybe:event:billing:org:o']);
  });
  it('USAGE_UPDATED publishes to billing org channel', () => {
    expect(resolveChannels({ type: 'USAGE_UPDATED', scope: { organizationId: 'o' } } as any))
      .toEqual(['cybe:event:billing:org:o']);
  });
  // A closed extension's usage event rides the organisation's billing stream.
  it('VIBEDEFEND_USAGE_UPDATED publishes to billing org channel', () => {
    expect(resolveChannels({ type: 'VIBEDEFEND_USAGE_UPDATED', scope: { organizationId: 'o' } } as any))
      .toEqual(['cybe:event:billing:org:o']);
  });

  // --- AGENT_STEP_CHANGED ---
  // Fine-grained event for the AI agent's per-vuln / per-phase progress
  // (container.step transitions). Routed only to the project issues channel:
  // it's a high-frequency stream that the issues page subscribes to anyway,
  // and we deliberately don't fan out to org-level channels because the
  // home/overview pages don't render this granularity.
  it('AGENT_STEP_CHANGED publishes only to project issues channel', () => {
    expect(
      resolveChannels({
        type: 'AGENT_STEP_CHANGED',
        scope: { organizationId: 'o', projectId: 'p', scanId: 's' },
      } as any),
    ).toEqual(['cybe:event:project:p:issues']);
  });
  it('AGENT_STEP_CHANGED returns empty when projectId is missing', () => {
    expect(
      resolveChannels({
        type: 'AGENT_STEP_CHANGED',
        scope: { organizationId: 'o', scanId: 's' },
      } as any),
    ).toEqual([]);
  });

  // --- SCAN_PIPELINE_CHANGED ---
  // Tells the Results page to refetch the scan's pipeline (scanner lane, AI
  // queue, analysis progress). Same scope as AGENT_STEP_CHANGED: the project
  // issues channel the gateway authorised through Permify, never a channel
  // keyed by the scan id alone.
  it('SCAN_PIPELINE_CHANGED publishes only to the project issues channel', () => {
    expect(
      resolveChannels({
        type: 'SCAN_PIPELINE_CHANGED',
        scope: { organizationId: 'o', projectId: 'p' },
      }),
    ).toEqual(['cybe:event:project:p:issues']);
  });
  it('SCAN_PIPELINE_CHANGED returns empty when projectId is missing', () => {
    expect(
      resolveChannels({
        type: 'SCAN_PIPELINE_CHANGED',
        scope: { organizationId: 'o' },
      }),
    ).toEqual([]);
  });

  // --- AGGREGATED_REPORT_READY ---
  describe('AGGREGATED_REPORT_READY', () => {
    it('routes org/batch scope to the org reports channel', () => {
      expect(
        resolveChannels({
          type: 'AGGREGATED_REPORT_READY',
          scope: { organizationId: 'o1' },
        } as any),
      ).toEqual(['cybe:event:org:o1:reports']);
    });
    it('routes team scope to the team reports channel', () => {
      expect(
        resolveChannels({
          type: 'AGGREGATED_REPORT_READY',
          scope: { teamId: 't1', organizationId: 'o1' },
        } as any),
      ).toEqual(['cybe:event:team:t1:reports']);
    });
    it('returns empty when neither org nor team id is present', () => {
      expect(
        resolveChannels({
          type: 'AGGREGATED_REPORT_READY',
          scope: {},
        } as any),
      ).toEqual([]);
    });
  });

  // --- Async background tasks ---
  // Per-task progress + terminal events route to a single per-task channel the
  // gateway subscribes to for the background-tasks tracker widget.
  describe('ASYNC_TASK events', () => {
    it('ASYNC_TASK_PROGRESS routes to the per-task channel', () => {
      expect(
        resolveChannels({
          type: 'ASYNC_TASK_PROGRESS',
          scope: { jobId: 'task-1', userId: 'u', projectId: 'p' },
        } as any),
      ).toEqual(['cybe:event:job:task-1']);
    });
    it('ASYNC_TASK_COMPLETED routes to the per-task channel', () => {
      expect(
        resolveChannels({
          type: 'ASYNC_TASK_COMPLETED',
          scope: { jobId: 'task-2', userId: 'u' },
        } as any),
      ).toEqual(['cybe:event:job:task-2']);
    });
    it('returns empty when jobId is absent', () => {
      expect(
        resolveChannels({ type: 'ASYNC_TASK_PROGRESS', scope: { userId: 'u' } } as any),
      ).toEqual([]);
    });
  });

  // --- Unknown ---
  it('returns empty array for unknown event types', () => {
    expect(resolveChannels({ type: 'WEIRD_TYPE', scope: { organizationId: 'o' } } as any)).toEqual([]);
  });
});

import { buildReportRecipients, ProjectAccessPair } from './report-recipients';

interface TestProject {
  projectId: string;
  projectName: string;
}

const projects: TestProject[] = [
  { projectId: 'p1', projectName: 'Alpha' },
  { projectId: 'p2', projectName: 'Beta' },
  { projectId: 'p3', projectName: 'Gamma' },
];

describe('buildReportRecipients', () => {
  it('gives a user only the subset of projects they can access', () => {
    const pairs: ProjectAccessPair[] = [
      { userId: 'u1', email: 'u1@x.io', notification: true, projectId: 'p1' },
      { userId: 'u1', email: 'u1@x.io', notification: true, projectId: 'p3' },
    ];

    const recipients = buildReportRecipients(pairs, projects);

    expect(recipients).toHaveLength(1);
    expect(recipients[0].email).toBe('u1@x.io');
    expect(recipients[0].projects.map((p) => p.projectId)).toEqual([
      'p1',
      'p3',
    ]);
  });

  it('excludes a user whose Email Notifications toggle is off', () => {
    const pairs: ProjectAccessPair[] = [
      { userId: 'u1', email: 'u1@x.io', notification: false, projectId: 'p1' },
    ];

    expect(buildReportRecipients(pairs, projects)).toEqual([]);
  });

  it('excludes a user with no accessible project in this report', () => {
    const pairs: ProjectAccessPair[] = [
      { userId: 'u1', email: 'u1@x.io', notification: true, projectId: 'pX' },
    ];

    expect(buildReportRecipients(pairs, projects)).toEqual([]);
  });

  it('emits one recipient per user, each with their own subset', () => {
    const pairs: ProjectAccessPair[] = [
      { userId: 'u1', email: 'u1@x.io', notification: true, projectId: 'p1' },
      { userId: 'u2', email: 'u2@x.io', notification: true, projectId: 'p2' },
      { userId: 'u2', email: 'u2@x.io', notification: true, projectId: 'p3' },
    ];

    const recipients = buildReportRecipients(pairs, projects);

    expect(recipients).toHaveLength(2);
    const byEmail = Object.fromEntries(recipients.map((r) => [r.email, r]));
    expect(byEmail['u1@x.io'].projects.map((p) => p.projectId)).toEqual(['p1']);
    expect(byEmail['u2@x.io'].projects.map((p) => p.projectId)).toEqual([
      'p2',
      'p3',
    ]);
  });

  it('deduplicates repeated access pairs and preserves report project order', () => {
    const pairs: ProjectAccessPair[] = [
      // p3 before p1, and p1 duplicated (e.g. org-admin + team-member both matched)
      { userId: 'u1', email: 'u1@x.io', notification: true, projectId: 'p3' },
      { userId: 'u1', email: 'u1@x.io', notification: true, projectId: 'p1' },
      { userId: 'u1', email: 'u1@x.io', notification: true, projectId: 'p1' },
    ];

    const recipients = buildReportRecipients(pairs, projects);

    expect(recipients).toHaveLength(1);
    // order follows the `projects` argument, not the pair order
    expect(recipients[0].projects.map((p) => p.projectId)).toEqual([
      'p1',
      'p3',
    ]);
  });
});

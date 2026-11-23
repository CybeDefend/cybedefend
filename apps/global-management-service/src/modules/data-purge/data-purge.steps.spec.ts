import { status } from '@grpc/grpc-js';
import { NEVER, of, throwError } from 'rxjs';
import type { DataPurgeJob } from '../../entities/data-purge-job.entity';
import type { PurgeStepName } from '../../entities/data-purge-step.entity';
import type { PurgeStepsPort } from 'src/edition/ports/purge-steps.port';
import { PermifyService } from '../permify/permify.service';
import { CORE_PURGE_STEPS } from './data-purge.ledger';
import { DataPurgeSteps, PURGE_CALL_TIMEOUT_MS } from './data-purge.steps';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const TEAM = '33333333-3333-4333-8333-333333333333';
const TEAM_2 = '44444444-4444-4444-8444-444444444444';
const ORG = '55555555-5555-4555-8555-555555555555';

type Job = Omit<DataPurgeJob, 'steps'>;

const job = (patch: Partial<Job>): Job => ({
  id: 'job-1',
  kind: 'project',
  subjectId: PROJECT,
  organizationId: ORG,
  teamIds: null,
  deletedAt: new Date(),
  status: 'pending',
  pass: 1,
  nextAttemptAt: new Date(),
  leaseUntil: null,
  leaseToken: null,
  completedAt: null,
  ...patch,
});

const CLIENTS = {
  ANALYSIS_REPORTING_SERVICE: 'analysis_reporting',
  SECURITY_SCANNING_SERVICE: 'security_scanning',
  FILE_MANAGEMENT_SERVICE: 'file_management',
  EXTERNAL_INTEGRATIONS_SERVICE: 'integrations',
  POLICY_MANAGEMENT_SERVICE: 'policy',
} as const;
type ClientName = keyof typeof CLIENTS;

const answer = { complete: true, deleted: { rows: 4 } };

function fakeService() {
  return {
    purgeProjectData: jest.fn(() => of(answer)),
    purgeTeamData: jest.fn(() => of(answer)),
    purgeOrganizationData: jest.fn(() => of(answer)),
  };
}

/** The community step list, with an edition step recorder. */
function communityPort(): PurgeStepsPort & {
  runEditionStep: jest.Mock;
} {
  return {
    steps: CORE_PURGE_STEPS,
    runEditionStep: jest.fn(async () => answer),
  };
}

async function build(port: PurgeStepsPort = communityPort()) {
  const services = Object.fromEntries(
    Object.keys(CLIENTS).map((name) => [name, fakeService()]),
  ) as Record<ClientName, ReturnType<typeof fakeService>>;
  const getService = jest.fn();
  const clients = Object.fromEntries(
    (Object.keys(CLIENTS) as ClientName[]).map((name) => [
      name,
      {
        getService: (service: string) => {
          getService(name, service);
          return services[name];
        },
      },
    ]),
  ) as Record<ClientName, { getService: (s: string) => unknown }>;
  const permify = {
    deleteAllPermissions: jest.fn(async () => true),
    deleteOrganizationAttributes: jest.fn(async () => undefined),
  };
  const steps = new DataPurgeSteps(
    clients.ANALYSIS_REPORTING_SERVICE as never,
    clients.SECURITY_SCANNING_SERVICE as never,
    clients.FILE_MANAGEMENT_SERVICE as never,
    clients.EXTERNAL_INTEGRATIONS_SERVICE as never,
    clients.POLICY_MANAGEMENT_SERVICE as never,
    port,
    permify as unknown as PermifyService,
  );
  steps.onModuleInit();
  return { steps, services, getService, permify, port };
}

/** The request of a method's last call (the tracing wrapper adds metadata). */
const lastRequest = (fn: jest.Mock) => fn.mock.calls.at(-1)?.[0];

/** The core gRPC steps of a kind and the client that owns each. */
const grpcSteps = (kind: Job['kind']) =>
  (Object.entries(CLIENTS) as [ClientName, PurgeStepName][]).filter(
    ([, step]) => CORE_PURGE_STEPS[kind].includes(step),
  );

describe('DataPurgeSteps', () => {
  afterEach(() => jest.useRealTimers());

  it("sends the job's ids to each service's DataPurgeService", async () => {
    const { steps, services, getService } = await build();

    // Every client is asked for its own package's DataPurgeService.
    expect(getService.mock.calls.map((c) => c[1])).toEqual(
      Object.keys(CLIENTS).map(() => 'DataPurgeService'),
    );

    for (const [client, step] of grpcSteps('project')) {
      await expect(steps.runStep(step, job({}))).resolves.toEqual(answer);
      expect(lastRequest(services[client].purgeProjectData)).toEqual({
        projectId: PROJECT,
        organizationId: ORG,
      });
    }
    for (const [client, step] of grpcSteps('team')) {
      await steps.runStep(step, job({ kind: 'team', subjectId: TEAM }));
      expect(lastRequest(services[client].purgeTeamData)).toEqual({
        teamId: TEAM,
        organizationId: ORG,
      });
    }
    for (const [client, step] of grpcSteps('organization')) {
      await steps.runStep(
        step,
        job({ kind: 'organization', subjectId: ORG, teamIds: [TEAM, TEAM_2] }),
      );
      expect(lastRequest(services[client].purgeOrganizationData)).toEqual({
        organizationId: ORG,
        teamIds: [TEAM, TEAM_2],
      });
    }
    // Each step reached its own service only.
    expect(
      services.SECURITY_SCANNING_SERVICE.purgeOrganizationData,
    ).not.toHaveBeenCalled();
    expect(
      services.EXTERNAL_INTEGRATIONS_SERVICE.purgeTeamData,
    ).not.toHaveBeenCalled();
    expect(
      services.POLICY_MANAGEMENT_SERVICE.purgeOrganizationData,
    ).toHaveBeenCalled();
  });

  it('sends an organization with no team as an empty list', async () => {
    const { steps, services } = await build();
    await steps.runStep(
      'policy',
      job({ kind: 'organization', subjectId: ORG, teamIds: null }),
    );
    expect(
      lastRequest(services.POLICY_MANAGEMENT_SERVICE.purgeOrganizationData),
    ).toEqual({
      organizationId: ORG,
      teamIds: [],
    });
  });

  it('removes the remaining relations of a project and the attributes of an organization', async () => {
    const { steps, permify } = await build();

    await expect(steps.runStep('permify', job({}))).resolves.toEqual({
      complete: true,
      deleted: {},
    });
    expect(permify.deleteAllPermissions).toHaveBeenCalledWith(
      PROJECT,
      'project',
    );

    await steps.runStep(
      'permify',
      job({ kind: 'organization', subjectId: ORG, teamIds: [] }),
    );
    expect(permify.deleteOrganizationAttributes).toHaveBeenCalledWith(ORG);
    expect(permify.deleteAllPermissions).toHaveBeenCalledTimes(1);
  });

  it('a Permify delete that answers no token fails the step', async () => {
    const { steps, permify } = await build();
    permify.deleteAllPermissions.mockResolvedValueOnce(false);
    await expect(steps.runStep('permify', job({}))).rejects.toMatchObject({
      code: status.UNKNOWN,
    });
  });

  it('hands an edition step to the port', async () => {
    const runEditionStep = jest.fn(async () => answer);
    const port: PurgeStepsPort = {
      steps: {
        ...CORE_PURGE_STEPS,
        organization: [...CORE_PURGE_STEPS.organization, 'billing'],
      },
      runEditionStep,
    };
    const { steps, services } = await build(port);

    const orgJob = job({
      kind: 'organization',
      subjectId: ORG,
      teamIds: [TEAM],
    });
    await expect(steps.runStep('billing', orgJob)).resolves.toEqual(answer);

    expect(runEditionStep).toHaveBeenCalledTimes(1);
    expect(runEditionStep).toHaveBeenCalledWith('billing', orgJob);
    // No core service was called for it.
    for (const service of Object.values(services)) {
      for (const method of Object.values(service)) {
        expect(method).not.toHaveBeenCalled();
      }
    }
  });

  it.each([
    ['an empty subject', { subjectId: '' }],
    ['a path as subject', { subjectId: '../reports' }],
    ['a malformed organization', { organizationId: '*' }],
  ])('refuses %s and calls nothing', async (_label, patch) => {
    const { steps, services, permify, port } = await build();

    for (const step of CORE_PURGE_STEPS.project) {
      await expect(steps.runStep(step, job(patch))).rejects.toMatchObject({
        code: status.INVALID_ARGUMENT,
      });
    }
    await expect(
      steps.runStep('marketing', job({ kind: 'organization', ...patch })),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });

    for (const service of Object.values(services)) {
      for (const method of Object.values(service)) {
        expect(method).not.toHaveBeenCalled();
      }
    }
    expect(permify.deleteAllPermissions).not.toHaveBeenCalled();
    expect(port.runEditionStep).not.toHaveBeenCalled();
  });

  it('refuses an organization whose team list holds a malformed id', async () => {
    const { steps, services } = await build();
    await expect(
      steps.runStep(
        'file_management',
        job({ kind: 'organization', subjectId: ORG, teamIds: [TEAM, ''] }),
      ),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
    expect(
      services.FILE_MANAGEMENT_SERVICE.purgeOrganizationData,
    ).not.toHaveBeenCalled();
  });

  it('refuses a step its kind does not have', async () => {
    const { steps, port } = await build();
    await expect(
      steps.runStep(
        'security_scanning',
        job({ kind: 'organization', subjectId: ORG, teamIds: [] }),
      ),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
    await expect(steps.runStep('marketing', job({}))).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
    });
    // An edition step the community kind does not list is refused too,
    // without reaching the port.
    await expect(steps.runStep('agent', job({}))).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
    });
    await expect(
      steps.runStep(
        'billing',
        job({ kind: 'organization', subjectId: ORG, teamIds: [] }),
      ),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
    expect(port.runEditionStep).not.toHaveBeenCalled();
  });

  it('keeps the code of a service error', async () => {
    const { steps, services } = await build();
    services.POLICY_MANAGEMENT_SERVICE.purgeProjectData.mockReturnValueOnce(
      throwError(() =>
        Object.assign(new Error('14 UNAVAILABLE: no healthy upstream'), {
          code: status.UNAVAILABLE,
        }),
      ),
    );
    await expect(steps.runStep('policy', job({}))).rejects.toMatchObject({
      code: status.UNAVAILABLE,
    });
  });

  it(`gives a call ${PURGE_CALL_TIMEOUT_MS} ms, then fails it with DEADLINE_EXCEEDED`, async () => {
    const { steps, services } = await build();
    jest.useFakeTimers();
    services.POLICY_MANAGEMENT_SERVICE.purgeProjectData.mockReturnValueOnce(
      NEVER,
    );

    const call = steps.runStep('policy', job({}));
    const settled = expect(call).rejects.toMatchObject({
      code: status.DEADLINE_EXCEEDED,
    });
    await jest.advanceTimersByTimeAsync(PURGE_CALL_TIMEOUT_MS - 1);
    let done = false;
    void call.catch(() => undefined).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await settled;

    expect(PURGE_CALL_TIMEOUT_MS).toBe(170_000);
  });
});

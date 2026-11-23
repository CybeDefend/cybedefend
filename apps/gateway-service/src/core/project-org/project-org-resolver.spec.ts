import { ClientGrpc } from '@nestjs/microservices';
import { Subject, of, throwError } from 'rxjs';

import { ProjectOrgResolver } from './project-org-resolver.service';

/**
 * FeatureGuard and a closed extension would otherwise ask global-management
 * for a project's organization on every request (two wide SELECTs). A
 * project never changes
 * organization, so the link is kept in memory. It is not a Permify cache:
 * nothing about who may read the project is kept.
 */
describe('ProjectOrgResolver', () => {
  let orgClient: { getOrganizationIdByProjectId: jest.Mock };
  let resolver: ProjectOrgResolver;
  let now: number;

  beforeEach(() => {
    orgClient = { getOrganizationIdByProjectId: jest.fn() };
    const gm = {
      getService: jest.fn().mockReturnValue(orgClient),
    } as unknown as ClientGrpc;
    resolver = new ProjectOrgResolver(gm);
    now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => jest.restoreAllMocks());

  const answers = (organizationId: string) =>
    orgClient.getOrganizationIdByProjectId.mockReturnValue(
      of({ organizationId }),
    );

  it('asks global-management once for two resolves of the same project', async () => {
    answers('org-1');

    await expect(resolver.resolve('p1')).resolves.toBe('org-1');
    await expect(resolver.resolve('p1')).resolves.toBe('org-1');

    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);
    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledWith(
      { projectId: 'p1' },
      expect.anything(),
    );
  });

  it('asks once per project', async () => {
    orgClient.getOrganizationIdByProjectId.mockImplementation(
      ({ projectId }: { projectId: string }) =>
        of({ organizationId: `org-of-${projectId}` }),
    );

    await expect(resolver.resolve('p1')).resolves.toBe('org-of-p1');
    await expect(resolver.resolve('p2')).resolves.toBe('org-of-p2');

    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failure: the next resolve asks again', async () => {
    orgClient.getOrganizationIdByProjectId
      .mockReturnValueOnce(
        throwError(() =>
          Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }),
        ),
      )
      .mockReturnValueOnce(of({ organizationId: 'org-1' }));

    await expect(resolver.resolve('p1')).rejects.toThrow('14 UNAVAILABLE');
    await expect(resolver.resolve('p1')).resolves.toBe('org-1');

    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(2);
  });

  it('does not keep an empty answer either', async () => {
    orgClient.getOrganizationIdByProjectId
      .mockReturnValueOnce(of({}))
      .mockReturnValueOnce(of({ organizationId: 'org-1' }));

    await expect(resolver.resolve('p1')).resolves.toBeNull();
    await expect(resolver.resolve('p1')).resolves.toBe('org-1');

    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(2);
  });

  it('shares one call between concurrent resolves of the same project', async () => {
    const answer = new Subject<{ organizationId: string }>();
    orgClient.getOrganizationIdByProjectId.mockReturnValue(answer);

    const first = resolver.resolve('p1');
    const second = resolver.resolve('p1');
    answer.next({ organizationId: 'org-1' });
    answer.complete();

    await expect(Promise.all([first, second])).resolves.toEqual([
      'org-1',
      'org-1',
    ]);
    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);
  });

  it('asks again once the entry is an hour old', async () => {
    answers('org-1');
    await resolver.resolve('p1');

    now += 60 * 60 * 1000 - 1;
    await resolver.resolve('p1');
    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);

    now += 1;
    await resolver.resolve('p1');
    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 5,000 projects and drops the least recently used', async () => {
    orgClient.getOrganizationIdByProjectId.mockImplementation(
      ({ projectId }: { projectId: string }) =>
        of({ organizationId: `org-of-${projectId}` }),
    );
    for (let i = 0; i < 5000; i++) await resolver.resolve(`p${i}`);
    await resolver.resolve('p0'); // p0 is now the most recently used
    orgClient.getOrganizationIdByProjectId.mockClear();

    await resolver.resolve('p5000'); // evicts p1, the least recently used

    await resolver.resolve('p0');
    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(1);
    await resolver.resolve('p1');
    expect(orgClient.getOrganizationIdByProjectId).toHaveBeenCalledTimes(2);
  });
});

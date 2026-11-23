import { of, throwError } from 'rxjs';
import { ProjectOrgResolver } from './project-org-resolver.service';

describe('ProjectOrgResolver', () => {
  let projectClient: { get: jest.Mock };
  let gmClient: { getService: jest.Mock };

  beforeEach(() => {
    projectClient = { get: jest.fn() };
    gmClient = { getService: jest.fn().mockReturnValue(projectClient) };
  });

  const make = () => {
    const r = new ProjectOrgResolver(gmClient as any);
    r.onModuleInit();
    return r;
  };

  it('resolves the organizationId for a project via gRPC', async () => {
    projectClient.get.mockReturnValue(of({ organizationId: 'org-1' }));
    const r = make();
    await expect(r.resolveOrgId('p1')).resolves.toBe('org-1');
    expect(projectClient.get).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('caches resolved values — second call does not hit gRPC', async () => {
    projectClient.get.mockReturnValue(of({ organizationId: 'org-1' }));
    const r = make();
    await r.resolveOrgId('p1');
    await r.resolveOrgId('p1');
    expect(projectClient.get).toHaveBeenCalledTimes(1);
  });

  it('returns null if the lookup fails (publisher must be tolerant)', async () => {
    projectClient.get.mockReturnValue(
      throwError(() => new Error('grpc unavailable')),
    );
    const r = make();
    await expect(r.resolveOrgId('p1')).resolves.toBeNull();
  });

  it('returns null when the project response has no organizationId', async () => {
    projectClient.get.mockReturnValue(of({}));
    const r = make();
    await expect(r.resolveOrgId('p1')).resolves.toBeNull();
  });

  it('does not cache failures (a transient error should not poison the cache)', async () => {
    projectClient.get
      .mockReturnValueOnce(throwError(() => new Error('temp')))
      .mockReturnValueOnce(of({ organizationId: 'org-1' }));
    const r = make();
    await r.resolveOrgId('p1');
    await expect(r.resolveOrgId('p1')).resolves.toBe('org-1');
    expect(projectClient.get).toHaveBeenCalledTimes(2);
  });
});

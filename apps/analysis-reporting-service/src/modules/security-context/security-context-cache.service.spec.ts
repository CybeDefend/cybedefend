import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';

import { SecurityContextCacheService } from './security-context-cache.service';

describe('SecurityContextCacheService', () => {
  let service: SecurityContextCacheService;
  const getProjectSecurityContext = jest.fn();
  const grpcClient = {
    getService: () => ({ getProjectSecurityContext }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityContextCacheService,
        { provide: 'GLOBAL_MANAGEMENT_SERVICE', useValue: grpcClient },
      ],
    }).compile();
    service = module.get(SecurityContextCacheService);
    service.onModuleInit();
    getProjectSecurityContext.mockReset();
  });

  it('hits the gRPC client on first call and caches the result', async () => {
    getProjectSecurityContext.mockReturnValue(
      of({
        securityContext: {
          id: 'ctx',
          projectId: 'p1',
          updatedAt: '2026-04-20T08:00:00Z',
        },
      }),
    );

    const first = await service.get('p1');
    const second = await service.get('p1');

    expect(first?.projectId).toBe('p1');
    expect(second?.projectId).toBe('p1');
    expect(getProjectSecurityContext).toHaveBeenCalledTimes(1);
  });

  it('returns null when the gRPC call errors and does not cache', async () => {
    getProjectSecurityContext.mockReturnValue(
      throwError(() => new Error('network')),
    );

    const result = await service.get('p1');
    expect(result).toBeNull();
    expect(getProjectSecurityContext).toHaveBeenCalledTimes(1);
  });

  it('parses updatedAt to a Date via getUpdatedAt', async () => {
    getProjectSecurityContext.mockReturnValue(
      of({
        securityContext: {
          id: 'ctx',
          projectId: 'p1',
          updatedAt: '2026-04-20T08:00:00Z',
        },
      }),
    );

    const ts = await service.getUpdatedAt('p1');
    expect(ts).toBeInstanceOf(Date);
    expect(ts!.toISOString()).toBe('2026-04-20T08:00:00.000Z');
  });

  it('returns null from getUpdatedAt when the project has no context', async () => {
    getProjectSecurityContext.mockReturnValue(of({ securityContext: null }));
    const ts = await service.getUpdatedAt('p1');
    expect(ts).toBeNull();
  });

  it('invalidate forces a refetch', async () => {
    getProjectSecurityContext.mockReturnValue(
      of({
        securityContext: { id: 'ctx', projectId: 'p1', updatedAt: 'now' },
      }),
    );

    await service.get('p1');
    service.invalidate('p1');
    await service.get('p1');

    expect(getProjectSecurityContext).toHaveBeenCalledTimes(2);
  });
});

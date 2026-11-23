import { Test, TestingModule } from '@nestjs/testing';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { Logger } from 'nestjs-pino';
import { of, throwError } from 'rxjs';

import { ProjectAppsecMarker } from './projectAppsecMarker';
import { ScanStateStore } from './scanStateStore';
import { ScanStateManager } from './scanStateManager';
import { Scan } from '../../../entities/scan.entity';

describe('ProjectAppsecMarker', () => {
  let marker: ProjectAppsecMarker;
  let markProjectAppsec: jest.Mock;
  let moveScanState: jest.Mock;
  let publishStatusChanged: jest.Mock;

  const build = async (markAnswer: unknown) => {
    markProjectAppsec = jest.fn().mockReturnValue(markAnswer);
    moveScanState = jest.fn().mockResolvedValue(true);
    publishStatusChanged = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectAppsecMarker,
        {
          provide: 'GLOBAL_MANAGEMENT_SERVICE',
          useValue: {
            getService: jest.fn().mockReturnValue({ markProjectAppsec }),
          } as Partial<ClientGrpc>,
        },
        { provide: ScanStateStore, useValue: { moveScanState } },
        { provide: ScanStateManager, useValue: { publishStatusChanged } },
        {
          provide: Logger,
          useValue: {
            log: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
          },
        },
      ],
    }).compile();
    marker = module.get(ProjectAppsecMarker);
  };

  it('fails the scan with PROJECT_LIMIT_REACHED and refuses FAILED_PRECONDITION at the AppSec project limit', async () => {
    await build(
      of({
        appsec: false,
        alreadyAppsec: false,
        limitReached: true,
        appsecProjectCount: 5,
        projectLimit: 5,
      }),
    );
    const scan = {
      id: 's1',
      projectId: 'p1',
      organizationId: 'o1',
      state: 'waiting_for_file',
    } as unknown as Scan;

    let err: unknown;
    try {
      await marker.markProjectAppsecOrRefuse(scan);
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(RpcException);
    expect((err as RpcException).getError()).toMatchObject({
      code: status.FAILED_PRECONDITION,
      message: 'PROJECT_LIMIT_REACHED',
    });
    expect(moveScanState).toHaveBeenCalledWith(
      scan,
      ['waiting_for_file'],
      'failed',
      expect.objectContaining({ errorMessage: 'PROJECT_LIMIT_REACHED' }),
    );
    expect(publishStatusChanged).toHaveBeenCalledWith(scan, 'waiting_for_file');
  });

  it('fails open when global-management cannot be reached', async () => {
    await build(throwError(() => new Error('unavailable')));
    const scan = {
      id: 's1',
      projectId: 'p1',
      organizationId: 'o1',
      state: 'waiting_for_file',
    } as unknown as Scan;

    await expect(
      marker.markProjectAppsecOrRefuse(scan),
    ).resolves.toBeUndefined();
    expect(moveScanState).not.toHaveBeenCalled();
    expect(publishStatusChanged).not.toHaveBeenCalled();
  });

  it('lets the scan start when the limit is not reached', async () => {
    await build(of({ appsec: true, alreadyAppsec: true, limitReached: false }));
    const scan = {
      id: 's1',
      projectId: 'p1',
      organizationId: 'o1',
      state: 'waiting_for_file',
    } as unknown as Scan;

    await expect(
      marker.markProjectAppsecOrRefuse(scan),
    ).resolves.toBeUndefined();
    expect(moveScanState).not.toHaveBeenCalled();
  });
});

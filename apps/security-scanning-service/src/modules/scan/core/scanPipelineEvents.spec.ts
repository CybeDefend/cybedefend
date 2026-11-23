import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';

import { ScanPipelineEvents } from './scanPipelineEvents';

describe('ScanPipelineEvents', () => {
  let module: TestingModule;
  let events: ScanPipelineEvents;
  let realtimePublish: jest.Mock;

  beforeEach(async () => {
    realtimePublish = jest.fn().mockResolvedValue(undefined);
    module = await Test.createTestingModule({
      providers: [
        ScanPipelineEvents,
        {
          provide: RealtimeEventPublisher,
          useValue: { publish: realtimePublish },
        },
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback?: string) => fallback },
        },
      ],
    }).compile();
    events = module.get(ScanPipelineEvents);
  });

  afterEach(async () => {
    await module.close();
  });

  it('publishes SCAN_PIPELINE_CHANGED with a 5 s dedupe key naming the reason and the detail', () => {
    events.publishPipelineChanged(
      { id: 's1', organizationId: 'o', projectId: 'p' },
      'agent_stage',
      'analyzing',
    );

    expect(realtimePublish).toHaveBeenCalledTimes(1);
    expect(realtimePublish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SCAN_PIPELINE_CHANGED' }),
      { dedupeKey: 'scan:s1:pipeline:agent_stage:analyzing', dedupeTtlSec: 5 },
    );
  });

  it('omits the detail suffix for ai_progress', () => {
    events.publishPipelineChanged(
      { id: 's1', organizationId: 'o', projectId: 'p' },
      'ai_progress',
    );

    expect(realtimePublish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SCAN_PIPELINE_CHANGED' }),
      { dedupeKey: 'scan:s1:pipeline:ai_progress', dedupeTtlSec: 5 },
    );
  });
});

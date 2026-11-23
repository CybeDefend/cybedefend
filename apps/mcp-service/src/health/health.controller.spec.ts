import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns status, service name, and uptime', async () => {
    const mod = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const ctrl = mod.get(HealthController);
    const result = ctrl.health();
    expect(result).toMatchObject({
      status: 'ok',
      service: 'mcp-service',
    });
    expect(typeof result.uptime).toBe('number');
  });
});

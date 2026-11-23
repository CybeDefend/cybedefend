import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthCheckResponse_ServingStatus } from '@grpc/health/health';

describe('HealthController', () => {
  let controller: HealthController;
  let svc: HealthService;

  beforeEach(() => {
    svc = new HealthService();
    controller = new HealthController(svc);
  });

  it('check() returns NOT_SERVING before bootstrap finished', () => {
    const resp = controller.check({ service: '' });
    expect(resp.status).toBe(HealthCheckResponse_ServingStatus.NOT_SERVING);
  });

  it('check() returns SERVING after markReady()', () => {
    svc.markReady();
    const resp = controller.check({ service: '' });
    expect(resp.status).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it('check() ignores the requested service name and returns the overall process status', () => {
    // K8s probe sends service: "", but downstream gRPC clients may send a service name.
    // We only expose a single process-wide status, so the field is informational only.
    svc.markReady();
    expect(controller.check({ service: 'grpc.health.v1.Health' }).status).toBe(
      HealthCheckResponse_ServingStatus.SERVING,
    );
    expect(
      controller.check({ service: 'cybedefend.global_management.UserService' })
        .status,
    ).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });
});

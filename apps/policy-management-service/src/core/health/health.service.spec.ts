import { HealthService } from './health.service';
import { HealthCheckResponse_ServingStatus } from '@grpc/health/health';

describe('HealthService', () => {
  let svc: HealthService;

  beforeEach(() => {
    svc = new HealthService();
  });

  it('starts in NOT_SERVING state so kubelet keeps the pod out of Service endpoints until bootstrap finishes', () => {
    expect(svc.getStatus()).toBe(HealthCheckResponse_ServingStatus.NOT_SERVING);
  });

  it('transitions to SERVING after markReady()', () => {
    svc.markReady();
    expect(svc.getStatus()).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it('transitions back to NOT_SERVING after markNotReady() — used at SIGTERM for graceful drain', () => {
    svc.markReady();
    svc.markNotReady();
    expect(svc.getStatus()).toBe(HealthCheckResponse_ServingStatus.NOT_SERVING);
  });

  it('onApplicationBootstrap flips state to SERVING', () => {
    svc.onApplicationBootstrap();
    expect(svc.getStatus()).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });

  it('beforeApplicationShutdown flips state back to NOT_SERVING', () => {
    svc.markReady();
    svc.beforeApplicationShutdown();
    expect(svc.getStatus()).toBe(HealthCheckResponse_ServingStatus.NOT_SERVING);
  });
});

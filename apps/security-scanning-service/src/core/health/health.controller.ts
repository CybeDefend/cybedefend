import { Controller } from '@nestjs/common';
import {
  HealthCheckRequest,
  HealthCheckResponse,
  HealthControllerMethods,
  HealthController as HealthControllerInterface,
} from '@grpc/health/health';
import { HealthService } from './health.service';

@Controller()
@HealthControllerMethods()
export class HealthController implements HealthControllerInterface {
  constructor(private readonly health: HealthService) {}

  // request.service is informational — we expose a single process-wide status,
  // which is what the kubelet gRPC probe sends (empty service name).
  check(request: HealthCheckRequest): HealthCheckResponse {
    void request;
    return { status: this.health.getStatus() };
  }
}

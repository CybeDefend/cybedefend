import { Injectable } from '@nestjs/common';
import { HealthCheckResponse_ServingStatus } from '@grpc/health/health';

@Injectable()
export class HealthService {
  private status: HealthCheckResponse_ServingStatus =
    HealthCheckResponse_ServingStatus.NOT_SERVING;

  getStatus(): HealthCheckResponse_ServingStatus {
    return this.status;
  }

  markReady(): void {
    this.status = HealthCheckResponse_ServingStatus.SERVING;
  }

  markNotReady(): void {
    this.status = HealthCheckResponse_ServingStatus.NOT_SERVING;
  }

  // Called by Nest after every module's onModuleInit has completed and the
  // gRPC server is bound. At this point the DB pool, Permify, secrets and
  // JWKS caches are all initialised — safe to advertise SERVING.
  onApplicationBootstrap(): void {
    this.markReady();
  }

  // Flip back to NOT_SERVING on SIGTERM so kubelet pulls the pod from the
  // Service endpoints before the gRPC port is closed.
  beforeApplicationShutdown(): void {
    this.markNotReady();
  }
}

import { Module } from '@nestjs/common';
import { GrpcModule } from 'src/core/grpc/grpc.module';
import { ProjectNameResolver } from './project-name-resolver.service';

/**
 * Exposes `ProjectNameResolver` (project name resolution through
 * global-management) to the report modules. Wraps the registration of the
 * GLOBAL_MANAGEMENT_SERVICE gRPC client so that each report only has to
 * import this module.
 */
@Module({
  imports: [GrpcModule.register()],
  providers: [ProjectNameResolver],
  exports: [ProjectNameResolver],
})
export class ProjectNameResolverModule {}

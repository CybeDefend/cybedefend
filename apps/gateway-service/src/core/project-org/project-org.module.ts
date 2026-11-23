import { Global, Module } from '@nestjs/common';

import { GrpcModule } from '@grpc/grpc.module';
import { ProjectOrgResolver } from './project-org-resolver.service';

/**
 * Global so that every module declaring FeatureGuard, and the closed guards module,
 * share ONE ProjectOrgResolver, hence one cache per gateway process. Imported
 * once, by AppModule.
 */
@Global()
@Module({
  imports: [GrpcModule.register()],
  providers: [ProjectOrgResolver],
  exports: [ProjectOrgResolver],
})
export class ProjectOrgModule {}

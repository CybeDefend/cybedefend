import { Module } from '@nestjs/common';
import { GrpcModule } from '@grpc/grpc.module';
import { RepoHistoryService } from './repo-history.service';

/**
 * The git history of a repository scan. Imported by the modules of the
 * services that run the repo-scan job (GitHub, GitLab), so it resolves in
 * every process that builds them.
 */
@Module({
  imports: [GrpcModule.register()],
  providers: [RepoHistoryService],
  exports: [RepoHistoryService],
})
export class RepoHistoryModule {}

import { Global, Module } from '@nestjs/common';
import { GrpcModule } from '@grpc/grpc.module';
import { ScanCapabilityCache } from './scan-capability.cache';

/**
 * Community Edition only (listed in COMMUNITY_ONLY_MODULES for the API
 * context and COMMUNITY_CONTEXT_MODULES.worker): the
 * cache needs the security-scanning gRPC client, which the global
 * EditionModule cannot inject, and the cloud must never call
 * GetScanCapabilities. Global, so CommunityEntitlements (provided by
 * EditionModule) reaches it; it injects it @Optional() and answers as
 * before when it is absent.
 */
@Global()
@Module({
  imports: [GrpcModule.register()],
  providers: [ScanCapabilityCache],
  exports: [ScanCapabilityCache],
})
export class ScanCapabilityModule {}

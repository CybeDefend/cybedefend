import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientGrpc } from '@nestjs/microservices';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { of } from 'rxjs';

import { FeatureGuard } from 'src/core/guards/feature/feature.guard';
import type { EntitlementsPort } from 'src/edition/ports/entitlements.port';
import { ProjectOrgResolver } from 'src/core/project-org/project-org-resolver.service';

/**
 * Routes under `:projectId` must record a span between the gateway and the
 * downstream service, and so must the plan check of FeatureGuard: without
 * it their latency shows only downstream, as orphan root spans. The closed
 * service cases are tested with the cloud edition.
 */
describe('spans on the closed-product hook path', () => {
  describe('records a span when called', () => {
    const exporter = new InMemorySpanExporter();

    beforeAll(() => {
      trace.setGlobalTracerProvider(
        new BasicTracerProvider({
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        }),
      );
    });

    afterEach(() => exporter.reset());

    afterAll(() => trace.disable());

    const spanNames = () => exporter.getFinishedSpans().map((s) => s.name);

    const orgClient = {
      getOrganizationIdByProjectId: () => of({ organizationId: 'org-1' }),
    };
    const gm = { getService: () => orgClient } as unknown as ClientGrpc;
    const entitlements = {
      checkFeatureAccess: () => Promise.resolve({ allowed: true }),
    } as unknown as EntitlementsPort;

    it('FeatureGuard.canActivate', async () => {
      const guard = new FeatureGuard(
        { get: () => 'container_scanning' } as unknown as Reflector,
        entitlements,
        gm,
        new ProjectOrgResolver(gm),
      );
      guard.onModuleInit();
      const req = { params: { projectId: 'p1' }, user: { sub: 'u1' } };

      await guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as unknown as ExecutionContext);

      expect(spanNames()).toContain('FeatureGuard.canActivate');
    });
  });
});

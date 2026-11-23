import { Controller } from '@nestjs/common';
import { Span } from 'nestjs-otel';
import { Logger } from 'nestjs-pino';
import {
  IntegrationsAdminServiceController,
  IntegrationsAdminServiceControllerMethods,
} from '@grpc/external-integrations/external_integrations';
import {
  CountIntegrationsForOrgRequest,
  CountIntegrationsForOrgResponse,
  DeleteIntegrationsForOrgRequest,
  DeleteIntegrationsForOrgResponse,
} from '@grpc/external-integrations/external_integrations';
import { IntegrationsAdminService } from './integrations-admin.service';

@Controller()
@IntegrationsAdminServiceControllerMethods()
export class IntegrationsAdminController implements IntegrationsAdminServiceController {
  constructor(
    private readonly svc: IntegrationsAdminService,
    private readonly logger: Logger,
  ) {}

  @Span()
  async countIntegrationsForOrg(
    request: CountIntegrationsForOrgRequest,
  ): Promise<CountIntegrationsForOrgResponse> {
    const count = await this.svc.countIntegrationsForOrg(
      request.organizationId,
      request.type,
    );
    return { count };
  }

  @Span()
  async deleteIntegrationsForOrg(
    request: DeleteIntegrationsForOrgRequest,
  ): Promise<DeleteIntegrationsForOrgResponse> {
    const counts = await this.svc.deleteIntegrationsForOrg(
      request.organizationId,
      request.types || [],
    );
    return { deletedCounts: counts };
  }
}

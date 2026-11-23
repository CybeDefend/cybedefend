// src/core/secrets/secret-rotation.controller.ts
import { Controller } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import {
  RotationRequest,
  RotationResponse,
} from '@grpc/secret-rotation/secret_rotation';
import SecretsService from './secrets.service';
import {
  ExternalIntegrationsSecretRotationController,
  ExternalIntegrationsSecretRotationControllerMethods,
} from '@grpc/external-integrations/external_integrations';

@Controller()
@ExternalIntegrationsSecretRotationControllerMethods()
export class SecretRotationController implements ExternalIntegrationsSecretRotationController {
  private readonly projectName = 'external-integrations-service';

  constructor(
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
  ) {}

  async notifyRotation(data: RotationRequest): Promise<RotationResponse> {
    this.logger.log(
      `SecretRotationController.notifyRotation called for project "${data.projectName}" with environment "${data.environment}"`,
    );

    if (data.projectName !== this.projectName) {
      this.logger.warn(
        `Bad project name in notifyRotation: expected "${this.projectName}", got "${data.projectName}" skipping rotation`,
      );
      return {};
    }

    try {
      await this.secretsService.handleRotationEvent();
      this.logger.log('Secrets cache refreshed successfully.');
    } catch (err) {
      this.logger.error('Error refreshing secrets cache:', err);
      throw err;
    }

    return {};
  }
}

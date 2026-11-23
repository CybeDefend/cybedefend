// src/core/secrets/secret-rotation.controller.ts
import { Controller } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import SecretsService from './secrets.service';
import { GrpcMethod } from '@nestjs/microservices';

/**
 * Controller for handling secret rotation notifications via gRPC.
 */
@Controller()
export class SecretRotationController {
  private readonly projectName = 'policy-management-service';

  constructor(
    private readonly secretsService: SecretsService,
    private readonly logger: Logger,
  ) {}

  /**
   * Handles secret rotation notification from the secret rotation service.
   * @param data - Rotation request containing project name and environment
   */
  @GrpcMethod('PolicyManagementSecretRotation', 'NotifyRotation')
  async notifyRotation(data: {
    projectName: string;
    environment: string;
  }): Promise<Record<string, never>> {
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

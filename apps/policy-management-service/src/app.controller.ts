import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

/**
 * Health check controller for the Policy Management Service.
 * Provides basic health status endpoint for Kubernetes probes.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Health check endpoint.
   * @returns Health status message
   */
  @Get('health')
  getHealth(): string {
    return this.appService.getHealth();
  }
}

import { Injectable } from '@nestjs/common';

/**
 * Root application service for Policy Management.
 * Provides health check functionality.
 */
@Injectable()
export class AppService {
  /**
   * Returns the health status of the service.
   * @returns Health status message
   */
  getHealth(): string {
    return 'Policy Management Service is healthy';
  }
}

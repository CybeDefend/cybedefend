import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Optional Bearer-token guard for GET /internal/queue-metrics.
 *
 *  - QUEUE_METRICS_TOKEN unset/empty → allow all (cluster-internal network
 *    isolation is the baseline for the in-cluster KEDA scraper).
 *  - QUEUE_METRICS_TOKEN set → require `Authorization: Bearer <token>`.
 *
 * Read at call time so the token can be rotated by restarting the process.
 */
@Injectable()
export class QueueMetricsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredToken = process.env.QUEUE_METRICS_TOKEN;

    if (!configuredToken) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Missing or malformed Authorization header',
      );
    }

    const providedToken = authHeader.slice('Bearer '.length);
    if (providedToken !== configuredToken) {
      throw new UnauthorizedException('Invalid queue metrics token');
    }

    return true;
  }
}

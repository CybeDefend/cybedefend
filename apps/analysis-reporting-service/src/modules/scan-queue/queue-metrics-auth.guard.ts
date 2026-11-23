import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Optional Bearer-token guard for the /internal/queue-metrics endpoint.
 *
 * Behaviour:
 *  - If the env var QUEUE_METRICS_TOKEN is unset or empty → allow all requests
 *    (internal network isolation is the baseline for cluster-internal KEDA scrapers).
 *  - If QUEUE_METRICS_TOKEN is set → require the incoming request to carry
 *    `Authorization: Bearer <token>` matching the configured value.
 *    Any mismatch or absent header results in 401 Unauthorized.
 *
 * The token is read at call time (not cached at module init) so the process can
 * be restarted to rotate the secret without a code change.
 */
@Injectable()
export class QueueMetricsAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredToken = process.env.QUEUE_METRICS_TOKEN;

    // Guard is a no-op when the token env var is not configured.
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

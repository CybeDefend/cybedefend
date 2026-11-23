import { Injectable, NestMiddleware } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Middleware that rejects any request that still uses the legacy `Api-Key` header.
 * API keys have been fully deprecated — users must authenticate with a
 * Personal Access Token (PAT) using a standard Bearer token instead.
 */
@Injectable()
export class DeprecatedApiKeyMiddleware implements NestMiddleware {
  use(req: FastifyRequest['raw'], res: FastifyReply['raw'], next: () => void) {
    const headers = req.headers as Record<
      string,
      string | string[] | undefined
    >;

    if (headers['x-api-key']) {
      res.statusCode = 410;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          statusCode: 410,
          error: 'Gone',
          message:
            'API keys are no longer supported and have been fully deprecated. ' +
            'Please use a Personal Access Token (PAT) instead. ' +
            'You can create a PAT directly from your account settings.',
          deprecatedHeader: 'X-Api-Key',
          migration: {
            authMethod: 'Bearer token',
            headerFormat: 'Authorization: Bearer <your-PAT>',
            createTokenAt: 'Account Settings → Personal Access Tokens',
          },
        }),
      );
      return;
    }

    next();
  }
}

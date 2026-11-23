import { Controller, Get, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { GetJwksResponse } from '@grpc/global-management/local_auth';
import { LocalAuthService } from './local-auth.service';

/**
 * The public keys of the Community access tokens (ES256), for any party that
 * verifies them itself. Cached 10 minutes, like the gateway's own copy.
 */
@ApiTags('Auth')
@Controller('.well-known')
export class JwksController {
  constructor(private readonly localAuth: LocalAuthService) {}

  @Get('jwks.json')
  @ApiOperation({ summary: 'The JSON Web Key Set of the access tokens' })
  @ApiOkResponse({ description: '{ keys: JWK[] }' })
  async jwks(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<GetJwksResponse> {
    // A refusal is never cached; only a key set is.
    reply.header('Cache-Control', 'no-store');
    const { keys } = await this.localAuth.getJwks();
    reply.header('Cache-Control', 'public, max-age=600');
    return { keys: keys ?? [] };
  }
}

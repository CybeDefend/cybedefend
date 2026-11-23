import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Span } from 'nestjs-otel';
import { GithubService } from './github/github.service';
import { GitlabService } from './gitlab/gitlab.service';
import { JiraService } from './jira/jira.service';
import { LinearService } from './linear/linear.service';
import { WebhookResponse } from '@grpc/external-integrations/github';
import { GitlabWebhookResponse } from '@grpc/external-integrations/gitlab';
import { JiraWebhookResponse } from '@grpc/external-integrations/jira';
import { LinearWebhookResponse } from '@grpc/external-integrations/linear';

import { FastifyRequest } from 'fastify';

interface RequestWithRawBody extends FastifyRequest {
  rawBody?: Buffer;
}

/**
 * The raw JSON body of a signed provider delivery. GitHub and GitLab send
 * JSON; any other content type, or no body, leaves no raw body to verify,
 * so the request is refused with a 400 before anything is relayed.
 */
function signedJsonBody(req: RequestWithRawBody): string {
  if (!req.rawBody || req.rawBody.length === 0) {
    throw new BadRequestException('A JSON request body is required');
  }
  return req.rawBody.toString('utf-8');
}

/**
 * Public provider webhooks: no user JWT and no CombinedAuthRateLimitGuard.
 * Each route authenticates its provider by signature or shared token, here or
 * in the service it relays to.
 */
@ApiExcludeController()
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly githubService: GithubService,
    private readonly gitlabService: GitlabService,
    private readonly jiraService: JiraService,
    private readonly linearService: LinearService,
  ) {}

  /**
   * Handle Github webhook
   *
   * @param req Request HTTP
   * @param signature Signature
   * @returns Webhook response
   */
  @Span()
  @Post('github')
  handleGithubWebhook(
    @Req() req: RequestWithRawBody,
    @Headers('x-hub-signature-256') signature: string,
  ): Promise<WebhookResponse> {
    if (req.headers['x-github-event'] === undefined) {
      throw new BadRequestException('Missing x-github-event header');
    }
    const bodyString = signedJsonBody(req);
    return this.githubService.handleWebhookEvent({
      bodyJson: bodyString,
      event: req.headers['x-github-event'] as string,
      action: (req.body as { action?: string } | undefined)?.action,
      signature: signature,
    });
  }

  /**
   * Handle GitLab webhook
   *
   * @param req Request HTTP
   * @param event The event type from the 'X-Gitlab-Event' header
   * @param token The secret token from the 'X-Gitlab-Token' header
   * @returns Webhook response
   */
  @Span()
  @Post('gitlab')
  handleGitlabWebhook(
    @Req() req: RequestWithRawBody,
    @Headers('x-gitlab-event') event: string,
    @Headers('x-gitlab-token') token: string,
  ): Promise<GitlabWebhookResponse> {
    if (!event) {
      throw new BadRequestException('Missing X-Gitlab-Event header');
    }
    if (!token) {
      throw new UnauthorizedException('Missing X-Gitlab-Token header');
    }

    const bodyString = signedJsonBody(req);

    return this.gitlabService.handleWebhookEvent({
      bodyJson: bodyString,
      event: event,
      gitlabToken: token,
    });
  }

  /**
   * Handle Jira webhook
   *
   * Jira webhooks don't use HMAC signatures like GitHub.
   * Authentication is handled via a secret token in the webhook URL path.
   */
  @Span()
  @Post('jira/:token')
  async handleJiraWebhook(
    @Req() req: RequestWithRawBody,
    @Param('token') token: string,
  ): Promise<JiraWebhookResponse> {
    const bodyString = (req as any).rawBody
      ? (req as any).rawBody.toString('utf-8')
      : JSON.stringify(req.body || {});

    return this.jiraService.handleWebhook({
      rawBody: bodyString,
      secret: token || '',
    });
  }

  /**
   * Handle Linear webhook
   *
   * Linear signs the raw body (HMAC-SHA256, `linear-signature` header). The
   * signature and the delivery timestamp are verified in external-integrations,
   * which holds the secret: the gateway forwards the body exactly as received
   * and never re-serialises it.
   *
   * Answers 200, not Nest's default 201 for a POST: Linear treats any answer
   * other than 200 as a failed delivery, retries it, and disables the webhook
   * after repeated failures.
   */
  @Span()
  @Post('linear')
  @HttpCode(HttpStatus.OK)
  handleLinearWebhook(
    @Req() req: RequestWithRawBody,
    @Headers('linear-signature') signature: string,
  ): Promise<LinearWebhookResponse> {
    return this.linearService.handleWebhook({
      // No body (a forged or malformed POST) is not a 500 of ours: the empty
      // string fails the signature check in external-integrations.
      rawBody: req.rawBody?.toString('utf-8') ?? '',
      signature: signature ?? '',
    });
  }
}

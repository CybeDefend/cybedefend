import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  communityAppUrl,
  publicAppUrl,
} from '../../core/config/public-app-url';
import type { ProductLinksPort } from '../ports/product-links.port';

/**
 * A self-hosted instance links to its own dashboard. The ticket footer links
 * only to an address the operator set, as an http(s) URL: a ticket lives in
 * an external tracker, where a default local address would be a dead link.
 */
@Injectable()
export class CommunityProductLinks implements ProductLinksPort {
  private readonly logger = new Logger(CommunityProductLinks.name);

  constructor(private readonly config: Pick<ConfigService, 'get'>) {}

  ticketFooterUrl(): string | undefined {
    const url = publicAppUrl(this.config)?.trim();
    return url && isHttpUrl(url) ? url : undefined;
  }

  githubInstallReturnUri(): string {
    return communityAppUrl(this.config, this.logger);
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') && !!url.host
    );
  } catch {
    return false;
  }
}

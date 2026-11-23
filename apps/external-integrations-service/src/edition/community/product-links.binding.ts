import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PRODUCT_LINKS_PORT } from '../ports/product-links.port';
import { CommunityProductLinks } from './product-links.community';

// The edition module is global and may be compiled without the configuration
// module (a context or a test that does not import it): the process
// environment, which the configuration module reads too, is then the source.
const processEnv = { get: (key: string) => process.env[key] };

export const PRODUCT_LINKS_COMMUNITY_BINDINGS: Provider[] = [
  {
    provide: PRODUCT_LINKS_PORT,
    useFactory: (config?: ConfigService) =>
      new CommunityProductLinks(config ?? processEnv),
    inject: [{ token: ConfigService, optional: true }],
  },
];

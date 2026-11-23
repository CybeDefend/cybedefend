import {
  type ConfigReader,
  type WarnLogger,
  resolveConfiguredFrontendUrl,
} from '../../core/utils/frontend-url.util';

/**
 * Edition port: the base URL of every dashboard link this service builds
 * (issue tickets, report and export deep links). The Community Edition binds
 * the configured resolution (CONFIGURED_FRONTEND_URL_RESOLVER: the
 * instance's FRONTEND_URL); a closed extension may bind another one.
 */
export const FRONTEND_URL_RESOLVER = 'FRONTEND_URL_RESOLVER';

export interface FrontendUrlResolver {
  resolve(config: ConfigReader, logger: WarnLogger): string;
}

/** The instance's own FRONTEND_URL, whatever the edition. */
export const CONFIGURED_FRONTEND_URL_RESOLVER: FrontendUrlResolver = {
  resolve: (config, logger) => resolveConfiguredFrontendUrl(config, logger),
};

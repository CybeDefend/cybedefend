import { EDITION } from '@/edition/edition';

/**
 * The sentences of the empty lists that speak as Cybe in the cloud. Cybe is the
 * cloud's AI agent: the Community Edition says the same thing without
 * promising that an agent starts working or keeps monitoring.
 */
export const EMPTY_STATE_COPY =
  EDITION === 'community'
    ? { noProject: 'components.emptyState.noProject', noVuln: 'components.emptyState.noVuln' }
    : { noProject: 'components.cybe.emptyState.noProject', noVuln: 'components.cybe.emptyState.noVuln' };

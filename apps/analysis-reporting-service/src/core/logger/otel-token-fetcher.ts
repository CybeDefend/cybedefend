import { isCommunityEdition } from '../../edition/edition';
import { EE_OTEL_INGEST_TOKEN_SOURCE } from '../../edition/ee-observability';

/**
 * The token the OTLP backend expects on logs and traces, read before Nest
 * boots. The environment wins; the Community Edition reads nothing else, and
 * another edition may fall back to a closed extension.
 */
export async function fetchOtelIngestToken(): Promise<string | undefined> {
  const fromEnvironment = process.env.OTEL_INGEST_TOKEN;
  if (fromEnvironment) return fromEnvironment;
  if (isCommunityEdition() || !EE_OTEL_INGEST_TOKEN_SOURCE) return undefined;
  return EE_OTEL_INGEST_TOKEN_SOURCE();
}

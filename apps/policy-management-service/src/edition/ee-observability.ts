// Community Edition: the OTLP ingest token, if any, comes from the environment; no other source exists in this tree.
import type { OtelIngestTokenSource } from './ports/otel-ingest-token.port';

export const EE_OTEL_INGEST_TOKEN_SOURCE: OtelIngestTokenSource | null = null;

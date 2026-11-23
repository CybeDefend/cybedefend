/**
 * Where an edition finds the OTLP ingest token when the environment holds
 * none. Read before Nest boots (tracer and logger), so it is a plain function,
 * not a Nest provider.
 */
export type OtelIngestTokenSource = () => Promise<string | undefined>;

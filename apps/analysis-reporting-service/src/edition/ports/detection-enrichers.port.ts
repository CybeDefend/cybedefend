/**
 * Extension token: the enrichers ScaService runs,
 * fire-and-forget, on the detections a scanner batch touched. Its value is a
 * DetectionEnricher[]. Only an ee module supplies it (EPSS); when the token
 * is absent — the Community Edition — no enrichment runs.
 */
export const DETECTION_ENRICHERS = 'DETECTION_ENRICHERS';

export interface DetectionEnricher {
  name: string;
  enrichDetections(input: { detectionIds: string[] }): Promise<unknown>;
}

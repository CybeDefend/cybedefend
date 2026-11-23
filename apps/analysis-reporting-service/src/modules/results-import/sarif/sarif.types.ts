/**
 * The SARIF 2.1.0 shapes the import reads. Only the fields the
 * reader and the mapper use are declared; everything else in a file is
 * carried through the stream parser untouched and dropped here.
 */

export interface SarifArtifactLocation {
  uri?: string;
  uriBaseId?: string;
  index?: number;
}

export interface SarifRegion {
  startLine?: number;
  endLine?: number;
  snippet?: { text?: string };
}

export interface SarifPhysicalLocation {
  artifactLocation?: SarifArtifactLocation;
  region?: SarifRegion;
}

export interface SarifLocation {
  physicalLocation?: SarifPhysicalLocation;
}

export interface SarifSuppression {
  kind?: string;
  status?: string;
  justification?: string;
}

export interface SarifRule {
  id?: string;
  name?: string;
  deprecatedIds?: string[];
  shortDescription?: { text?: string };
  fullDescription?: { text?: string };
  help?: { text?: string; markdown?: string };
  helpUri?: string;
  defaultConfiguration?: { level?: string };
  properties?: Record<string, unknown>;
}

export interface SarifToolComponent {
  name?: string;
  rules?: SarifRule[];
}

export interface SarifTool {
  driver: SarifToolComponent;
  extensions?: SarifToolComponent[];
}

export interface SarifResult {
  ruleId?: string;
  ruleIndex?: number;
  rule?: { id?: string; index?: number; toolComponent?: { index?: number } };
  kind?: string;
  level?: string;
  message?: { text?: string };
  locations?: SarifLocation[];
  suppressions?: SarifSuppression[];
  properties?: Record<string, unknown>;
}

export interface SarifArtifact {
  location?: SarifArtifactLocation;
}

export interface SarifRun {
  tool?: SarifTool;
  originalUriBaseIds?: Record<string, SarifArtifactLocation>;
  artifacts?: SarifArtifact[];
  results?: SarifResult[];
}

export interface SarifLog {
  version?: string;
  runs?: SarifRun[];
}

/**
 * What pass 1 assembles per run: the tool, the base URIs and the artifact
 * locations, plus the number of results (counted, never assembled, so the
 * heap stays bounded at 100,000 results).
 */
export interface SarifRunHeader {
  index: number;
  tool: SarifTool;
  originalUriBaseIds: Record<string, SarifArtifactLocation>;
  artifacts: SarifArtifactLocation[];
  resultCount: number;
  /**
   * `runs[i].properties.imageID` when it is a string (Trivy's image id, read
   * by the container import). Nothing else of `run.properties` is
   * kept.
   */
  imageId?: string;
}

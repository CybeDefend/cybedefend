// Public Container Scan (Docker Hub public images, no credentials needed)
export interface StartPublicContainerScanBodyDto {
  imageToScan: string;       // Public image to scan (ex: "alpine:latest", "node:18-alpine")
  branch?: string;           // Optional - Branch name for tracking
  vulnerabilityTypes?: string[]; // Optional - Filter by severity (ex: ["CRITICAL", "HIGH"])
  sourceType?: string;       // Optional - Source of scan: "manual" (default), "cli", "github", "gitlab"
}

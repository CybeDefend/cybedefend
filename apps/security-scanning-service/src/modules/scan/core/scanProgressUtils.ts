import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Logger } from 'nestjs-pino';
import { Scan } from '../../../entities/scan.entity';
import { Span } from 'nestjs-otel';
import { Container } from '../../../entities/container.entity';
import { Scanner, ScannerType } from '../../../entities/scanner.entity';
import { anyValue, diffSeconds } from '@cybedefend/db-dialect';

/**
 * Cache of the historical durations per project/scanType.
 * Avoids querying the DB on every progress computation.
 * TTL: 10 minutes
 */
interface HistoricalDurationsCache {
  durations: Record<string, number>;
  timestamp: number;
}

/**
 * Per-pod cache of the fixed inputs of a scan's progress: the historical
 * durations, the expected scanners (fixed at the first call) and a floor
 * from the completed containers. The highest progress served is NOT kept
 * here: it is `scan.progressHighWater`, shared by every pod.
 */
interface ScanProgressCache {
  baselineProgress: number;
  historicalDurations: Record<string, number> | null;
  expectedScannerWeights: Record<string, number>; // Scanner name -> weight
  timestamp: number;
}

const historicalCache = new Map<string, HistoricalDurationsCache>();
const scanProgressCache = new Map<string, ScanProgressCache>(); // Cache per scanId
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SCAN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (longest duration of a scan)
const MAX_CACHE_ENTRIES = 20000; // ~ 8.8 MB
const MAX_SCAN_CACHE_ENTRIES = 5000; // Active scans

/**
 * Weight of each scanner type in the progress computation, from typical
 * scan durations:
 * - SCA: very fast
 * - SAST: medium to long
 * - IAC-KICS: highly variable
 * - IAC-Checkov: medium
 * - Container: depends on the image
 * - Agent: highly variable, depends on the number of vulnerabilities
 */
export const SCANNER_WEIGHTS: Record<string, number> = {
  sast: 2.0, // SAST medium to long
  'sast-opengrep': 2.0,
  sca: 0.5, // SCA very fast
  secrets: 0.8, // Secret detection (fast)
  'iac-kics': 3.0, // IAC-KICS can be very long
  'iac-checkov': 1.5, // IAC-Checkov medium
  iac: 2.0, // Generic IAC (average of the two)
  container: 1.5, // Container scanning
  agent: 2.5, // Agent: varies with the number of vulnerabilities
  aibom: 2.5, // AI-BOM: classification calls, variable duration
  default: 1.5,
};

/**
 * Expected duration of each scanner type, in milliseconds, for an average
 * project.
 */
export const EXPECTED_DURATIONS: Record<string, number> = {
  sast: 90 * 1000, // 90 seconds
  'sast-opengrep': 90 * 1000,
  sca: 20 * 1000, // 20 seconds
  secrets: 30 * 1000, // 30 seconds
  'iac-kics': 120 * 1000, // 2 minutes (average, can be much longer)
  'iac-checkov': 60 * 1000, // 1 minute
  iac: 90 * 1000, // 1.5 minutes (average)
  container: 45 * 1000, // 45 seconds
  agent: 180 * 1000, // 3 minutes (highly variable)
  aibom: 180 * 1000, // 3 minutes (classification, variable)
  default: 60 * 1000, // 1 minute
};

/**
 * Progress per scanner step.
 * Each step has a [min, max] progress range.
 * Progress within the range follows the elapsed time.
 */
const STEP_RANGES: Record<string, { min: number; max: number }> = {
  // Fast steps (fixed progress)
  initializing: { min: 0.02, max: 0.05 },
  starting: { min: 0.05, max: 0.08 },
  downloading: { min: 0.08, max: 0.15 },
  cloning: { min: 0.08, max: 0.15 },
  'downloading code': { min: 0.08, max: 0.15 },

  // Medium steps
  preparing: { min: 0.15, max: 0.2 },

  // LONG steps (the scan itself) - wide range
  analyzing: { min: 0.2, max: 0.75 },
  scanning: { min: 0.2, max: 0.75 },
  'agent: parsing in progress': { min: 0.15, max: 0.7 },

  // Post-scan steps
  processing: { min: 0.75, max: 0.85 },
  uploading: { min: 0.85, max: 0.92 },
  parsing: { min: 0.85, max: 0.95 },
  finalizing: { min: 0.95, max: 0.98 },

  // Done
  completed: { min: 1.0, max: 1.0 },
  'scan completed': { min: 1.0, max: 1.0 },
  'sca scan completed': { min: 1.0, max: 1.0 },
  failed: { min: 1.0, max: 1.0 },
};

// Fallback for unknown steps
const DEFAULT_STEP_RANGE = { min: 0.2, max: 0.8 };

@Injectable()
export class ScanProgressUtils {
  constructor(
    @InjectRepository(Scan)
    private readonly scanRepository: Repository<Scan>,
    @InjectRepository(Container)
    private readonly containerRepository: Repository<Container>,
    @InjectRepository(Scanner)
    private readonly scannerRepository: Repository<Scanner>,
    private readonly logger: Logger,
  ) {}

  /**
   * Calculate the scan progress based on container states and scanner types.
   * GUARANTEES monotonic progression (never decreases).
   *
   * Uses a hybrid approach:
   * 1. Primary: Container-based progress (actual scanner status)
   * 2. Secondary: Historical data for time estimation (fixed per scan)
   * 3. Monotonic: Never returns less than previously calculated progress
   *
   * @param scan The scan to calculate the progress for.
   * @returns The scan progress as a percentage (0-100).
   */
  @Span()
  async calculateScanProgress(scan: Scan): Promise<number> {
    // Terminal states return 100% and cleanup cache
    if (
      scan.state === 'completed' ||
      scan.state === 'failed' ||
      scan.state === 'completed_degraded'
    ) {
      this.clearScanProgressCache(scan.id);
      return 100;
    }

    // Queued state returns 0%
    if (scan.state === 'queued' || scan.state === 'waiting_for_file') {
      return 0;
    }

    try {
      // The containers with their scanner relation. getScan loads them with
      // the scan in one query: reading them again here was a second SELECT
      // on every GetScan of a running scan.
      const containers =
        scan.containers ??
        (await this.containerRepository.find({
          where: { scanId: scan.id },
          relations: ['scanner'],
        }));

      // Get or initialize scan progress cache (ensures consistency)
      const scanCache = await this.getOrInitScanProgressCache(scan, containers);

      // No containers yet = early stage
      if (containers.length === 0) {
        const earlyProgress = this.calculateEarlyStageProgress(scan);
        return await this.ensureMonotonicProgress(
          scan,
          Math.max(earlyProgress, scanCache.baselineProgress),
        );
      }

      // Calculate container-based progress using the FIXED cache
      const containerProgress = this.calculateContainerBasedProgress(
        containers,
        scan,
        scanCache,
      );

      // Ensure monotonic progression (never decreases)
      const finalProgress = await this.ensureMonotonicProgress(
        scan,
        Math.max(containerProgress, scanCache.baselineProgress),
      );

      return finalProgress;
    } catch (error) {
      this.logger.error(
        `Error calculating scan progress for ${scan.id}: ${error}`,
      );
      // Even fallback must be monotonic
      const fallback = this.calculateFallbackProgress(scan);
      return Math.max(scan.progressHighWater ?? 0, Math.min(fallback, 99));
    }
  }

  /**
   * Get or initialize scan progress cache.
   * Fixes historical durations AND expected scanners at first call for consistent progress calculation.
   * On cache miss/reset, computes a minimum baseline from completed containers to ensure monotonic progress.
   */
  private async getOrInitScanProgressCache(
    scan: Scan,
    containers: Container[],
  ): Promise<ScanProgressCache> {
    const existing = scanProgressCache.get(scan.id);

    if (existing && Date.now() - existing.timestamp < SCAN_CACHE_TTL_MS) {
      return existing;
    }

    // First time for this scan (or cache expired/service restart)
    // Fetch and FIX:
    // 1. Historical durations
    // 2. Expected scanners from DB
    const [historicalDurations, expectedScannerWeights] = await Promise.all([
      this.fetchHistoricalDurations(scan),
      this.fetchExpectedScannerWeights(scan),
    ]);

    // Calculate baseline progress from completed containers
    // This ensures progress never regresses after service restart
    const baselineProgress =
      this.calculateCompletedContainersBaseline(containers);

    const newCache: ScanProgressCache = {
      baselineProgress,
      historicalDurations,
      expectedScannerWeights,
      timestamp: Date.now(),
    };

    scanProgressCache.set(scan.id, newCache);

    // Cleanup old scan caches if too many
    if (scanProgressCache.size > MAX_SCAN_CACHE_ENTRIES) {
      this.cleanupScanProgressCache();
    }

    return newCache;
  }

  /**
   * Calculate baseline progress based on completed containers only.
   * This provides a minimum guaranteed progress that won't regress.
   */
  private calculateCompletedContainersBaseline(
    containers: Container[],
  ): number {
    try {
      if (containers.length === 0) {
        return 0;
      }

      let totalWeight = 0;
      let completedWeight = 0;

      for (const container of containers) {
        const scannerType = this.getScannerType(container);
        const weight = SCANNER_WEIGHTS[scannerType] || SCANNER_WEIGHTS.default;
        totalWeight += weight;

        const status = container.status?.toLowerCase() || '';
        const isCompleted =
          status === 'completed' ||
          status === 'completed_degraded' ||
          status === 'parsing_completed' ||
          status === 'failed' ||
          status === 'error';

        if (isCompleted) {
          completedWeight += weight;
        }
      }

      if (totalWeight === 0) {
        return 0;
      }

      // Return the minimum progress based on completed containers only
      // Cap at 95% to leave room for final calculations
      return Math.min(Math.round((completedWeight / totalWeight) * 100), 95);
    } catch {
      return 0;
    }
  }

  /**
   * Fetch expected scanner weights from the database.
   * Returns a map of scanner name -> weight for all enabled scanners matching the scan types.
   */
  private async fetchExpectedScannerWeights(
    scan: Scan,
  ): Promise<Record<string, number>> {
    const weights: Record<string, number> = {};

    if (!scan.scanType) {
      // No scan type specified, add default agent weight
      weights['agent'] = SCANNER_WEIGHTS['agent'] || SCANNER_WEIGHTS.default;
      return weights;
    }

    // Reuse the union exported by scanner.entity.ts so a future scanner
    // type only needs to be added in one place (ScannerTypeValues).
    const scanTypes = scan.scanType
      .split(',')
      .map((t) => t.trim().toLowerCase()) as Array<ScannerType>;

    try {
      // Fetch all enabled scanners for the requested scan types
      const scanners = await this.scannerRepository.find({
        where: {
          enabled: true,
          scannerType: In(scanTypes),
        },
        select: ['name', 'imageName', 'scannerType'],
      });

      for (const scanner of scanners) {
        // Determine the weight based on scanner name/image
        const scannerKey = this.getScannerTypeFromImage(
          scanner.imageName || scanner.name,
        );
        const weight = SCANNER_WEIGHTS[scannerKey] || SCANNER_WEIGHTS.default;
        weights[scanner.name] = weight;
      }

      // Always add agent for parsing
      weights['agent'] = SCANNER_WEIGHTS['agent'] || SCANNER_WEIGHTS.default;

      this.logger.debug(
        `Expected scanners for scan ${scan.id}: ${JSON.stringify(weights)}`,
      );
    } catch (error) {
      this.logger.debug(`Could not fetch expected scanners: ${error.message}`);
      // Fallback: add agent only
      weights['agent'] = SCANNER_WEIGHTS['agent'] || SCANNER_WEIGHTS.default;
    }

    return weights;
  }

  /**
   * Ensure progress never decreases, whichever pod answers.
   * The maximum served is stored on the scan row (`progressHighWater`): a
   * per-pod maximum made a polled progress oscillate between replicas. The
   * row is only written when the value rises, by a conditional UPDATE
   * (`progressHighWater < :p`), so two pods racing never lower it. A failed
   * write never fails the read: the computed value is returned.
   */
  private async ensureMonotonicProgress(
    scan: Scan,
    calculatedProgress: number,
  ): Promise<number> {
    const clampedProgress = Math.max(
      1,
      Math.min(Math.round(calculatedProgress), 99),
    );
    const stored = scan.progressHighWater ?? 0;

    if (clampedProgress <= stored) {
      return stored;
    }

    try {
      const result = await this.scanRepository
        .createQueryBuilder()
        .update(Scan)
        .set({ progressHighWater: clampedProgress })
        .where('id = :id', { id: scan.id })
        .andWhere('progressHighWater < :p', { p: clampedProgress })
        .execute();
      if (result.affected === 0) {
        // Another pod stored a value at least as high since this scan was
        // loaded: answer that one, never a lower one.
        const current = await this.scanRepository.findOne({
          select: ['id', 'progressHighWater'],
          where: { id: scan.id },
        });
        return Math.max(clampedProgress, current?.progressHighWater ?? 0);
      }
    } catch (error) {
      this.logger.warn(
        `Could not store the progress high-water of scan ${scan.id}: ${error}`,
      );
    }

    return clampedProgress;
  }

  /**
   * Clear scan progress cache when scan completes.
   */
  private clearScanProgressCache(scanId: string): void {
    scanProgressCache.delete(scanId);
  }

  /**
   * Cleanup old scan progress caches.
   */
  private cleanupScanProgressCache(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    for (const [key, value] of scanProgressCache.entries()) {
      if (now - value.timestamp > SCAN_CACHE_TTL_MS) {
        entriesToDelete.push(key);
      }
    }

    entriesToDelete.forEach((key) => scanProgressCache.delete(key));

    // If still too large, delete oldest entries
    if (scanProgressCache.size > MAX_SCAN_CACHE_ENTRIES) {
      const entries = Array.from(scanProgressCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(
        0,
        scanProgressCache.size - MAX_SCAN_CACHE_ENTRIES,
      );
      toDelete.forEach(([key]) => scanProgressCache.delete(key));
    }
  }

  /**
   * Calculate progress based on container statuses and weights.
   * Takes into account EXPECTED containers from DB, not just existing ones.
   * This prevents the progress from jumping to 50% when only one container exists.
   */
  @Span()
  private calculateContainerBasedProgress(
    containers: Container[],
    scan: Scan,
    scanCache: ScanProgressCache,
  ): number {
    const existingScannerNames = new Set<string>();

    let totalWeight = 0;
    let completedWeight = 0;

    // Process existing containers
    for (const container of containers) {
      const scannerType = this.getScannerType(container);
      const scannerName = container.scanner?.name || scannerType;
      existingScannerNames.add(scannerName);

      const weight = SCANNER_WEIGHTS[scannerType] || SCANNER_WEIGHTS.default;
      totalWeight += weight;

      const containerProgress = this.getContainerProgress(
        container,
        scanCache.historicalDurations,
      );
      completedWeight += weight * containerProgress;
    }

    // Add weight for MISSING expected scanners (at 0% progress)
    // Uses the FIXED expectedScannerWeights from cache
    for (const [scannerName, weight] of Object.entries(
      scanCache.expectedScannerWeights,
    )) {
      if (!existingScannerNames.has(scannerName)) {
        totalWeight += weight;
        // completedWeight stays the same (0% for missing containers)
      }
    }

    if (totalWeight === 0) {
      return 5; // Default early progress
    }

    // Base progress from container completion
    const baseProgress = (completedWeight / totalWeight) * 100;

    // Apply scan type adjustment
    const scanTypeAdjustment = this.getScanTypeAdjustment(scan);

    return baseProgress * scanTypeAdjustment;
  }

  /**
   * Get the progress of a single container (0.0 to 1.0).
   * Uses step ranges and time-based progression for smooth, realistic progress.
   * @param container The container to evaluate
   * @param historicalDurations Optional historical durations from similar scans
   */
  private getContainerProgress(
    container: Container,
    historicalDurations?: Record<string, number> | null,
  ): number {
    const status = container.status?.toLowerCase() || 'unknown';

    // Terminal states
    if (
      status === 'completed' ||
      status === 'completed_degraded' ||
      status === 'parsing_completed'
    ) {
      return 1.0;
    }
    if (status === 'failed' || status === 'error') {
      return 1.0; // Failed containers are "done" for progress purposes
    }

    // Queued containers haven't started
    if (status === 'queued') {
      return 0.0;
    }

    // Starting containers
    if (status === 'starting') {
      return 0.05;
    }

    // Running containers - use step-based range with time progression
    if (status === 'running') {
      const step = container.step?.toLowerCase() || 'scanning';
      const stepRange = STEP_RANGES[step] || DEFAULT_STEP_RANGE;

      // If we have vulnerability progress info, use it (most accurate)
      if (
        container.totalVulnerabilities &&
        container.totalVulnerabilities > 0 &&
        container.processedVulnerabilities !== null &&
        container.processedVulnerabilities !== undefined
      ) {
        const vulnProgress =
          container.processedVulnerabilities / container.totalVulnerabilities;
        // Map vulnerability progress to step range
        return stepRange.min + vulnProgress * (stepRange.max - stepRange.min);
      }

      // Use time-based estimation within the step range
      if (container.startedAt) {
        const runningTimeMs = Date.now() - container.startedAt.getTime();
        const expectedRunningTimeMs = this.getExpectedRunningTimeWithHistory(
          container,
          historicalDurations,
        );

        // Time progress within this step (0 to 1, capped at 0.95 to avoid hitting max)
        const timeProgress = Math.min(
          runningTimeMs / expectedRunningTimeMs,
          0.95,
        );

        // Map time progress to step range
        return stepRange.min + timeProgress * (stepRange.max - stepRange.min);
      }

      // No timing info, return minimum for this step
      return stepRange.min;
    }

    // Unknown status - assume early progress
    return 0.1;
  }

  /**
   * Get expected running time for a container based on scanner type.
   * Uses historical data from similar scans if available, otherwise falls back to static values.
   * @param container The container to evaluate
   * @param historicalDurations Optional historical durations from similar scans
   */
  private getExpectedRunningTimeWithHistory(
    container: Container,
    historicalDurations?: Record<string, number> | null,
  ): number {
    const scannerType = this.getScannerType(container);

    // Try historical data first (with 1.2x buffer to avoid underestimating)
    if (historicalDurations && historicalDurations[scannerType]) {
      return historicalDurations[scannerType] * 1.2;
    }

    // Fallback to static EXPECTED_DURATIONS
    return EXPECTED_DURATIONS[scannerType] || EXPECTED_DURATIONS.default;
  }

  /**
   * Get expected running time for a container based on scanner type.
   * Values are calibrated from typical scan durations.
   * @deprecated Use getExpectedRunningTimeWithHistory instead
   */
  private getExpectedRunningTime(container: Container): number {
    const scannerType = this.getScannerType(container);

    // Use the global EXPECTED_DURATIONS constant
    return EXPECTED_DURATIONS[scannerType] || EXPECTED_DURATIONS.default;
  }

  /**
   * Determine scanner type from container info.
   * Detects specific scanner variants for accurate timing.
   */
  private getScannerType(container: Container): string {
    const nameLower = (
      container.scanner?.name ||
      container.image ||
      container.podName ||
      ''
    ).toLowerCase();

    // Check for specific scanner variants first (order matters)
    if (nameLower.includes('sast-opengrep') || nameLower.includes('opengrep')) {
      return 'sast-opengrep';
    }
    if (
      nameLower.includes('sast') ||
      nameLower.includes('semgrep') ||
      nameLower.includes('sonar')
    ) {
      return 'sast';
    }
    // AI-BOM must be checked before SCA: a scanner image name may contain
    // the substring "sca" elsewhere than in its scanner type.
    if (nameLower.includes('aibom')) {
      return 'aibom';
    }
    if (
      nameLower.includes('sca') ||
      nameLower.includes('dependency') ||
      nameLower.includes('osv')
    ) {
      return 'sca';
    }
    if (
      nameLower.includes('secret') ||
      nameLower.includes('gitleaks') ||
      nameLower.includes('trufflehog')
    ) {
      return 'secrets';
    }
    // Check specific IAC variants before generic IAC
    if (nameLower.includes('iac-kics') || nameLower.includes('kics')) {
      return 'iac-kics';
    }
    if (nameLower.includes('iac-checkov') || nameLower.includes('checkov')) {
      return 'iac-checkov';
    }
    if (nameLower.includes('iac') || nameLower.includes('terraform')) {
      return 'iac';
    }
    if (
      nameLower.includes('container') ||
      nameLower.includes('trivy') ||
      nameLower.includes('grype')
    ) {
      return 'container';
    }
    if (
      nameLower.includes('agent') ||
      nameLower.includes('parsing') ||
      nameLower.includes('parser')
    ) {
      return 'agent';
    }

    return 'default';
  }

  /**
   * Get scan type adjustment factor.
   * Some scan configurations are inherently faster/slower.
   */
  private getScanTypeAdjustment(scan: Scan): number {
    if (!scan.scanType) {
      return 1.0;
    }

    const scanTypes = scan.scanType
      .split(',')
      .map((t) => t.trim().toLowerCase());

    // More scan types = potentially longer total time
    // But progress should still be linear relative to container completion
    if (scanTypes.length > 3) {
      return 0.95; // Slightly slower perceived progress
    }
    if (scanTypes.length === 1) {
      return 1.05; // Slightly faster perceived progress
    }

    return 1.0;
  }

  /**
   * Calculate progress for early stage (no containers yet).
   */
  private calculateEarlyStageProgress(scan: Scan): number {
    if (!scan.startTime) {
      return 1;
    }

    const elapsedMs = Date.now() - scan.startTime.getTime();

    // First 30 seconds: 1-10%
    if (elapsedMs < 30000) {
      return Math.max(1, Math.floor((elapsedMs / 30000) * 10));
    }

    // Up to 2 minutes: 10-15%
    if (elapsedMs < 120000) {
      return 10 + Math.floor(((elapsedMs - 30000) / 90000) * 5);
    }

    // Beyond 2 minutes without containers = likely an issue, cap at 15%
    return 15;
  }

  /**
   * Fallback progress calculation when main method fails.
   */
  private calculateFallbackProgress(scan: Scan): number {
    if (!scan.startTime) {
      return 1;
    }

    const elapsedMs = Date.now() - scan.startTime.getTime();
    // Simple time-based: assume 10 minutes for a typical scan
    const expectedDuration = 10 * 60 * 1000;
    const progress = Math.floor((elapsedMs / expectedDuration) * 100);

    return Math.max(1, Math.min(progress, 95));
  }

  /**
   * Get expected running time for a container, using historical data if available.
   * Falls back to static EXPECTED_DURATIONS if no historical data exists.
   * @deprecated Use getExpectedRunningTimeWithHistory instead
   */
  private async getExpectedRunningTimeFromHistory(
    container: Container,
    scan: Scan,
  ): Promise<number> {
    const scannerType = this.getScannerType(container);

    // Try to get historical durations for this project/scanType combination
    const historicalDurations = await this.fetchHistoricalDurations(scan);

    if (historicalDurations && historicalDurations[scannerType]) {
      // Use historical average with some buffer (1.2x) to avoid underestimating
      return historicalDurations[scannerType] * 1.2;
    }

    // Fallback to static durations
    return EXPECTED_DURATIONS[scannerType] || EXPECTED_DURATIONS.default;
  }

  /**
   * Fetch historical scanner durations from similar completed scans.
   * Uses caching to avoid repeated DB queries.
   *
   * Strategy:
   * 1. First, look for scans from the same project
   * 2. If not enough data (<10 scans), supplement with similar projects
   *    (similar size/LOC, similar languages)
   * 3. Cache results for 10 minutes
   *
   * Performance: Uses SELECT with only needed columns, limits results,
   * and caches aggressively to minimize DB load.
   */
  private async fetchHistoricalDurations(
    scan: Scan,
  ): Promise<Record<string, number> | null> {
    const cacheKey = `${scan.projectId}:${scan.scanType || 'all'}`;

    // Check cache first - FAST PATH (no DB call)
    const cached = historicalCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return Object.keys(cached.durations).length > 0 ? cached.durations : null;
    }

    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Step 1: Find scans from the same project (SELECT only id)
      const projectScans = await this.scanRepository
        .createQueryBuilder('scan')
        .select(['scan.id'])
        .where('scan.projectId = :projectId', { projectId: scan.projectId })
        .andWhere('scan.state IN (:...states)', {
          states: ['completed', 'completed_degraded'],
        })
        .andWhere('scan.endTime IS NOT NULL')
        .andWhere('scan.endTime > :thirtyDaysAgo', { thirtyDaysAgo })
        .andWhere('scan.id != :currentId', { currentId: scan.id })
        .orderBy('scan.endTime', 'DESC')
        .limit(10)
        .getMany();

      let scanIds = projectScans.map((s) => s.id);

      // Step 2: If not enough data, find similar projects
      if (scanIds.length < 10) {
        const remaining = 10 - scanIds.length;
        const similarScanIds = await this.findSimilarProjectScanIds(
          scan,
          thirtyDaysAgo,
          remaining,
          scanIds,
        );
        scanIds = [...scanIds, ...similarScanIds];
      }

      if (scanIds.length === 0) {
        // No similar scans found, cache empty result
        this.setCacheEntry(cacheKey, {});
        return null;
      }

      // Get container durations directly with optimized query
      const avgDurations =
        await this.calculateAverageDurationsOptimized(scanIds);

      // Cache the result
      this.setCacheEntry(cacheKey, avgDurations);

      if (Object.keys(avgDurations).length > 0) {
        this.logger.debug(
          `Historical durations (${scanIds.length} scans): ${JSON.stringify(avgDurations)}`,
        );
      }

      return Object.keys(avgDurations).length > 0 ? avgDurations : null;
    } catch (error) {
      this.logger.debug(
        `Could not fetch historical durations: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Find scan IDs from similar projects across all organizations.
   * OPTIMIZED: Returns only IDs, uses minimal SELECT.
   */
  private async findSimilarProjectScanIds(
    currentScan: Scan,
    since: Date,
    limit: number,
    excludeIds: string[],
  ): Promise<string[]> {
    try {
      // Calculate LOC range (50% tolerance)
      const currentLOC = currentScan.totalLOC || 0;
      const minLOC = Math.max(0, Math.floor(currentLOC * 0.5));
      const maxLOC = Math.ceil(currentLOC * 1.5) || 100000;

      // Build optimized query - SELECT only id
      let query = this.scanRepository
        .createQueryBuilder('scan')
        .select(['scan.id'])
        .where('scan.projectId != :projectId', {
          projectId: currentScan.projectId,
        })
        .andWhere('scan.state IN (:...states)', {
          states: ['completed', 'completed_degraded'],
        })
        .andWhere('scan.endTime IS NOT NULL')
        .andWhere('scan.endTime > :since', { since });

      // Exclude already found scans
      if (excludeIds.length > 0) {
        query = query.andWhere('scan.id NOT IN (:...excludeIds)', {
          excludeIds,
        });
      }

      // Filter by similar LOC if current scan has LOC data
      if (currentLOC > 0) {
        query = query
          .andWhere('scan.totalLOC >= :minLOC', { minLOC })
          .andWhere('scan.totalLOC <= :maxLOC', { maxLOC });
      }

      // Prefer same scan type if available
      if (currentScan.scanType) {
        query = query.andWhere('scan.scanType = :scanType', {
          scanType: currentScan.scanType,
        });
      }

      // Order by closest LOC match, limit results
      query = query
        .orderBy(
          currentLOC > 0
            ? `ABS(scan.totalLOC - ${currentLOC})`
            : 'scan.endTime',
          'ASC',
        )
        .limit(limit);

      const scans = await query.getMany();
      return scans.map((s) => s.id);
    } catch (error) {
      this.logger.debug(`Could not find similar project scans: ${error}`);
      return [];
    }
  }

  /**
   * Calculate average durations per scanner type using optimized aggregation.
   * Uses raw query for maximum performance.
   */
  private async calculateAverageDurationsOptimized(
    scanIds: string[],
  ): Promise<Record<string, number>> {
    if (scanIds.length === 0) return {};

    try {
      // Use raw query with aggregation for performance. ANY_VALUE and
      // TIMESTAMPDIFF are MySQL-only: they are rendered per engine
      // (MIN / EXTRACT(EPOCH …) on PostgreSQL); on MySQL the text is
      // unchanged.
      const results = await this.containerRepository
        .createQueryBuilder('c')
        .select('c.image')
        .addSelect(anyValue('c.podName').text, 'c_podName')
        .addSelect(
          `AVG(${diffSeconds('c.startedAt', 'c.finishedAt').text} * 1000)`,
          'avgDuration',
        )
        .addSelect('COUNT(*)', 'count')
        .where('c.scanId IN (:...scanIds)', { scanIds })
        .andWhere('c.status IN (:...statuses)', {
          statuses: ['completed', 'Succeeded'],
        })
        .andWhere('c.startedAt IS NOT NULL')
        .andWhere('c.finishedAt IS NOT NULL')
        .andWhere('c.finishedAt > c.startedAt')
        .andWhere(`${diffSeconds('c.startedAt', 'c.finishedAt').text} <= 3600`) // Max 1 hour
        .groupBy('c.image')
        .getRawMany();

      const avgDurations: Record<string, number> = {};

      for (const row of results) {
        const count = parseInt(row.count, 10);
        if (count < 2) continue; // Need at least 2 samples

        // Determine scanner type from image name
        const scannerType = this.getScannerTypeFromImage(
          row.c_image || row.c_podName || '',
        );
        const duration = parseFloat(row.avgDuration);

        if (!isNaN(duration) && duration > 0) {
          // If we have multiple images for same scanner type, average them
          if (avgDurations[scannerType]) {
            avgDurations[scannerType] =
              (avgDurations[scannerType] + duration) / 2;
          } else {
            avgDurations[scannerType] = duration;
          }
        }
      }

      return avgDurations;
    } catch (error) {
      this.logger.debug(`Could not calculate avg durations: ${error}`);
      return {};
    }
  }

  /**
   * Get scanner type from image name (for raw queries).
   */
  private getScannerTypeFromImage(imageName: string): string {
    const nameLower = imageName.toLowerCase();

    if (nameLower.includes('sast-opengrep') || nameLower.includes('opengrep')) {
      return 'sast-opengrep';
    }
    if (nameLower.includes('sast') || nameLower.includes('semgrep')) {
      return 'sast';
    }
    // AI-BOM before SCA: an image name may contain the substring "sca".
    if (nameLower.includes('aibom')) {
      return 'aibom';
    }
    if (nameLower.includes('sca') || nameLower.includes('dependency')) {
      return 'sca';
    }
    if (nameLower.includes('secret') || nameLower.includes('gitleaks')) {
      return 'secrets';
    }
    if (nameLower.includes('iac-kics') || nameLower.includes('kics')) {
      return 'iac-kics';
    }
    if (nameLower.includes('iac-checkov') || nameLower.includes('checkov')) {
      return 'iac-checkov';
    }
    if (nameLower.includes('iac')) {
      return 'iac';
    }
    if (nameLower.includes('container') || nameLower.includes('trivy')) {
      return 'container';
    }
    if (nameLower.includes('agent') || nameLower.includes('parser')) {
      return 'agent';
    }
    return 'default';
  }

  /**
   * Calculate average durations per scanner type from a list of scans.
   * @deprecated Use calculateAverageDurationsOptimized instead
   */
  private async calculateAverageDurations(
    scans: Scan[],
  ): Promise<Record<string, number>> {
    const scanIds = scans.map((s) => s.id);
    return this.calculateAverageDurationsOptimized(scanIds);
  }

  /**
   * Set cache entry with automatic cleanup.
   */
  private setCacheEntry(key: string, durations: Record<string, number>): void {
    historicalCache.set(key, {
      durations,
      timestamp: Date.now(),
    });

    // Cleanup if cache is too large (LRU-like)
    if (historicalCache.size > MAX_CACHE_ENTRIES) {
      this.cleanupCache();
    }
  }

  /**
   * Cleanup expired and oldest cache entries.
   */
  private cleanupCache(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    // Delete expired entries first
    for (const [key, value] of historicalCache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        entriesToDelete.push(key);
      }
    }
    entriesToDelete.forEach((key) => historicalCache.delete(key));

    // If still too large, delete oldest entries
    if (historicalCache.size > MAX_CACHE_ENTRIES) {
      const entries = Array.from(historicalCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(
        0,
        historicalCache.size - MAX_CACHE_ENTRIES,
      );
      toDelete.forEach(([key]) => historicalCache.delete(key));
    }
  }

  /**
   * Clear historical cache for a project (call after scan completes).
   */
  clearHistoricalCache(projectId: string): void {
    for (const key of historicalCache.keys()) {
      if (key.startsWith(`${projectId}:`)) {
        historicalCache.delete(key);
      }
    }
  }
}

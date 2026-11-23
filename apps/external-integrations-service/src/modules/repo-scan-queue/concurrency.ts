/**
 * Per-pod concurrency for the repo-scan worker, env-tunable via
 * REPO_SCAN_CONCURRENCY (strict integer parse — a malformed value falls back to
 * the default rather than silently becoming NaN/0).
 *
 * Each job does: GitHub/GitLab archive download (streamed) + bare `.git` mirror
 * clone (subprocess) + zip rewrite (worker thread) + upload + startScan.
 *
 * The zip rewrite used to be the sizing constraint — it buffered the whole
 * archive and peaked around 1-2 Gi for a large monorepo. It is now streamed
 * (`core/utils/zip-processor`), so its steady-state cost is a few stream
 * buffers: measured at +129 MiB of RSS for a 520 MiB repository, versus
 * +1782 MiB before.
 *
 * What bounds concurrency now is the WORST case, not the steady state: each
 * rewrite runs in a worker thread capped by `ZIP_WORKER_RESOURCE_LIMITS`
 * (1024 MB old generation). That ceiling contains one runaway job; it does not
 * contain N of them. So the pod's memory limit must cover
 * N × 1 GiB + the process baseline before N is raised — and the disk holding
 * the downloaded archive, the `.git` mirror and the rewritten archive has to
 * cover N jobs too.
 */
export function getRepoScanConcurrency(): number {
  const parsed = Number.parseInt(process.env.REPO_SCAN_CONCURRENCY ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 2;
}

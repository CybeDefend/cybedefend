import {
  CLUSTER_FAILURE_CODES,
  ClusterFailureName,
  ERROR_CATEGORY,
  ERROR_DESCRIPTIONS,
  EXIT_CLUSTER_ARCHIVE_FETCH_FAILED,
  EXIT_CLUSTER_DEADLINE,
  EXIT_CLUSTER_IMAGE_INCOMPATIBLE,
  EXIT_CLUSTER_LAUNCH_FAILED,
  EXIT_CLUSTER_NO_RESULTS,
  EXIT_CLUSTER_POD_LOST,
  EXIT_CLUSTER_RESULTS_REFUSED,
  EXIT_CLUSTER_TOOL_FAILED,
  EXIT_CLUSTER_UNSCHEDULABLE,
  getErrorCategory,
  getErrorDescription,
} from './scanlink-error-codes';

/**
 * Community scans on a connected Kubernetes cluster: the cluster failure
 * codes 80–87, stored as `scan.errorCode` (and as a
 * container's `outcomeReason`) with category 'cluster'.
 */
describe('cluster scan failure codes', () => {
  it.each([
    [80, 'cluster'],
    [87, 'cluster'],
    [88, 'cluster'],
    [79, 'import'],
    [89, 'unknown'],
  ])('getErrorCategory(%i) is %s', (code, cat) => {
    expect(getErrorCategory(code)).toBe(cat);
  });

  it('names the nine cluster codes', () => {
    expect(CLUSTER_FAILURE_CODES).toEqual({
      CLUSTER_NO_RESULTS: 80,
      CLUSTER_UNSCHEDULABLE: 81,
      CLUSTER_DEADLINE: 82,
      CLUSTER_LAUNCH_FAILED: 83,
      CLUSTER_IMAGE_INCOMPATIBLE: 84,
      CLUSTER_TOOL_FAILED: 85,
      CLUSTER_RESULTS_REFUSED: 86,
      CLUSTER_POD_LOST: 87,
      CLUSTER_ARCHIVE_FETCH_FAILED: 88,
    });
  });

  // A pod downloads the scan's archive from this instance's storage, whatever
  // the scan's source: an uploaded ZIP has no Git provider, and the usual
  // cause is a storage address the cluster cannot reach.
  it('says a pod could not download the archive from the storage, never a Git provider', () => {
    const sentence = getErrorDescription(EXIT_CLUSTER_ARCHIVE_FETCH_FAILED);
    expect(sentence).toMatch(/storage/);
    expect(sentence).toMatch(/CYBEDEFEND_STORAGE_PUBLIC_URL/);
    expect(sentence).not.toMatch(/Git provider/);
  });

  it('exports each code as its EXIT_ constant', () => {
    const byName: Record<ClusterFailureName, number> = {
      CLUSTER_NO_RESULTS: EXIT_CLUSTER_NO_RESULTS,
      CLUSTER_UNSCHEDULABLE: EXIT_CLUSTER_UNSCHEDULABLE,
      CLUSTER_DEADLINE: EXIT_CLUSTER_DEADLINE,
      CLUSTER_LAUNCH_FAILED: EXIT_CLUSTER_LAUNCH_FAILED,
      CLUSTER_IMAGE_INCOMPATIBLE: EXIT_CLUSTER_IMAGE_INCOMPATIBLE,
      CLUSTER_TOOL_FAILED: EXIT_CLUSTER_TOOL_FAILED,
      CLUSTER_RESULTS_REFUSED: EXIT_CLUSTER_RESULTS_REFUSED,
      CLUSTER_POD_LOST: EXIT_CLUSTER_POD_LOST,
      CLUSTER_ARCHIVE_FETCH_FAILED: EXIT_CLUSTER_ARCHIVE_FETCH_FAILED,
    };
    expect(byName).toEqual(CLUSTER_FAILURE_CODES);
    expect(ERROR_CATEGORY.CLUSTER).toBe('cluster');
  });

  it.each(Object.entries(CLUSTER_FAILURE_CODES))(
    '%s (%i) has its own plain sentence, never the unknown fallback',
    (_name, code) => {
      const sentence = ERROR_DESCRIPTIONS[code];
      expect(typeof sentence).toBe('string');
      expect(sentence.length).toBeGreaterThan(10);
      expect(getErrorDescription(code)).toBe(sentence);
      expect(getErrorDescription(code)).not.toMatch(/Unknown error/);
    },
  );

  it('gives every cluster code a distinct sentence', () => {
    const sentences = Object.values(CLUSTER_FAILURE_CODES).map(
      (code) => ERROR_DESCRIPTIONS[code],
    );
    expect(new Set(sentences).size).toBe(sentences.length);
  });
});

import type { V1Pod } from '@kubernetes/client-node';
import {
  EXIT_INFRA_ERROR,
  EXIT_INFRA_IMAGE_PULL,
  EXIT_INFRA_OOM,
} from '../../../core/constants/scanlink-error-codes';
import { normalizeScanFailure } from './scan-failure.util';

export interface PodFailureReason {
  errorCode: number;
  errorCategory: string;
  errorMessage: string;
}

/** The normalised triplet of a known exit code (its errorCode is never unset). */
function failureOf(errorCode: number): PodFailureReason {
  const { errorCategory, errorMessage } = normalizeScanFailure({ errorCode });
  return { errorCode, errorCategory, errorMessage };
}

/**
 * Derive a structured failure reason from a failed/failing pod's container
 * statuses. Shared by the cloud's KubernetesService and the Community engine.
 */
export function getPodFailureReason(
  pod: V1Pod | undefined,
): PodFailureReason | null {
  const statuses = pod?.status?.containerStatuses ?? [];
  for (const cs of statuses) {
    const term = cs?.state?.terminated ?? cs?.lastState?.terminated;
    const waiting = cs?.state?.waiting;
    if (term?.reason === 'OOMKilled') {
      return failureOf(EXIT_INFRA_OOM);
    }
    if (
      waiting?.reason === 'ImagePullBackOff' ||
      waiting?.reason === 'ErrImagePull'
    ) {
      return failureOf(EXIT_INFRA_IMAGE_PULL);
    }
    if (typeof term?.exitCode === 'number' && term.exitCode !== 0) {
      // The scanner exits with a taxonomy code (10-59); 137/143 are k8s signals.
      const code =
        term.exitCode >= 10 && term.exitCode <= 59
          ? term.exitCode
          : EXIT_INFRA_ERROR;
      return failureOf(code);
    }
  }
  return null;
}

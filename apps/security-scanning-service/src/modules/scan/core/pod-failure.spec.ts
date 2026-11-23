import type { V1ContainerStatus, V1Pod } from '@kubernetes/client-node';
import { getPodFailureReason } from './pod-failure';

const podWith = (status: Partial<V1ContainerStatus>): V1Pod => ({
  status: {
    containerStatuses: [
      {
        name: 'scanner',
        image: 'i',
        imageID: '',
        ready: false,
        restartCount: 0,
        ...status,
      },
    ],
  },
});

describe('getPodFailureReason (core)', () => {
  it('maps OOMKilled to infra OOM (61)', () => {
    expect(
      getPodFailureReason(
        podWith({
          state: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
        }),
      ),
    ).toMatchObject({ errorCode: 61, errorCategory: 'infra' });
  });

  it('maps an OOMKilled last state too (61)', () => {
    expect(
      getPodFailureReason(
        podWith({
          lastState: { terminated: { reason: 'OOMKilled', exitCode: 137 } },
        }),
      ),
    ).toMatchObject({ errorCode: 61 });
  });

  it.each(['ImagePullBackOff', 'ErrImagePull'])(
    'maps %s to infra image pull (63)',
    (reason) => {
      expect(
        getPodFailureReason(podWith({ state: { waiting: { reason } } })),
      ).toMatchObject({ errorCode: 63, errorCategory: 'infra' });
    },
  );

  it('keeps a scanner taxonomy exit code (41)', () => {
    expect(
      getPodFailureReason(
        podWith({ state: { terminated: { reason: 'Error', exitCode: 41 } } }),
      ),
    ).toMatchObject({ errorCode: 41 });
  });

  it('maps an exit code outside the taxonomy (2) to the generic infra error (60)', () => {
    expect(
      getPodFailureReason(
        podWith({ state: { terminated: { reason: 'Error', exitCode: 2 } } }),
      ),
    ).toMatchObject({ errorCode: 60, errorCategory: 'infra' });
  });

  it('returns null for a running pod', () => {
    expect(
      getPodFailureReason(
        podWith({ state: { running: { startedAt: new Date() } } }),
      ),
    ).toBeNull();
  });

  it('returns null without a pod or a status', () => {
    expect(getPodFailureReason(undefined)).toBeNull();
    expect(getPodFailureReason({})).toBeNull();
  });
});

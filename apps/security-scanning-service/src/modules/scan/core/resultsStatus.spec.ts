import { resultsStatusOf } from './resultsStatus';

const scanner = (status: string) => ({
  status,
  image: 'appsec-sast-scanner:latest',
  podName: 'scan-pod-sast-1',
});
const agent = (status: string) => ({
  status,
  image: 'analysis-agent:latest',
  podName: 'scan-pod-agent-1',
});

describe('resultsStatusOf', () => {
  it.each(['completed', 'completed_degraded', 'failed', 'cancelled'])(
    'is ready for a %s scan, even with open containers',
    (state) => {
      expect(resultsStatusOf({ state }, [scanner('running')])).toBe('ready');
    },
  );

  it('is processing for a running scan whose scanners are all closed', () => {
    expect(
      resultsStatusOf({ state: 'running' }, [
        scanner('completed'),
        scanner('failed'),
      ]),
    ).toBe('processing');
  });

  it('is processing when only the agent container is still open', () => {
    expect(
      resultsStatusOf({ state: 'running' }, [
        scanner('completed'),
        agent('running'),
      ]),
    ).toBe('processing');
  });

  it('is pending while a scanner container is open', () => {
    expect(
      resultsStatusOf({ state: 'running' }, [
        scanner('completed'),
        scanner('running'),
      ]),
    ).toBe('pending');
  });

  it('is pending for a running scan with no container yet', () => {
    expect(resultsStatusOf({ state: 'running' }, [])).toBe('pending');
  });

  it.each(['queued', 'waiting_for_file'])(
    'is pending for a %s scan',
    (state) => {
      expect(resultsStatusOf({ state }, [])).toBe('pending');
    },
  );
});

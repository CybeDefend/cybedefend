import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ContainerDto, ScanPipelineDto, ScanResponseDto } from '@/server/interfaces/Scan';
import { buildScanPipelineView } from '@/utils/function/scanPipelineView';
import ScanPipelinePanel from './ScanPipelinePanel';

// Resolves keys against the real `en` locale, so every assertion on visible
// English text also proves the key exists.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

const NOW = new Date('2026-09-25T12:00:00Z');

const container = (over: Partial<ContainerDto>): ContainerDto => ({
  id: over.id ?? String(over.image),
  status: 'running',
  createdAt: '',
  startedAt: '',
  finishedAt: '',
  scanId: 's1',
  ...over,
});

const lane = (total: number, open: number, completed: number, failed: number) => ({ total, open, completed, failed });

const scan = (pipeline: ScanPipelineDto | undefined, over: Partial<ScanResponseDto> = {}): ScanResponseDto =>
  ({ id: 's1', state: 'running', containers: [], pipeline, ...over }) as ScanResponseDto;

const renderPanel = (s: ScanResponseDto) =>
  render(<ScanPipelinePanel view={buildScanPipelineView(s, NOW)} />);

const DONE_SCANNERS = [container({ status: 'completed', image: 'scanlink-sast-opengrep' })];

describe('ScanPipelinePanel', () => {
  it('shows the queue position and why the scan waits', () => {
    renderPanel(
      scan(
        { slotReleased: false, queuePosition: 2, queueReason: 'org_limit', scanners: lane(0, 0, 0, 0), agent: { stage: 'not_applicable' } },
        { state: 'queued' },
      ),
    );
    expect(screen.getByText("Position 2 in your organization's queue")).toBeInTheDocument();
    expect(screen.getByText("Another scan is using your organization's slot.")).toBeInTheDocument();
  });

  it('shows a chip per scanner type and how many scanners are done', () => {
    renderPanel(
      scan(
        { slotReleased: false, scanners: lane(3, 2, 1, 0), agent: { stage: 'ingesting' } },
        {
          containers: [
            container({ status: 'completed', image: 'scanlink-sast-opengrep' }),
            container({ status: 'running', image: 'scanlink-sca' }),
            container({ status: 'starting', image: 'scanlink-iac-kics' }),
            container({ status: 'running', image: 'agent-service' }),
          ],
        },
      ),
    );
    const chips = screen.getByRole('list', { name: 'Scanners' });
    expect(within(chips).getAllByRole('listitem').map((li) => [li.textContent, li.dataset.state])).toEqual([
      ['SASTdone', 'done'],
      ['SCArunning', 'running'],
      ['IaCwaiting', 'waiting'],
    ]);
    expect(screen.getByText('1/3 done')).toBeInTheDocument();
  });

  it('says how many scanners failed', () => {
    renderPanel(
      scan(
        { slotReleased: false, scanners: lane(3, 0, 2, 1), agent: { stage: 'ingesting' } },
        {
          containers: [
            container({ status: 'completed', image: 'scanlink-sast-opengrep' }),
            container({ status: 'completed', image: 'scanlink-sca' }),
            container({ status: 'failed', image: 'scanlink-iac-kics' }),
          ],
        },
      ),
    );
    expect(screen.getByText('3/3 done, 1 failed')).toBeInTheDocument();
    expect(screen.getByText('IaC').closest('li')).toHaveAttribute('data-state', 'failed');
  });

  it('shows the AI queue position on the current step', () => {
    renderPanel(
      scan(
        { slotReleased: true, scanners: lane(1, 0, 1, 0), agent: { stage: 'queued_for_ai', aiQueuePosition: 3 } },
        { containers: DONE_SCANNERS },
      ),
    );
    const steps = within(screen.getByRole('list', { name: 'Cybe AI analysis' })).getAllByRole('listitem');
    expect(steps.map((li) => li.textContent)).toEqual([
      'Indexing code',
      'Waiting for scanner results',
      'Waiting for an AI slot (≈ position 3)',
      'AI analysis',
      'Result',
    ]);
    expect(steps.map((li) => li.getAttribute('aria-current'))).toEqual([null, null, 'step', null, null]);
  });

  it('shows the analysis progress, the time spent and the time limit', () => {
    const since = new Date(NOW.getTime() - 25 * 60_000).toISOString();
    const deadline = new Date(2026, 8, 25, 14, 5).toISOString();
    renderPanel(
      scan(
        {
          slotReleased: true,
          scanners: lane(1, 0, 1, 0),
          agent: { stage: 'analyzing', processed: 45, total: 165, stageSince: since, stageDeadline: deadline },
        },
        { containers: DONE_SCANNERS },
      ),
    );
    const bar = screen.getByRole('progressbar', { name: 'AI analysis 45/165' });
    expect(bar).toHaveAttribute('aria-valuenow', '27');
    expect(screen.getByText('25 min elapsed, time limit at 14:05')).toBeInTheDocument();
  });

  it.each([
    ['skipped', 'ai_queue_timeout', 'AI analysis skipped', 'No AI slot came free within the allowed wait.'],
    ['skipped', 'disabled_for_project', 'AI analysis skipped', 'AI result improvement is turned off for this project.'],
    ['interrupted', 'analysis_timeout', 'AI analysis interrupted', 'The analysis ran past its time limit.'],
    ['failed', 'service_unavailable', 'AI analysis failed', 'The AI analysis service could not be reached.'],
    ['failed', 'brand_new_code', 'AI analysis failed', 'No further detail is available.'],
    ['done', undefined, 'AI analysis done', undefined],
  ] as const)('shows the %s outcome (%s) with its translated reason', (stage, reason, label, sentence) => {
    renderPanel(
      scan(
        { slotReleased: false, scanners: lane(1, 0, 1, 0), agent: { stage, outcomeReason: reason } },
        { state: 'completed', containers: DONE_SCANNERS },
      ),
    );
    const outcome = screen.getByTestId('scan-pipeline-outcome');
    expect(outcome).toHaveTextContent(label);
    if (sentence) expect(outcome).toHaveTextContent(sentence);
    expect(screen.queryByRole('list', { name: 'Cybe AI analysis' })).toBeNull();
  });

  it('shows the slot-released banner only when the slot is released', () => {
    const released = renderPanel(
      scan({ slotReleased: true, scanners: lane(1, 0, 1, 0), agent: { stage: 'analyzing' } }, { containers: DONE_SCANNERS }),
    );
    expect(screen.getByText(/this scan no longer holds up the next ones/)).toBeInTheDocument();
    released.unmount();

    renderPanel(
      scan({ slotReleased: false, scanners: lane(1, 0, 1, 0), agent: { stage: 'analyzing' } }, { containers: DONE_SCANNERS }),
    );
    expect(screen.queryByText(/this scan no longer holds up the next ones/)).toBeNull();
    expect(screen.getByText('Scanner results are ready. The AI analysis continues in the background.')).toBeInTheDocument();
  });

  it('renders from the containers when the API sends no pipeline', () => {
    renderPanel(
      scan(undefined, {
        containers: [
          container({ status: 'completed', image: 'scanlink-sast' }),
          container({ status: 'running', image: 'agent-service', step: 'agent: analyzed 3/10' }),
        ],
      }),
    );
    expect(within(screen.getByRole('list', { name: 'Scanners' })).getByText('SAST')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'AI analysis 3/10' })).toHaveAttribute('aria-valuenow', '30');
  });

  it('never shows a raw step or error text', () => {
    renderPanel(
      scan(undefined, {
        containers: [
          container({ status: 'completed', image: 'scanlink-sast' }),
          container({ status: 'failed', image: 'agent-service', step: 'agent: analysis crashed: Traceback boom' }),
        ],
      }),
    );
    expect(screen.getByTestId('scan-pipeline-outcome')).toHaveTextContent('AI analysis failed');
    expect(screen.queryByText(/boom|crashed|agent:/)).toBeNull();
  });

  it('renders nothing while there is nothing to show', () => {
    const { container: root } = renderPanel(scan(undefined, { state: 'waiting_for_file' }));
    expect(root).toBeEmptyDOMElement();
  });
});

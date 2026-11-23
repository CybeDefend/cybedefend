import { describe, it, expect } from 'vitest';
import { mapScanStateToStatus, buildScanTaskUpsert, SCAN_TASK_TOTAL } from './scanTask';

describe('scanTask helpers', () => {
    describe('mapScanStateToStatus', () => {
        it('maps waiting_for_file and queued to "queued"', () => {
            expect(mapScanStateToStatus('waiting_for_file')).toBe('queued');
            expect(mapScanStateToStatus('queued')).toBe('queued');
        });

        it('maps running to "running"', () => {
            expect(mapScanStateToStatus('running')).toBe('running');
        });

        it('maps completed and completed_degraded to "completed"', () => {
            expect(mapScanStateToStatus('completed')).toBe('completed');
            expect(mapScanStateToStatus('completed_degraded')).toBe('completed');
        });

        it('maps cancelled to a terminal "completed" so it auto-cleans up', () => {
            expect(mapScanStateToStatus('cancelled')).toBe('completed');
        });

        it('maps failed to "failed"', () => {
            expect(mapScanStateToStatus('failed')).toBe('failed');
        });

        it('falls back to "queued" for unknown / missing states', () => {
            expect(mapScanStateToStatus('something_new')).toBe('queued');
            expect(mapScanStateToStatus(undefined)).toBe('queued');
            expect(mapScanStateToStatus(null)).toBe('queued');
        });
    });

    describe('buildScanTaskUpsert', () => {
        it('builds a running upsert payload carrying the raw scan state and clamped progress', () => {
            const payload = buildScanTaskUpsert({
                id: 'scan-1',
                projectId: 'proj-1',
                state: 'running',
                progress: 40,
            });
            expect(payload).toEqual({
                id: 'scan-1',
                projectId: 'proj-1',
                status: 'running',
                scanState: 'running',
                processed: 40,
                total: SCAN_TASK_TOTAL,
            });
        });

        it('forces processed to 100% when the scan is completed', () => {
            const payload = buildScanTaskUpsert({
                id: 'scan-1',
                projectId: 'proj-1',
                state: 'completed',
                progress: 0,
            });
            expect(payload.status).toBe('completed');
            expect(payload.processed).toBe(SCAN_TASK_TOTAL);
        });

        it('treats a missing progress as 0 for an active scan', () => {
            const payload = buildScanTaskUpsert({
                id: 'scan-1',
                projectId: 'proj-1',
                state: 'waiting_for_file',
            });
            expect(payload.status).toBe('queued');
            expect(payload.processed).toBe(0);
        });

        it('clamps and rounds out-of-range progress', () => {
            expect(buildScanTaskUpsert({ id: 's', state: 'running', progress: 150 }).processed).toBe(100);
            expect(buildScanTaskUpsert({ id: 's', state: 'running', progress: -10 }).processed).toBe(0);
            expect(buildScanTaskUpsert({ id: 's', state: 'running', progress: 33.7 }).processed).toBe(34);
        });
    });
});

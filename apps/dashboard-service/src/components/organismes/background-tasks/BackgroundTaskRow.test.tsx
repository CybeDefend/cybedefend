import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import backgroundTasksReducer, { AsyncTask } from '@/server/store/backgroundTasksSlice';
import { BackgroundTaskRow } from './BackgroundTaskRow';

// ── mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-redux', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-redux')>();
    return { ...actual };
});

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());

// ── helpers ──────────────────────────────────────────────────────────────────

const buildStore = () =>
    configureStore({ reducer: { backgroundTasks: backgroundTasksReducer } });

const renderRow = (task: AsyncTask) => {
    const store = buildStore();
    return render(
        <Provider store={store}>
            <MemoryRouter>
                <BackgroundTaskRow task={task} />
            </MemoryRouter>
        </Provider>,
    );
};

const baseTask = (overrides: Partial<AsyncTask> = {}): AsyncTask => ({
    id: 'task-1',
    type: 'vuln_batch_update',
    status: 'queued',
    total: 10,
    processed: 0,
    ...overrides,
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('BackgroundTaskRow — autofix type', () => {
    it('renders "AutoFix" label for type=autofix', () => {
        renderRow(baseTask({ type: 'autofix', status: 'running', processed: 2 }));
        expect(screen.getByText('AutoFix')).toBeInTheDocument();
    });

    it('renders "Updating vulnerabilities" label for type=vuln_batch_update', () => {
        renderRow(baseTask({ type: 'vuln_batch_update', status: 'running', processed: 2 }));
        expect(screen.getByText('Updating vulnerabilities')).toBeInTheDocument();
    });

    it('renders "SCA AutoFix" label for type=sca_autofix', () => {
        renderRow(baseTask({ type: 'sca_autofix', status: 'running', processed: 1 }));
        expect(screen.getByText('SCA AutoFix')).toBeInTheDocument();
    });
});

describe('BackgroundTaskRow — scan type', () => {
    const scanTask = (overrides: Partial<AsyncTask> = {}): AsyncTask =>
        baseTask({ type: 'scan', total: 100, ...overrides });

    it('renders the "Security scan" label', () => {
        renderRow(scanTask({ status: 'running', scanState: 'running', processed: 40 }));
        expect(screen.getByText('Security scan')).toBeInTheDocument();
    });

    it('shows just the percentage (not processed/total) while running', () => {
        renderRow(scanTask({ status: 'running', scanState: 'running', processed: 40 }));
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.queryByText(/40\/100/)).toBeNull();
    });

    it('shows "Scan completed" for a completed scan', () => {
        renderRow(scanTask({ status: 'completed', scanState: 'completed', processed: 100 }));
        expect(screen.getByText('Scan completed')).toBeInTheDocument();
    });

    it('shows "Scan completed with warnings" for a degraded scan', () => {
        renderRow(scanTask({ status: 'completed', scanState: 'completed_degraded', processed: 100 }));
        expect(screen.getByText('Scan completed with warnings')).toBeInTheDocument();
    });

    it('shows "Scan cancelled" for a cancelled scan', () => {
        // cancelled maps to a terminal "completed" status but a distinct scanState
        renderRow(scanTask({ status: 'completed', scanState: 'cancelled', processed: 60 }));
        expect(screen.getByText('Scan cancelled')).toBeInTheDocument();
        expect(screen.queryByText('Scan completed')).toBeNull();
    });

    it('shows "Scan failed" for a failed scan', () => {
        renderRow(scanTask({ status: 'failed', scanState: 'failed', processed: 30 }));
        expect(screen.getByText('Scan failed')).toBeInTheDocument();
    });
});

describe('BackgroundTaskRow — sca_autofix PR link', () => {
    it('renders a "View PR" link when sca_autofix is completed with a resultUrl', () => {
        renderRow(
            baseTask({
                type: 'sca_autofix',
                status: 'completed',
                processed: 3,
                total: 3,
                resultUrl: 'https://github.com/org/repo/pull/77',
            }),
        );
        const link = screen.getByRole('link', { name: /view pr/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/77');
        expect(link).toHaveAttribute('target', '_blank');
    });
});

describe('BackgroundTaskRow — report_generation internal deep-link', () => {
    it('renders an in-app "View report" Link (not target=_blank) for a "/" resultUrl', () => {
        renderRow(
            baseTask({
                type: 'report_generation',
                status: 'completed',
                processed: 1,
                total: 1,
                resultUrl: '/project/p1/reports?reportId=rep-1',
            }),
        );
        const link = screen.getByRole('link', { name: /view report/i });
        expect(link).toBeInTheDocument();
        // The backend names the former URL; the link goes straight to its
        // AppSec form, so the page already on screen opens its drawer instead
        // of the whole shell being torn down by the former URL's redirect.
        expect(link).toHaveAttribute('href', '/appsec/project/p1/reports?reportId=rep-1');
        // Internal navigation must stay in the SPA — no new tab.
        expect(link).not.toHaveAttribute('target');
    });

    it('links an organisation report straight to the AppSec reports page', () => {
        renderRow(
            baseTask({
                type: 'report_generation',
                status: 'completed',
                processed: 1,
                total: 1,
                resultUrl: '/reports?reportId=rep-2',
            }),
        );
        expect(screen.getByRole('link', { name: /view report/i })).toHaveAttribute(
            'href',
            '/appsec/reports?reportId=rep-2',
        );
    });

    it('keeps a report link that is already under the AppSec prefix', () => {
        renderRow(
            baseTask({
                type: 'report_generation',
                status: 'completed',
                processed: 1,
                total: 1,
                resultUrl: '/appsec/reports?reportId=rep-3',
            }),
        );
        expect(screen.getByRole('link', { name: /view report/i })).toHaveAttribute(
            'href',
            '/appsec/reports?reportId=rep-3',
        );
    });

    it('renders the "Generating report" label', () => {
        renderRow(
            baseTask({ type: 'report_generation', status: 'running', processed: 0 }),
        );
        expect(screen.getByText('Generating report')).toBeInTheDocument();
    });
});

describe('BackgroundTaskRow — View PR link', () => {
    it('renders a "View PR" link when task is completed and resultUrl is set', () => {
        renderRow(
            baseTask({
                type: 'autofix',
                status: 'completed',
                processed: 1,
                total: 1,
                resultUrl: 'https://github.com/org/repo/pull/42',
            }),
        );
        const link = screen.getByRole('link', { name: /view pr/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/42');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('does NOT render a "View PR" link when task is completed but resultUrl is absent', () => {
        renderRow(
            baseTask({
                type: 'autofix',
                status: 'completed',
                processed: 1,
                total: 1,
            }),
        );
        expect(screen.queryByRole('link', { name: /view pr/i })).toBeNull();
    });

    it('does NOT render a "View PR" link when task is still running (even if resultUrl is set)', () => {
        renderRow(
            baseTask({
                type: 'autofix',
                status: 'running',
                processed: 0,
                total: 1,
                resultUrl: 'https://github.com/org/repo/pull/42',
            }),
        );
        expect(screen.queryByRole('link', { name: /view pr/i })).toBeNull();
    });

    it('renders "View PR" link for non-autofix types when completed+resultUrl', () => {
        renderRow(
            baseTask({
                type: 'vuln_batch_update',
                status: 'completed',
                processed: 5,
                total: 5,
                resultUrl: 'https://github.com/org/repo/pull/99',
            }),
        );
        const link = screen.getByRole('link', { name: /view pr/i });
        expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/99');
    });
});

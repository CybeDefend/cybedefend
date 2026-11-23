import { describe, it, expect } from 'vitest';
import backgroundTasksReducer, {
    addTask,
    updateProgress,
    completeTask,
    dismissTask,
    setCollapsed,
    closeContainer,
    hydrate,
    upsertScanTask,
    releaseScanTask,
    selectBackgroundTasks,
    selectActiveTasks,
    selectActiveScanTasks,
    selectAllTerminal,
    selectAggregatePercent,
    selectBackgroundTaskById,
    AsyncTask,
    BackgroundTasksState,
} from './backgroundTasksSlice';

const makeTask = (overrides: Partial<AsyncTask> = {}): AsyncTask => ({
    id: 'task-1',
    type: 'vuln_batch_update',
    status: 'queued',
    total: 10,
    processed: 0,
    ...overrides,
});

const wrap = (state: BackgroundTasksState) => ({ backgroundTasks: state });

describe('backgroundTasksSlice', () => {
    describe('initial state', () => {
        it('has empty tasks, not collapsed, not open', () => {
            const state = backgroundTasksReducer(undefined, { type: '@@INIT' });
            expect(state.tasks).toEqual([]);
            expect(state.collapsed).toBe(false);
            expect(state.open).toBe(false);
        });
    });

    describe('addTask', () => {
        it('prepends a new task, opens and uncolllapses the container', () => {
            const task = makeTask();
            const state = backgroundTasksReducer(undefined, addTask(task));
            expect(state.tasks).toHaveLength(1);
            expect(state.tasks[0]).toEqual(task);
            expect(state.open).toBe(true);
            expect(state.collapsed).toBe(false);
        });

        it('upserts (replaces) when adding a task with an existing id', () => {
            const task = makeTask({ status: 'queued', processed: 0 });
            const s1 = backgroundTasksReducer(undefined, addTask(task));
            const updated = makeTask({ status: 'running', processed: 5 });
            const s2 = backgroundTasksReducer(s1, addTask(updated));
            expect(s2.tasks).toHaveLength(1);
            expect(s2.tasks[0].status).toBe('running');
            expect(s2.tasks[0].processed).toBe(5);
        });

        it('prepends new tasks so newest is first', () => {
            const t1 = makeTask({ id: 'task-1' });
            const t2 = makeTask({ id: 'task-2' });
            const s1 = backgroundTasksReducer(undefined, addTask(t1));
            const s2 = backgroundTasksReducer(s1, addTask(t2));
            expect(s2.tasks[0].id).toBe('task-2');
            expect(s2.tasks[1].id).toBe('task-1');
        });

        it('sets open=true and collapsed=false even if container was closed/collapsed', () => {
            const s0 = backgroundTasksReducer(undefined, setCollapsed(true));
            const s1 = backgroundTasksReducer(s0, closeContainer());
            const s2 = backgroundTasksReducer(s1, addTask(makeTask()));
            expect(s2.open).toBe(true);
            expect(s2.collapsed).toBe(false);
        });

        it('round-trips a task with type sca_autofix', () => {
            const task = makeTask({ id: 'sca-autofix-p1-0', type: 'sca_autofix', total: 3 });
            const state = backgroundTasksReducer(undefined, addTask(task));
            expect(state.tasks).toHaveLength(1);
            expect(state.tasks[0].type).toBe('sca_autofix');
            expect(state.tasks[0].id).toBe('sca-autofix-p1-0');
        });
    });

    describe('upsertScanTask', () => {
        const scanUpsert = (overrides = {}) => ({
            id: 'scan-1',
            projectId: 'proj-1',
            status: 'running' as const,
            scanState: 'running',
            processed: 30,
            total: 100,
            ...overrides,
        });

        it('registers a new active scan task, opening and uncollapsing the panel', () => {
            const state = backgroundTasksReducer(undefined, upsertScanTask(scanUpsert()));
            expect(state.tasks).toHaveLength(1);
            expect(state.tasks[0]).toMatchObject({
                id: 'scan-1',
                type: 'scan',
                projectId: 'proj-1',
                status: 'running',
                scanState: 'running',
                processed: 30,
                total: 100,
            });
            expect(state.open).toBe(true);
            expect(state.collapsed).toBe(false);
        });

        it('updates an existing scan task in place WITHOUT re-opening the panel', () => {
            const s1 = backgroundTasksReducer(undefined, upsertScanTask(scanUpsert()));
            // user collapses + closes the panel while the scan keeps running
            const s2 = backgroundTasksReducer(s1, setCollapsed(true));
            const s3 = backgroundTasksReducer(s2, closeContainer());
            expect(s3.open).toBe(false);

            const s4 = backgroundTasksReducer(
                s3,
                upsertScanTask(scanUpsert({ processed: 70, scanState: 'running' })),
            );
            expect(s4.tasks).toHaveLength(1);
            expect(s4.tasks[0].processed).toBe(70);
            // must NOT nag the user by re-opening the panel on every progress tick
            expect(s4.open).toBe(false);
            expect(s4.collapsed).toBe(true);
        });

        it('completes a tracked scan task when it reaches a terminal state', () => {
            const s1 = backgroundTasksReducer(undefined, upsertScanTask(scanUpsert()));
            const s2 = backgroundTasksReducer(
                s1,
                upsertScanTask(scanUpsert({ status: 'completed', scanState: 'completed', processed: 100 })),
            );
            expect(s2.tasks[0].status).toBe('completed');
            expect(s2.tasks[0].scanState).toBe('completed');
        });

        it('does NOT materialise an already-terminal scan that was never tracked', () => {
            // e.g. opening a results page whose last scan finished long ago
            const state = backgroundTasksReducer(
                undefined,
                upsertScanTask(scanUpsert({ status: 'completed', scanState: 'completed', processed: 100 })),
            );
            expect(state.tasks).toHaveLength(0);
            expect(state.open).toBe(false);
        });

        // The results page that shows a scan polls it itself, so
        // the app-root tracker must leave that scan alone while the page is up.
        describe('a scan followed by its results page', () => {
            it('is recorded as owned by the page when the page registers it', () => {
                const state = backgroundTasksReducer(
                    undefined,
                    upsertScanTask(scanUpsert({ ownedByPage: true })),
                );
                expect(state.tasks[0].ownedByPage).toBe(true);
            });

            it('stays owned through an upsert that does not say who follows it', () => {
                const s1 = backgroundTasksReducer(undefined, upsertScanTask(scanUpsert({ ownedByPage: true })));
                const s2 = backgroundTasksReducer(s1, upsertScanTask(scanUpsert({ processed: 60 })));
                expect(s2.tasks[0]).toMatchObject({ processed: 60, ownedByPage: true });
            });

            it('goes back to the tracker once the page releases it', () => {
                const s1 = backgroundTasksReducer(undefined, upsertScanTask(scanUpsert({ ownedByPage: true })));
                const s2 = backgroundTasksReducer(s1, releaseScanTask('scan-1'));
                expect(s2.tasks[0].ownedByPage).toBe(false);
                // Its progress is untouched: only who follows it changed.
                expect(s2.tasks[0]).toMatchObject({ status: 'running', processed: 30 });
            });

            it('releasing a scan that is not tracked changes nothing', () => {
                const s1 = backgroundTasksReducer(undefined, upsertScanTask(scanUpsert({ ownedByPage: true })));
                const s2 = backgroundTasksReducer(s1, releaseScanTask('ghost'));
                expect(s2.tasks).toEqual(s1.tasks);
            });
        });
    });

    describe('updateProgress', () => {
        it('patches processed count on the matching task', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', total: 10, processed: 0 })));
            const s2 = backgroundTasksReducer(s1, updateProgress({ id: 'task-1', processed: 6 }));
            expect(s2.tasks[0].processed).toBe(6);
        });

        it('patches status when provided', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', status: 'queued' })));
            const s2 = backgroundTasksReducer(s1, updateProgress({ id: 'task-1', processed: 3, status: 'running' }));
            expect(s2.tasks[0].status).toBe('running');
        });

        it('patches succeeded and failed counts when provided', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1' })));
            const s2 = backgroundTasksReducer(s1, updateProgress({ id: 'task-1', processed: 5, succeeded: 4, failed: 1 }));
            expect(s2.tasks[0].succeeded).toBe(4);
            expect(s2.tasks[0].failed).toBe(1);
        });

        it('is a no-op when task id is not found', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', processed: 0 })));
            const s2 = backgroundTasksReducer(s1, updateProgress({ id: 'task-GHOST', processed: 99 }));
            expect(s2.tasks[0].processed).toBe(0);
        });
    });

    describe('completeTask', () => {
        it('sets terminal status on the matching task', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', status: 'running' })));
            const s2 = backgroundTasksReducer(s1, completeTask({ id: 'task-1', status: 'completed' }));
            expect(s2.tasks[0].status).toBe('completed');
        });

        it('sets error string on failure', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', status: 'running' })));
            const s2 = backgroundTasksReducer(s1, completeTask({ id: 'task-1', status: 'failed', error: 'timeout' }));
            expect(s2.tasks[0].status).toBe('failed');
            expect(s2.tasks[0].error).toBe('timeout');
        });

        it('sets succeeded, failed, summary fields', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', total: 10 })));
            const s2 = backgroundTasksReducer(s1, completeTask({
                id: 'task-1',
                status: 'completed',
                succeeded: 9,
                failed: 1,
                summary: 'done',
            }));
            expect(s2.tasks[0].succeeded).toBe(9);
            expect(s2.tasks[0].failed).toBe(1);
            expect(s2.tasks[0].summary).toBe('done');
        });

        it('sets resultUrl when provided', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', type: 'autofix', status: 'running' })));
            const s2 = backgroundTasksReducer(s1, completeTask({
                id: 'task-1',
                status: 'completed',
                resultUrl: 'https://github.com/org/repo/pull/42',
            }));
            expect(s2.tasks[0].resultUrl).toBe('https://github.com/org/repo/pull/42');
        });

        it('is a no-op when task id is not found', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1', status: 'running' })));
            const s2 = backgroundTasksReducer(s1, completeTask({ id: 'ghost', status: 'completed' }));
            expect(s2.tasks[0].status).toBe('running');
        });
    });

    describe('dismissTask', () => {
        it('removes the task from the list', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1' })));
            const s2 = backgroundTasksReducer(s1, dismissTask('task-1'));
            expect(s2.tasks).toHaveLength(0);
        });

        it('sets open=false when the last task is dismissed', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1' })));
            expect(s1.open).toBe(true);
            const s2 = backgroundTasksReducer(s1, dismissTask('task-1'));
            expect(s2.open).toBe(false);
        });

        it('keeps open=true when other tasks remain', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1' })));
            const s2 = backgroundTasksReducer(s1, addTask(makeTask({ id: 'task-2' })));
            const s3 = backgroundTasksReducer(s2, dismissTask('task-1'));
            expect(s3.tasks).toHaveLength(1);
            expect(s3.open).toBe(true);
        });

        it('is a no-op when task id is not found', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1' })));
            const s2 = backgroundTasksReducer(s1, dismissTask('ghost'));
            expect(s2.tasks).toHaveLength(1);
        });
    });

    describe('setCollapsed', () => {
        it('sets collapsed flag', () => {
            const s1 = backgroundTasksReducer(undefined, setCollapsed(true));
            expect(s1.collapsed).toBe(true);
            const s2 = backgroundTasksReducer(s1, setCollapsed(false));
            expect(s2.collapsed).toBe(false);
        });
    });

    describe('closeContainer', () => {
        it('sets open=false but keeps a non-completed task intact', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask()));
            expect(s1.open).toBe(true);
            const s2 = backgroundTasksReducer(s1, closeContainer());
            expect(s2.open).toBe(false);
            expect(s2.tasks).toHaveLength(1);
        });

        it('drops successfully-completed tasks when hidden, keeps failed/active', () => {
            const s0 = backgroundTasksReducer(
                undefined,
                hydrate([
                    makeTask({ id: 'ok', status: 'completed' }),
                    makeTask({ id: 'ko', status: 'failed' }),
                    makeTask({ id: 'run', status: 'running' }),
                ]),
            );
            const s1 = backgroundTasksReducer(s0, closeContainer());
            expect(s1.open).toBe(false);
            expect(s1.tasks.map((t) => t.id)).toEqual(['ko', 'run']);
        });
    });

    describe('hydrate', () => {
        it('replaces tasks with the provided list', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'old' })));
            const newTasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
            const s2 = backgroundTasksReducer(s1, hydrate(newTasks));
            expect(s2.tasks.map((t) => t.id)).toEqual(['a', 'b']);
        });

        it('sets open=true when hydrated with tasks', () => {
            const state = backgroundTasksReducer(undefined, hydrate([makeTask()]));
            expect(state.open).toBe(true);
        });

        it('keeps open unchanged when hydrated with empty list', () => {
            const s1 = backgroundTasksReducer(undefined, addTask(makeTask()));
            const s2 = backgroundTasksReducer(s1, closeContainer());
            const s3 = backgroundTasksReducer(s2, hydrate([]));
            expect(s3.open).toBe(false); // unchanged from before hydrate
            expect(s3.tasks).toHaveLength(0);
        });

        it('preserves in-flight scan tasks across a re-hydrate (they are not in /me/async-tasks)', () => {
            // A scan is tracked client-side via upsertScanTask. A report
            // generation then fires refreshBackgroundTasks -> hydrate with only
            // the server-backed async tasks, which NEVER include scans. A blind
            // replace would wipe the scan row and — because selectActiveScanTasks
            // then goes empty — permanently stall its global poller
            // (useActiveScanTasksTracker). The scan must survive the hydrate.
            const s1 = backgroundTasksReducer(
                undefined,
                upsertScanTask({
                    id: 'scan-1',
                    projectId: 'p1',
                    status: 'running',
                    scanState: 'running',
                    processed: 3,
                    total: 10,
                }),
            );
            const s2 = backgroundTasksReducer(
                s1,
                hydrate([makeTask({ id: 'report-1', type: 'report_generation' })]),
            );
            const ids = s2.tasks.map((t) => t.id);
            expect(ids).toContain('scan-1');
            expect(ids).toContain('report-1');
            // The active-scan selector still sees the scan → poller stays alive.
            expect(
                selectActiveScanTasks(wrap(s2)).map((t) => t.id),
            ).toEqual(['scan-1']);
        });

        it('does not duplicate a scan task if the hydrate payload also carries its id', () => {
            const s1 = backgroundTasksReducer(
                undefined,
                upsertScanTask({
                    id: 'scan-1',
                    projectId: 'p1',
                    status: 'running',
                    scanState: 'running',
                    processed: 3,
                    total: 10,
                }),
            );
            const s2 = backgroundTasksReducer(
                s1,
                hydrate([makeTask({ id: 'scan-1', type: 'scan', status: 'running' })]),
            );
            expect(s2.tasks.filter((t) => t.id === 'scan-1')).toHaveLength(1);
        });
    });

    describe('selectors', () => {
        it('selectBackgroundTasks returns all tasks', () => {
            const task = makeTask();
            const state = backgroundTasksReducer(undefined, addTask(task));
            expect(selectBackgroundTasks(wrap(state))).toEqual([task]);
        });

        it('selectActiveTasks returns only queued/running tasks', () => {
            const t1 = makeTask({ id: 'task-1', status: 'queued' });
            const t2 = makeTask({ id: 'task-2', status: 'running' });
            const t3 = makeTask({ id: 'task-3', status: 'completed' });
            const t4 = makeTask({ id: 'task-4', status: 'failed' });
            let state = backgroundTasksReducer(undefined, addTask(t1));
            state = backgroundTasksReducer(state, addTask(t2));
            state = backgroundTasksReducer(state, addTask(t3));
            state = backgroundTasksReducer(state, addTask(t4));
            const active = selectActiveTasks(wrap(state));
            expect(active.map((t) => t.id).sort()).toEqual(['task-1', 'task-2']);
        });

        it('selectActiveScanTasks returns only active scan-type tasks', () => {
            let state = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'batch', status: 'running' })));
            state = backgroundTasksReducer(
                state,
                upsertScanTask({ id: 'scan-run', projectId: 'p', status: 'running', scanState: 'running', processed: 10, total: 100 }),
            );
            state = backgroundTasksReducer(
                state,
                upsertScanTask({ id: 'scan-run', projectId: 'p', status: 'running', scanState: 'running', processed: 10, total: 100 }),
            );
            // a second, still-running scan
            state = backgroundTasksReducer(
                state,
                upsertScanTask({ id: 'scan-queued', projectId: 'p2', status: 'queued', scanState: 'queued', processed: 0, total: 100 }),
            );
            const scans = selectActiveScanTasks(wrap(state));
            expect(scans.map((t) => t.id).sort()).toEqual(['scan-queued', 'scan-run']);
            expect(scans.every((t) => t.type === 'scan')).toBe(true);
        });

        it('selectActiveScanTasks excludes terminal scan tasks', () => {
            let state = backgroundTasksReducer(
                undefined,
                upsertScanTask({ id: 'scan-run', projectId: 'p', status: 'running', scanState: 'running', processed: 10, total: 100 }),
            );
            state = backgroundTasksReducer(
                state,
                upsertScanTask({ id: 'scan-run', projectId: 'p', status: 'completed', scanState: 'completed', processed: 100, total: 100 }),
            );
            expect(selectActiveScanTasks(wrap(state))).toHaveLength(0);
        });

        // App reads these at its root. A selector that
        // builds a new array on every call makes useSelector re-render App on
        // every Redux action, each Cybe Chat token included.
        describe('active selectors keep their result while the tasks are unchanged', () => {
            const seeded = () => {
                let state = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'batch', status: 'running' })));
                state = backgroundTasksReducer(
                    state,
                    upsertScanTask({ id: 'scan-run', projectId: 'p', status: 'running', scanState: 'running', processed: 10, total: 100 }),
                );
                return state;
            };

            it('selectActiveScanTasks returns the same array after an action of another slice', () => {
                const tasks = seeded();
                const before = { backgroundTasks: tasks, chat: { tokens: 'Hel' } };
                const after = { backgroundTasks: tasks, chat: { tokens: 'Hello' } };
                expect(selectActiveScanTasks(after)).toBe(selectActiveScanTasks(before));
            });

            it('selectActiveTasks returns the same array after an action of another slice', () => {
                const tasks = seeded();
                const before = { backgroundTasks: tasks, chat: { tokens: 'Hel' } };
                const after = { backgroundTasks: tasks, chat: { tokens: 'Hello' } };
                expect(selectActiveTasks(after)).toBe(selectActiveTasks(before));
            });

            it('gives a new array once a task changes', () => {
                const s1 = seeded();
                const s2 = backgroundTasksReducer(
                    s1,
                    upsertScanTask({ id: 'scan-run', projectId: 'p', status: 'running', scanState: 'running', processed: 40, total: 100 }),
                );
                const first = selectActiveScanTasks(wrap(s1));
                const second = selectActiveScanTasks(wrap(s2));
                expect(second).not.toBe(first);
                expect(second[0].processed).toBe(40);
            });
        });

        describe('selectBackgroundTaskById', () => {
            it('returns the matching task by id', () => {
                const t1 = makeTask({ id: 'task-1' });
                const t2 = makeTask({ id: 'sca-autofix-p1-0', type: 'sca_autofix' });
                let state = backgroundTasksReducer(undefined, addTask(t1));
                state = backgroundTasksReducer(state, addTask(t2));
                const found = selectBackgroundTaskById('sca-autofix-p1-0')(wrap(state));
                expect(found?.id).toBe('sca-autofix-p1-0');
                expect(found?.type).toBe('sca_autofix');
            });

            it('returns undefined when no task matches the id', () => {
                const state = backgroundTasksReducer(undefined, addTask(makeTask({ id: 'task-1' })));
                expect(selectBackgroundTaskById('ghost')(wrap(state))).toBeUndefined();
            });
        });

        describe('selectAllTerminal', () => {
            it('returns false when there are no tasks', () => {
                const state = backgroundTasksReducer(undefined, { type: '@@INIT' });
                expect(selectAllTerminal(wrap(state))).toBe(false);
            });

            it('returns false when an active task exists', () => {
                const t1 = makeTask({ id: 'task-1', status: 'completed' });
                const t2 = makeTask({ id: 'task-2', status: 'running' });
                let state = backgroundTasksReducer(undefined, addTask(t1));
                state = backgroundTasksReducer(state, addTask(t2));
                expect(selectAllTerminal(wrap(state))).toBe(false);
            });

            it('returns true when all tasks are terminal (completed or failed)', () => {
                const t1 = makeTask({ id: 'task-1', status: 'completed' });
                const t2 = makeTask({ id: 'task-2', status: 'failed' });
                let state = backgroundTasksReducer(undefined, addTask(t1));
                state = backgroundTasksReducer(state, addTask(t2));
                expect(selectAllTerminal(wrap(state))).toBe(true);
            });
        });

        describe('selectAggregatePercent', () => {
            it('returns 0 when no tasks', () => {
                const state = backgroundTasksReducer(undefined, { type: '@@INIT' });
                expect(selectAggregatePercent(wrap(state))).toBe(0);
            });

            it('returns 0 when all totals are 0', () => {
                const state = backgroundTasksReducer(undefined, addTask(makeTask({ total: 0, processed: 0 })));
                expect(selectAggregatePercent(wrap(state))).toBe(0);
            });

            it('computes sum(processed)/sum(total)*100 rounded across all tasks', () => {
                // task-1: 5/10, task-2: 3/5 => (5+3)/(10+5)*100 = 8/15*100 ≈ 53
                const t1 = makeTask({ id: 't1', total: 10, processed: 5 });
                const t2 = makeTask({ id: 't2', total: 5, processed: 3 });
                let state = backgroundTasksReducer(undefined, addTask(t1));
                state = backgroundTasksReducer(state, addTask(t2));
                expect(selectAggregatePercent(wrap(state))).toBe(Math.round(8 / 15 * 100));
            });

            it('returns 100 when all tasks fully processed', () => {
                const t1 = makeTask({ id: 't1', total: 10, processed: 10 });
                const t2 = makeTask({ id: 't2', total: 5, processed: 5 });
                let state = backgroundTasksReducer(undefined, addTask(t1));
                state = backgroundTasksReducer(state, addTask(t2));
                expect(selectAggregatePercent(wrap(state))).toBe(100);
            });
        });
    });
});

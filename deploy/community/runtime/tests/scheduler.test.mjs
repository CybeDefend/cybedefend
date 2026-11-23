import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCron, matches, createScheduler } from '../scheduler.mjs';

const SCHEDULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'schedules');
const readSchedule = (name) => JSON.parse(readFileSync(join(SCHEDULES, name), 'utf8'));
const FILES = ['analysis-reporting.json', 'external-integrations.json'];

const at = (iso) => new Date(iso);
const quiet = () => {};

function fakeChild({ exitOnKill = true } = {}) {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => {
    child.signals.push(signal);
    if (exitOnKill) setImmediate(() => child.emit('exit', null, signal));
    return true;
  };
  return child;
}

test('parses every schedule of the two files', () => {
  for (const file of FILES) {
    const jobs = readSchedule(file);
    assert.ok(Array.isArray(jobs) && jobs.length > 0, file);
    for (const job of jobs) {
      assert.equal(typeof job.name, 'string');
      assert.doesNotThrow(() => parseCron(job.cron), `${file}: ${job.name}`);
      assert.equal(typeof job.env, 'object');
      assert.equal(typeof job.env.APP_MODE, 'string');
    }
  }
});

test('schedules exactly the Community jobs', () => {
  assert.deepEqual(
    readSchedule('analysis-reporting.json').map((job) => job.name),
    ['report-mail-daily', 'report-mail-weekly', 'report-mail-monthly', 'report-retention'],
  );
  assert.deepEqual(readSchedule('external-integrations.json').map((job) => job.name), ['jira-webhook-refresh']);

  const byName = Object.fromEntries(FILES.flatMap((file) => readSchedule(file)).map((job) => [job.name, job]));
  assert.deepEqual(byName['report-mail-daily'], {
    name: 'report-mail-daily',
    cron: '0 8 * * *',
    env: { APP_MODE: 'cron-report-mail', CRON_TASK: 'daily' },
  });
  assert.deepEqual(byName['report-mail-weekly'].env, { APP_MODE: 'cron-report-mail', CRON_TASK: 'weekly' });
  assert.equal(byName['report-mail-weekly'].cron, '0 7 * * 1');
  assert.deepEqual(byName['report-mail-monthly'].env, { APP_MODE: 'cron-report-mail', CRON_TASK: 'monthly' });
  assert.equal(byName['report-mail-monthly'].cron, '30 7 1 * *');
  assert.deepEqual(byName['report-retention'].env, { APP_MODE: 'cron-report-retention' });
  assert.equal(byName['report-retention'].cron, '15 */12 * * *');
  assert.deepEqual(byName['jira-webhook-refresh'].env, { APP_MODE: 'cron-webhook', CRON_TASK: 'jira-webhook-refresh' });
  assert.equal(byName['jira-webhook-refresh'].cron, '0 3 * * 0');
});

test('no schedule starts an OSV or EPSS mode', () => {
  for (const file of FILES) {
    for (const job of readSchedule(file)) {
      assert.equal(['cron-osv', 'main.cron-osv', 'cron-epss'].includes(job.env.APP_MODE), false, `${file}: ${job.name}`);
      assert.equal(/epss|osv/i.test(job.name), false, `${file}: ${job.name}`);
      assert.notEqual(job.cron, '7 6 * * *', `${file}: ${job.name}`);
    }
  }
});

test('matches the chart schedules at their UTC instants', () => {
  const weekly = parseCron('0 7 * * 1');
  assert.equal(matches(weekly, at('2026-11-02T07:00:00Z')), true);
  assert.equal(matches(weekly, at('2026-11-03T07:00:00Z')), false);
  assert.equal(matches(weekly, at('2026-11-02T07:01:00Z')), false);

  assert.equal(matches(parseCron('30 7 1 * *'), at('2026-12-01T07:30:00Z')), true);
  assert.equal(matches(parseCron('30 7 1 * *'), at('2026-12-02T07:30:00Z')), false);

  const everyTen = parseCron('*/10 * * * *');
  for (let minute = 0; minute < 60; minute += 1) {
    const date = new Date(Date.UTC(2026, 10, 3, 9, minute));
    assert.equal(matches(everyTen, date), minute % 10 === 0, `minute ${minute}`);
  }

  const twiceADay = parseCron('15 */12 * * *');
  for (let hour = 0; hour < 24; hour += 1) {
    const date = new Date(Date.UTC(2026, 10, 3, hour, 15));
    assert.equal(matches(twiceADay, date), hour === 0 || hour === 12, `hour ${hour}`);
  }

  assert.equal(matches(parseCron('0 3 * * 0'), at('2026-11-08T03:00:00Z')), true);
  assert.equal(matches(parseCron('0 3 * * 0'), at('2026-11-09T03:00:00Z')), false);
});

test('when day of month and day of week are both restricted, either may match', () => {
  const spec = parseCron('0 0 1 * 1');
  assert.equal(matches(spec, at('2026-12-01T00:00:00Z')), true); // the 1st, a Tuesday
  assert.equal(matches(spec, at('2026-11-02T00:00:00Z')), true); // a Monday
  assert.equal(matches(spec, at('2026-11-03T00:00:00Z')), false);
  assert.deepEqual([...parseCron('0,30 * * * *').minute], [0, 30]);
});

test('refuses syntax it does not support', () => {
  for (const expr of ['5-10 * * * *', '@daily', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '0 0 0 * *', '*/0 * * * *', 'a * * * *', '1,,2 * * * *']) {
    assert.throws(() => parseCron(expr), undefined, expr);
  }
});

test('never starts a job that is still running', () => {
  let clock = at('2026-11-02T07:00:00Z');
  const spawned = [];
  const scheduler = createScheduler({
    jobs: [{ name: 'report-mail-weekly', cron: '* * * * *', env: { APP_MODE: 'cron-report-mail' } }],
    spawn: (...args) => {
      spawned.push(args);
      return fakeChild({ exitOnKill: false });
    },
    now: () => clock,
    log: quiet,
  });
  scheduler.tick();
  clock = at('2026-11-02T07:01:00Z');
  scheduler.tick();
  assert.equal(spawned.length, 1);
});

test('starts a job once per matching minute, and again once it has exited', () => {
  let clock = at('2026-11-02T07:00:00Z');
  const children = [];
  const lines = [];
  const scheduler = createScheduler({
    jobs: [{ name: 'report-retention', cron: '* * * * *', env: { APP_MODE: 'cron-report-retention' } }],
    spawn: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    now: () => clock,
    log: (line) => lines.push(line),
  });
  scheduler.tick();
  children[0].emit('exit', 0, null);
  scheduler.tick(); // same minute
  assert.equal(children.length, 1);
  clock = at('2026-11-02T07:01:00Z');
  scheduler.tick();
  assert.equal(children.length, 2);
  assert.deepEqual(lines, ['scheduler: start report-retention', 'scheduler: report-retention exited 0', 'scheduler: start report-retention']);
});

test('does not start a job outside its schedule', () => {
  const spawned = [];
  const scheduler = createScheduler({
    jobs: [{ name: 'report-mail-daily', cron: '0 8 * * *', env: { APP_MODE: 'cron-report-mail', CRON_TASK: 'daily' } }],
    spawn: (...args) => {
      spawned.push(args);
      return fakeChild();
    },
    now: () => at('2026-11-02T07:59:00Z'),
    log: quiet,
  });
  scheduler.tick();
  assert.equal(spawned.length, 0);
});

test('spawns /scripts/entrypoint.sh with the job env merged over process.env', () => {
  const spawned = [];
  const before = { APP_MODE: process.env.APP_MODE, SCHEDULER_TEST_KEPT: process.env.SCHEDULER_TEST_KEPT };
  process.env.APP_MODE = 'server';
  process.env.SCHEDULER_TEST_KEPT = 'kept';
  try {
    const scheduler = createScheduler({
      jobs: [{ name: 'report-mail-daily', cron: '0 8 * * *', env: { APP_MODE: 'cron-report-mail', CRON_TASK: 'daily' } }],
      spawn: (...args) => {
        spawned.push(args);
        return fakeChild();
      },
      now: () => at('2026-11-02T08:00:30Z'),
      log: quiet,
    });
    scheduler.tick();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.equal(spawned.length, 1);
  const [command, args, options] = spawned[0];
  assert.equal(command, '/scripts/entrypoint.sh');
  assert.deepEqual(args, []);
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.env.APP_MODE, 'cron-report-mail');
  assert.equal(options.env.CRON_TASK, 'daily');
  assert.equal(options.env.SCHEDULER_TEST_KEPT, 'kept');
});

test('a child that fails to spawn is logged and the job can start again', () => {
  let clock = at('2026-11-02T07:00:00Z');
  const children = [];
  const lines = [];
  const scheduler = createScheduler({
    jobs: [{ name: 'jira-webhook-refresh', cron: '* * * * *', env: { APP_MODE: 'cron-webhook' } }],
    spawn: () => {
      const child = fakeChild();
      children.push(child);
      return child;
    },
    now: () => clock,
    log: (line) => lines.push(line),
  });
  scheduler.tick();
  children[0].emit('error', new Error('ENOENT'));
  clock = at('2026-11-02T07:01:00Z');
  scheduler.tick();
  assert.equal(children.length, 2);
  assert.deepEqual(lines, ['scheduler: start jira-webhook-refresh', 'scheduler: jira-webhook-refresh exited error', 'scheduler: start jira-webhook-refresh']);
});

test('stop forwards SIGTERM to running children and resolves when they exit', async () => {
  const children = [];
  const lines = [];
  const scheduler = createScheduler({
    jobs: [
      { name: 'report-mail-daily', cron: '* * * * *', env: { APP_MODE: 'cron-report-mail' } },
      { name: 'report-retention', cron: '* * * * *', env: { APP_MODE: 'cron-report-retention' } },
    ],
    spawn: () => {
      const child = fakeChild({ exitOnKill: false });
      children.push(child);
      return child;
    },
    now: () => at('2026-11-02T07:00:00Z'),
    log: (line) => lines.push(line),
  });
  scheduler.tick();
  assert.equal(children.length, 2);

  let resolved = false;
  const stopped = scheduler.stop().then(() => {
    resolved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(children.map((child) => child.signals), [['SIGTERM'], ['SIGTERM']]);
  assert.equal(resolved, false);

  children[0].emit('exit', null, 'SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  children[1].emit('exit', 143, null);
  await stopped;
  assert.equal(resolved, true);
  assert.ok(lines.includes('scheduler: report-mail-daily exited SIGTERM'));
  assert.ok(lines.includes('scheduler: report-retention exited 143'));

  scheduler.tick();
  assert.equal(children.length, 2, 'no job starts after stop');
});

test('stop resolves at once when nothing runs', async () => {
  const scheduler = createScheduler({ jobs: [], spawn: () => fakeChild(), now: () => new Date(), log: quiet });
  await scheduler.stop();
});

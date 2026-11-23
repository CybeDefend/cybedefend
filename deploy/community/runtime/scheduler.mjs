#!/usr/bin/env node
// CybeDefend Community Edition: runs the one-shot jobs the cloud runs as
// Kubernetes CronJobs, inside one long-lived container of the service's image.
//
// CLI: node scheduler.mjs <schedule.json>
//   schedule.json: [{ "name": "report-mail-daily", "cron": "0 8 * * *",
//                     "env": { "APP_MODE": "cron-report-mail", "CRON_TASK": "daily" } }]
//
// Cron syntax: five fields (minute hour day-of-month month day-of-week), each
// `*`, `*/n`, an integer or a comma list of those, read in UTC. When both
// day-of-month and day-of-week are restricted, either may match. A job never
// starts while its previous run is still running.

import { spawn as nodeSpawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ENTRYPOINT = '/scripts/entrypoint.sh';

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 7 },
];

function parseField(text, { name, min, max }, expr) {
  const values = new Set();
  for (const item of text.split(',')) {
    let step = 1;
    let from = min;
    let to = max;
    if (item === '*') {
      // every value
    } else if (/^\*\/\d+$/.test(item)) {
      step = Number(item.slice(2));
      if (step < 1) throw new Error(`cron: step 0 in ${name} of "${expr}"`);
    } else if (/^\d+$/.test(item)) {
      from = to = Number(item);
      if (from < min || from > max) throw new Error(`cron: ${name} ${from} out of ${min}-${max} in "${expr}"`);
    } else {
      throw new Error(`cron: unsupported ${name} "${item}" in "${expr}"`);
    }
    for (let value = from; value <= to; value += step) {
      values.add(name === 'dow' && value === 7 ? 0 : value);
    }
  }
  return values;
}

/** Parses a five-field cron expression. Throws on any syntax it does not support. */
export function parseCron(expr) {
  if (typeof expr !== 'string') throw new Error('cron: expression must be a string');
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron: "${expr}" must have 5 fields`);
  const spec = {};
  FIELDS.forEach((field, index) => {
    spec[field.name] = parseField(parts[index], field, expr);
  });
  // As in cron: a field starting with `*` leaves the day unrestricted.
  Object.defineProperty(spec, 'domRestricted', { value: !parts[2].startsWith('*') });
  Object.defineProperty(spec, 'dowRestricted', { value: !parts[4].startsWith('*') });
  return spec;
}

/** Whether the minute of `date` (UTC) matches the parsed spec. */
export function matches(spec, date) {
  if (!spec.minute.has(date.getUTCMinutes())) return false;
  if (!spec.hour.has(date.getUTCHours())) return false;
  if (!spec.month.has(date.getUTCMonth() + 1)) return false;
  const dom = spec.dom.has(date.getUTCDate());
  const dow = spec.dow.has(date.getUTCDay());
  if (spec.domRestricted && spec.dowRestricted) return dom || dow;
  return dom && dow;
}

/**
 * jobs: [{ name, cron, env }]; spawn: child_process.spawn; now: () => Date;
 * log: (line) => void. tick() starts every job whose schedule matches the
 * current minute, once per minute, and never while it runs; start() wakes
 * tick() at the start of each minute; stop() forwards SIGTERM to running
 * children and resolves when they have all exited.
 */
export function createScheduler({ jobs, spawn = nodeSpawn, now = () => new Date(), log = console.log }) {
  const state = jobs.map((job) => ({ job, spec: parseCron(job.cron), child: null, lastMinute: null }));
  const exits = new Set();
  let timer = null;
  let stopped = false;

  function launch(entry) {
    const { job } = entry;
    log(`scheduler: start ${job.name}`);
    let child;
    let done;
    const exited = new Promise((resolve) => {
      done = resolve;
    });
    const finish = (code) => {
      if (entry.child !== child) return;
      entry.child = null;
      exits.delete(exited);
      log(`scheduler: ${job.name} exited ${code}`);
      done();
    };
    try {
      child = spawn(ENTRYPOINT, [], { env: { ...process.env, ...job.env }, stdio: 'inherit' });
    } catch {
      log(`scheduler: ${job.name} exited error`);
      return;
    }
    entry.child = child;
    exits.add(exited);
    child.on('exit', (code, signal) => finish(code ?? signal));
    child.on('error', () => finish('error'));
  }

  function tick() {
    if (stopped) return;
    const date = now();
    const minute = Math.floor(date.getTime() / 60000);
    for (const entry of state) {
      if (entry.child || entry.lastMinute === minute || !matches(entry.spec, date)) continue;
      entry.lastMinute = minute;
      launch(entry);
    }
  }

  function start() {
    if (stopped || timer) return;
    const arm = () => {
      const wait = 60000 - (now().getTime() % 60000);
      timer = setTimeout(() => {
        timer = null;
        tick();
        if (!stopped) arm();
      }, wait);
    };
    arm();
  }

  async function stop() {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const entry of state) {
      if (entry.child) entry.child.kill('SIGTERM');
    }
    await Promise.all([...exits]);
  }

  return { tick, start, stop };
}

function readJobs(path) {
  const jobs = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(jobs)) throw new Error(`${path}: expected an array of jobs`);
  for (const job of jobs) {
    if (!job || typeof job.name !== 'string' || typeof job.cron !== 'string' || typeof job.env !== 'object' || job.env === null) {
      throw new Error(`${path}: every job needs a name, a cron and an env object`);
    }
  }
  return jobs;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scheduler.mjs <schedule.json>');
    process.exit(1);
  }
  let scheduler;
  try {
    scheduler = createScheduler({ jobs: readJobs(path) });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  scheduler.start();
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    scheduler.stop().then(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

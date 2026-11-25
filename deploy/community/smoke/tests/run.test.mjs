import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClusterRun, Run } from '../run.mjs';
import { expectedFindings } from '../cluster.mjs';

// The runner builds its Run before Stack.writeEnv() picks the ports, so
// an API base read in the constructor was "undefined/api" and the first HTTP
// step failed with « Failed to parse URL ».
test('Run reads the API base from the stack once its public URL is known', () => {
  const stack = {};
  const run = new Run(stack);
  stack.publicUrl = 'http://localhost:12345';
  assert.equal(run.api, 'http://localhost:12345/api');
});

// After the setup and the imports, the smoke reads what a
// user opens, the project list first, and fails on any 5xx naming the route.
function fakeApi(answer) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.replace(/^\/api/, '') + new URL(url).search;
    seen.push(path);
    const [status, body] = answer(path);
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  };
  return { seen, restore: () => (globalThis.fetch = original) };
}

function readyRun() {
  const run = new Run({ publicUrl: 'http://localhost:12345' });
  Object.assign(run, {
    token: 't',
    organizationId: '11111111-1111-4111-8111-111111111111',
    teamId: '22222222-2222-4222-8222-222222222222',
    projectId: '33333333-3333-4333-8333-333333333333',
  });
  return run;
}

const listing = (run) => ({ projects: [{ projectId: run.projectId, name: 'smoke' }], totalProjects: 1 });

test('Run.reads passes when the project list holds the project and no read fails', async () => {
  const run = readyRun();
  const api = fakeApi((path) => (path.includes('/projects?page=') ? [200, listing(run)] : [200, {}]));
  try {
    await run.reads();
  } finally {
    api.restore();
  }
  assert.ok(api.seen.includes(`/organization/${run.organizationId}/projects?page=1&pageSize=10&search=`));
  assert.ok(api.seen.includes(`/organization/${run.organizationId}/results/overview`));
  assert.ok(api.seen.some((p) => p.startsWith(`/project/${run.projectId}/results/container?`)));
});

test('Run.reads fails on a project list without the project', async () => {
  const run = readyRun();
  const api = fakeApi((path) => (path.includes('/projects?page=') ? [200, { projects: [], totalProjects: 0 }] : [200, {}]));
  try {
    await assert.rejects(run.reads(), /project list/);
  } finally {
    api.restore();
  }
});

test('Run.reads names every route that answered 5xx', async () => {
  const run = readyRun();
  const api = fakeApi((path) => {
    if (path.includes('/projects?page=')) return [200, listing(run)];
    if (path.endsWith('/results/overview')) return [500, { statusCode: 500 }];
    if (path.includes('/results/sca/grouped')) return [503, {}];
    return [404, {}];
  });
  try {
    await assert.rejects(run.reads(), (err) => {
      assert.match(err.message, new RegExp(`/organization/${run.organizationId}/results/overview → HTTP 500`));
      assert.match(err.message, /results\/sca\/grouped\?.* → HTTP 503/);
      return true;
    });
  } finally {
    api.restore();
  }
});

// No cluster: the default stack stays import-only. The capability
// route says so, a ZIP scan and a container scan are refused as before the
// cluster engine existed, the external-integrations worker runs, and no log
// line shows a cluster at work.
function fakeCalls(answer) {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const method = init.method ?? 'GET';
    seen.push({ method, path, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const [status, body] = answer(method, path);
    return new Response(body === undefined ? '' : JSON.stringify(body), { status });
  };
  return { seen, restore: () => (globalThis.fetch = original) };
}

const refused = [409, { statusCode: 409, error: 'Conflict', code: 'SCANNERS_NOT_AVAILABLE', message: 'This edition runs no scanners; import results instead.' }];

function importOnlyApi(run, overrides = {}) {
  return fakeCalls((method, path) => {
    const key = `${method} ${path}`;
    if (key in overrides) return overrides[key];
    if (key === 'GET /instance/capabilities') return [200, { clusterScans: false }];
    if (key === `POST /project/${run.projectId}/scan/start`) return refused;
    if (key === `POST /project/${run.projectId}/scan/container/start`) return refused;
    return [404, {}];
  });
}

function quietStack(extra = {}) {
  return {
    publicUrl: 'http://localhost:12345',
    assess: () => ({ healthy: true }),
    allLogs: () => 'gateway-1  | [Nest] 1  - LOG [RouterExplorer] Mapped {/scan-runs/:scanId/results, POST} route\n',
    ...extra,
  };
}

function importOnlyRun(stack = quietStack()) {
  const run = new Run(stack);
  Object.assign(run, { token: 't', projectId: '33333333-3333-4333-8333-333333333333' });
  return run;
}

test('Run.importOnly passes on an import-only instance and asks what a user would', async () => {
  const run = importOnlyRun();
  const api = importOnlyApi(run);
  try {
    await run.importOnly();
  } finally {
    api.restore();
  }
  assert.deepEqual(
    api.seen.map(({ method, path }) => `${method} ${path}`),
    [
      'GET /instance/capabilities',
      `POST /project/${run.projectId}/scan/start`,
      `POST /project/${run.projectId}/scan/container/start`,
    ],
  );
  assert.deepEqual(api.seen[1].body, { branch: 'main' });
  assert.equal(typeof api.seen[2].body.imageToScan, 'string');
  assert.ok(run.steps.every((s) => s.startsWith('✔')), run.steps.join('\n'));
});

test('Run.importOnly fails when the instance claims cluster scans', async () => {
  const run = importOnlyRun();
  const api = importOnlyApi(run, { 'GET /instance/capabilities': [200, { clusterScans: true }] });
  try {
    await assert.rejects(run.importOnly(), /clusterScans/);
  } finally {
    api.restore();
  }
});

test('Run.importOnly fails when the capability route is not served', async () => {
  const run = importOnlyRun();
  const api = importOnlyApi(run, { 'GET /instance/capabilities': [503, { code: 'INSTANCE_CAPABILITIES_UNAVAILABLE' }] });
  try {
    await assert.rejects(run.importOnly(), /HTTP 503 \(INSTANCE_CAPABILITIES_UNAVAILABLE\)/);
  } finally {
    api.restore();
  }
});

test('Run.importOnly fails when a ZIP scan or a container scan is accepted', async () => {
  for (const route of ['scan/start', 'scan/container/start']) {
    const run = importOnlyRun();
    const api = importOnlyApi(run, { [`POST /project/${run.projectId}/${route}`]: [200, { url: 'http://storage/x', scanId: 's' }] });
    try {
      await assert.rejects(run.importOnly(), /HTTP 200/, route);
    } finally {
      api.restore();
    }
  }
});

test('Run.importOnly fails on a refusal with another code', async () => {
  const run = importOnlyRun();
  const api = importOnlyApi(run, { [`POST /project/${run.projectId}/scan/start`]: [409, { code: 'SCAN_ALREADY_RUNNING' }] });
  try {
    await assert.rejects(run.importOnly(), /SCAN_ALREADY_RUNNING/);
  } finally {
    api.restore();
  }
});

test('Run.noClusterTrace passes when the worker runs and no log names a cluster', async () => {
  const asked = [];
  const run = importOnlyRun(quietStack({ assess: (services) => (asked.push(services), { healthy: true }) }));
  await run.noClusterTrace();
  assert.deepEqual(asked, [['external-integrations-worker']]);
});

test('Run.noClusterTrace fails on a restarted worker', async () => {
  const run = importOnlyRun(
    quietStack({ assess: () => ({ healthy: false, service: 'external-integrations-worker', reason: 'cd-smoke-default-external-integrations-worker-1 restarted 1 time(s)' }) }),
  );
  await assert.rejects(run.noClusterTrace(), /external-integrations-worker: .*restarted 1/);
});

test('Run.noClusterTrace fails on a log line that names a cluster, and quotes it', async () => {
  const run = importOnlyRun(quietStack({ allLogs: () => 'a\nsecurity-scanning-1  | WARN CLUSTER_SCANNING_DISABLED reason=cluster_unreachable\nb\n' }));
  await assert.rejects(run.noClusterTrace(), /1 log line.*CLUSTER_SCANNING_DISABLED reason=cluster_unreachable/s);
});

// The storage secret lives in the storage's own secrets volume; the shared
// runtime volume holds no secret any more, so a path there finds nothing.
test('the smoke reads the storage secret where the storage containers mount it', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('/run/cybedefend/storage-secret-key'), 'reads the former shared path');
  assert.ok(source.includes('/run/cybedefend-secrets/storage-secret-key'));
});

// A first start on empty volumes hides what only a second start meets: files
// a container wrote the first time. The smoke stops the whole stack and starts
// it again on its own data.
test('Run.restartStack stops the stack, starts it again on its volumes, and waits until every container is healthy', async () => {
  const calls = [];
  const run = importOnlyRun(
    quietStack({
      compose: (args) => (calls.push(args.join(' ')), { stdout: '', stderr: '' }),
      waitHealthy: async (t) => calls.push(`healthy ${t}`),
    }),
  );
  await run.restartStack(600);
  assert.deepEqual(calls, ['stop', 'up -d', 'healthy 600']);
});

test('every variant restarts the stack before its last checks', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8');
  const flow = source.slice(source.indexOf('async function runVariant('));
  assert.ok(flow.indexOf('run.restartStack(') > 0, 'runVariant restarts the stack');
  assert.ok(flow.indexOf('run.restartStack(') < flow.indexOf('await run.noRestart()'), 'before the restart count check');
});

// The cluster variant. The fixture's scans end in a few seconds and their
// archives are released one at a time, so two scans rarely overlap and none
// waits: the limit and the queue were then never exercised. The scans start
// while the node takes no new pod, so the first two keep their slots however
// short a scan is.
const KINDS = expectedFindings().map((f) => f.project);

function heldRun(stateOf, { failStart } = {}) {
  const calls = [];
  const cluster = { setSchedulable: (on) => calls.push(on ? 'node takes pods' : 'node takes no pod') };
  const run = new ClusterRun({ publicUrl: 'http://localhost:12345' }, cluster, {});
  run.startArchiveScan = async (kind) => {
    calls.push(`start ${kind}`);
    if (kind === failStart) throw new Error(`${kind}: the archive upload answered HTTP 500`);
    return { kind, projectId: `project-${kind}`, scanId: kind };
  };
  run.scanState = async ({ scanId }) => ({ state: stateOf(scanId) });
  return { run, calls };
}

test('ClusterRun.startScansHeld holds the pods before the first scan starts, and lets them go once the queue has formed', async () => {
  const { run, calls } = heldRun((id) => (KINDS.indexOf(id) < 2 ? 'running' : 'queued'));
  const samples = [];
  const scans = await run.startScansHeld(samples);
  assert.deepEqual(calls, ['node takes no pod', ...KINDS.map((k) => `start ${k}`), 'node takes pods']);
  assert.deepEqual(
    scans.map((s) => s.kind),
    KINDS,
  );
  assert.deepEqual(samples, [{ sast: 'running', cicd: 'running', secret: 'queued', iac: 'queued', sca: 'queued' }]);
});

test('ClusterRun.startScansHeld lets the pods go when a scan cannot start', async () => {
  const { run, calls } = heldRun(() => 'queued', { failStart: 'secret' });
  await assert.rejects(async () => run.startScansHeld([]), /HTTP 500/);
  assert.equal(calls.at(-1), 'node takes pods');
});

test('ClusterRun.startScansHeld fails, the pods let go, when more scans run than the limit', async () => {
  const { run, calls } = heldRun((id) => (KINDS.indexOf(id) < 3 ? 'running' : 'queued'));
  await assert.rejects(async () => run.startScansHeld([]), /3 scans ran at once, the limit is 2/);
  assert.equal(calls.at(-1), 'node takes pods');
});

test('the cluster variant starts its scans held, and judges the queue on what it read meanwhile', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../run.mjs', import.meta.url), 'utf8');
  const flow = source.slice(source.indexOf('  async scans() {'), source.indexOf('  async cleanup() {'));
  assert.ok(flow.includes('await this.startScansHeld(samples)'), 'scans() starts the scans through startScansHeld');
  assert.ok(flow.indexOf('await this.startScansHeld(samples)') < flow.indexOf('queueVerdict(samples,'), 'before the queue verdict, on the same samples');
});

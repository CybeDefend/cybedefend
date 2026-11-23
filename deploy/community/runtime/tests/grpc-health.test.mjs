import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkHealth } = require('../grpc-health.cjs');

function fakeClient(behaviour) {
  const calls = [];
  return {
    calls,
    Check(request, options, callback) {
      calls.push({ request, options });
      behaviour(callback);
    },
  };
}

test('SERVING is healthy', async () => {
  const client = fakeClient((callback) => setImmediate(() => callback(null, { status: 'SERVING' })));
  const before = Date.now();
  assert.equal(await checkHealth(client, 3000), true);
  assert.deepEqual(client.calls[0].request, { service: '' });
  const deadline = client.calls[0].options.deadline;
  const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline;
  assert.ok(deadlineMs >= before + 3000 && deadlineMs <= Date.now() + 3000);
});

test('NOT_SERVING, an error or the deadline is unhealthy', async () => {
  for (const status of ['NOT_SERVING', 'UNKNOWN', 'SERVICE_UNKNOWN', undefined]) {
    const client = fakeClient((callback) => setImmediate(() => callback(null, { status })));
    assert.equal(await checkHealth(client, 3000), false, String(status));
  }
  const failing = fakeClient((callback) => setImmediate(() => callback(Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }))));
  assert.equal(await checkHealth(failing, 3000), false);

  const throwing = { Check() { throw new Error('channel closed'); } };
  assert.equal(await checkHealth(throwing, 3000), false);

  const silent = fakeClient(() => {});
  const started = Date.now();
  assert.equal(await checkHealth(silent, 50), false);
  assert.ok(Date.now() - started < 2000);
});

test('a late answer after the deadline changes nothing', async () => {
  let late;
  const client = fakeClient((callback) => {
    late = callback;
  });
  assert.equal(await checkHealth(client, 20), false);
  assert.doesNotThrow(() => late(null, { status: 'SERVING' }));
});

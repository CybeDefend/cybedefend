import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSchema, readPresharedKey } from '../load-schema.mjs';

const SCHEMA_TEXT = 'entity user {}\n\nentity organization {\n  relation member @user\n  permission read = member\n}\n';

async function startFake(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'load-schema-'));
  const schemaPath = join(dir, 'schema.perm');
  await writeFile(schemaPath, SCHEMA_TEXT);
  return { schemaPath, outFile: join(dir, 'out', 'permify-schema-version') };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test('waits for /healthz, posts the schema as {"schema": text} to tenant t1 and writes schema_version', async () => {
  let healthCalls = 0;
  let written;
  const fake = await startFake(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      healthCalls += 1;
      res.writeHead(healthCalls <= 2 ? 503 : 200).end();
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/tenants/t1/schemas/write') {
      written = await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"schema_version":"cr1abc"}');
      return;
    }
    res.writeHead(404).end();
  });
  try {
    const { schemaPath, outFile } = await workspace();
    const version = await loadSchema({ permifyUrl: fake.url, schemaPath, outFile, intervalMs: 10, timeoutMs: 5000 });
    assert.equal(version, 'cr1abc');
    assert.equal(healthCalls, 3);
    assert.equal(JSON.parse(written).schema, SCHEMA_TEXT);
    assert.equal(await readFile(outFile, 'utf8'), 'cr1abc');
    assert.equal((await stat(outFile)).mode & 0o777, 0o444);
  } finally {
    await fake.close();
  }
});

test('a non-200 write fails with the HTTP code', async () => {
  const fake = await startFake((req, res) => {
    if (req.url === '/healthz') return res.writeHead(200).end();
    res.writeHead(400, { 'content-type': 'application/json' }).end('{"code":"ERROR_CODE_INVALID_ARGUMENT"}');
  });
  try {
    const { schemaPath, outFile } = await workspace();
    await assert.rejects(
      loadSchema({ permifyUrl: fake.url, schemaPath, outFile, intervalMs: 10, timeoutMs: 5000 }),
      (err) => err.message.includes('400') && err.message.includes('ERROR_CODE_INVALID_ARGUMENT'),
    );
    assert.equal(await exists(outFile), false);
  } finally {
    await fake.close();
  }
});

test('an answer without schema_version fails', async () => {
  const fake = await startFake((req, res) => {
    if (req.url === '/healthz') return res.writeHead(200).end();
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  try {
    const { schemaPath, outFile } = await workspace();
    await assert.rejects(
      loadSchema({ permifyUrl: fake.url, schemaPath, outFile, intervalMs: 10, timeoutMs: 5000 }),
      /schema_version/,
    );
    assert.equal(await exists(outFile), false);
  } finally {
    await fake.close();
  }
});

test('gives up after timeoutMs when Permify never becomes healthy', async () => {
  let writes = 0;
  const fake = await startFake((req, res) => {
    if (req.url === '/healthz') return res.writeHead(503).end();
    writes += 1;
    res.writeHead(200).end('{"schema_version":"x"}');
  });
  try {
    const { schemaPath, outFile } = await workspace();
    const started = Date.now();
    await assert.rejects(
      loadSchema({ permifyUrl: fake.url, schemaPath, outFile, timeoutMs: 300, intervalMs: 50 }),
      /healthy/,
    );
    assert.ok(Date.now() - started < 3000);
    assert.equal(writes, 0);
    assert.equal(await exists(outFile), false);
  } finally {
    await fake.close();
  }
});

test('also gives up when Permify cannot be reached at all', async () => {
  const fake = await startFake((req, res) => res.writeHead(200).end());
  const url = fake.url;
  await fake.close();
  const { schemaPath, outFile } = await workspace();
  await assert.rejects(loadSchema({ permifyUrl: url, schemaPath, outFile, timeoutMs: 300, intervalMs: 50 }), /healthy/);
});

test('sends the preshared key as a Bearer authorization on the schema write', async () => {
  let authorization;
  const fake = await startFake(async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200).end();
      return;
    }
    authorization = req.headers.authorization;
    await readBody(req);
    if (authorization !== 'Bearer the-key') {
      res.writeHead(401, { 'content-type': 'application/json' }).end('{"code":16,"message":"ERROR_CODE_INVALID_KEY"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"schema_version":"v-auth"}');
  });
  try {
    const { schemaPath, outFile } = await workspace();
    const version = await loadSchema({ permifyUrl: fake.url, schemaPath, outFile, presharedKey: 'the-key', intervalMs: 10, timeoutMs: 5000 });
    assert.equal(version, 'v-auth');
    assert.equal(authorization, 'Bearer the-key');
  } finally {
    await fake.close();
  }
});

test('a refused key fails without printing the key', async () => {
  const fake = await startFake(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200).end();
      return;
    }
    await readBody(req);
    res.writeHead(401, { 'content-type': 'application/json' }).end('{"code":16,"message":"ERROR_CODE_INVALID_KEY"}');
  });
  try {
    const { schemaPath, outFile } = await workspace();
    await assert.rejects(
      loadSchema({ permifyUrl: fake.url, schemaPath, outFile, presharedKey: 'secret-key-value', intervalMs: 10, timeoutMs: 5000 }),
      (err) => /HTTP 401/.test(err.message) && !err.message.includes('secret-key-value'),
    );
  } finally {
    await fake.close();
  }
});

test('reads the key from PERMIFY_PRESHARED_KEY_FILE, trailing whitespace removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'load-schema-key-'));
  const file = join(dir, 'permify-preshared-key');
  await writeFile(file, 'file-key\n');
  assert.equal(await readPresharedKey({ PERMIFY_PRESHARED_KEY_FILE: file }), 'file-key');
  assert.equal(await readPresharedKey({ PERMIFY_PRESHARED_KEY: 'env-key', PERMIFY_PRESHARED_KEY_FILE: file }), 'env-key');
  assert.equal(await readPresharedKey({}), undefined);
  await assert.rejects(readPresharedKey({ PERMIFY_PRESHARED_KEY_FILE: join(dir, 'missing') }), /PERMIFY_PRESHARED_KEY_FILE/);
});

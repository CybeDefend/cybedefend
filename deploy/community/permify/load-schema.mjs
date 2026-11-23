#!/usr/bin/env node
// CybeDefend Community Edition: writes the Permify schema once, at start-up.
//
// Waits for Permify's /healthz, posts the schema as {"schema": <text>} to
// tenant t1 (as apps/permify-service/permify-updater/entrypoint.sh does in the
// cloud), and writes the schema version it answers to a file the services
// read through PERMIFY_SCHEMA_VERSION_FILE.
//
// CLI: node load-schema.mjs
//   PERMIFY_URL                 default http://permify:3476
//   PERMIFY_SCHEMA_PATH         default /schema/schema.perm
//   PERMIFY_SCHEMA_VERSION_OUT  default /run/cybedefend/permify-schema-version
//   PERMIFY_PRESHARED_KEY, else the content of PERMIFY_PRESHARED_KEY_FILE:
//     the key Permify requires (sent as authorization: Bearer <key>)

import { readFile, writeFile, rename, mkdir, chmod, rm } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const TENANT = 't1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitHealthy(permifyUrl, fetchImpl, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    try {
      const res = await fetchImpl(`${permifyUrl}/healthz`, { signal: AbortSignal.timeout(Math.max(1, Math.min(left, 5000))) });
      if (res.status === 200) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err && err.name ? err.name : 'error';
    }
    const wait = Math.min(intervalMs, deadline - Date.now());
    if (wait <= 0) break;
    await sleep(wait);
  }
  throw new Error(`Permify did not become healthy within ${timeoutMs} ms (last: ${last})`);
}

async function writeAtomically(outFile, content) {
  await mkdir(dirname(outFile), { recursive: true });
  const tmp = join(dirname(outFile), `.${basename(outFile)}.${process.pid}.tmp`);
  try {
    await writeFile(tmp, content, { mode: 0o444 });
    await chmod(tmp, 0o444);
    await rename(tmp, outFile);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** The preshared key: PERMIFY_PRESHARED_KEY, else the file PERMIFY_PRESHARED_KEY_FILE names. */
export async function readPresharedKey(env) {
  if (env.PERMIFY_PRESHARED_KEY) return env.PERMIFY_PRESHARED_KEY;
  const file = env.PERMIFY_PRESHARED_KEY_FILE;
  if (!file) return undefined;
  try {
    return (await readFile(file, 'utf8')).replace(/\s+$/, '');
  } catch {
    // Never the content, only the path.
    throw new Error(`PERMIFY_PRESHARED_KEY_FILE points to a file that cannot be read: ${file}`);
  }
}

export async function loadSchema({ permifyUrl, schemaPath, outFile, presharedKey, fetchImpl = fetch, timeoutMs = 120000, intervalMs = 1000 }) {
  const base = permifyUrl.replace(/\/+$/, '');
  const schema = await readFile(schemaPath, 'utf8');
  await waitHealthy(base, fetchImpl, timeoutMs, intervalMs);

  const res = await fetchImpl(`${base}/v1/tenants/${TENANT}/schemas/write`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(presharedKey ? { authorization: `Bearer ${presharedKey}` } : {}),
    },
    body: JSON.stringify({ schema }),
  });
  const body = await res.text();
  if (res.status !== 200) {
    throw new Error(`Permify refused the schema: HTTP ${res.status}, response: ${body}`);
  }
  let version;
  try {
    version = JSON.parse(body).schema_version;
  } catch {
    version = undefined;
  }
  if (typeof version !== 'string' || version === '') {
    throw new Error(`Permify answered without a schema_version: ${body}`);
  }
  await writeAtomically(outFile, version);
  return version;
}

async function main() {
  try {
    const version = await loadSchema({
      permifyUrl: process.env.PERMIFY_URL || 'http://permify:3476',
      schemaPath: process.env.PERMIFY_SCHEMA_PATH || '/schema/schema.perm',
      outFile: process.env.PERMIFY_SCHEMA_VERSION_OUT || '/run/cybedefend/permify-schema-version',
      presharedKey: await readPresharedKey(process.env),
    });
    console.log(`permify schema written: version ${version}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

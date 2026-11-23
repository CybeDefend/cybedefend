// CybeDefend Community Edition: the services' start hook for Redis.
//
// Loaded before each service (NODE_OPTIONS=--require <this file>). Redis
// requires a password (requirepass), derived from CYBEDEFEND_SECRET_KEY by
// derive-secrets.mjs into the file REDIS_PASSWORD_FILE names. This hook hands
// it to every Redis client of the process:
//   REDIS_PASSWORD, read by the clients configured by host and port;
//   REDIS_URL and REALTIME_REDIS_URL, rewritten to redis://:<password>@host:port
//   unless they already carry a password.
// An explicit REDIS_PASSWORD wins over the file. Without REDIS_PASSWORD_FILE
// nothing changes. A missing or empty file stops the process: a service must
// not start without the credential its Redis requires. Never prints a secret.
'use strict';

const { readFileSync } = require('node:fs');

const URL_VARIABLES = ['REDIS_URL', 'REALTIME_REDIS_URL'];

function readPassword(env) {
  const explicit = env.REDIS_PASSWORD;
  if (explicit !== undefined && explicit !== '') return explicit;
  const file = env.REDIS_PASSWORD_FILE;
  if (file === undefined || file === '') return undefined;
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`REDIS_PASSWORD_FILE points to a file that cannot be read: ${file}`);
  }
  const password = content.trim();
  if (password === '') throw new Error(`REDIS_PASSWORD_FILE points to an empty file: ${file}`);
  return password;
}

function withPassword(value, password) {
  let url;
  try {
    url = new URL(value);
  } catch {
    // Not a URL: left for the service's own configuration check to refuse.
    return value;
  }
  if (url.password !== '') return value;
  url.password = password;
  return url.toString();
}

function applyRedisAuth(env) {
  const password = readPassword(env);
  if (password === undefined) return;
  env.REDIS_PASSWORD = password;
  for (const name of URL_VARIABLES) {
    const value = env[name];
    if (value !== undefined && value !== '') env[name] = withPassword(value, password);
  }
}

module.exports = { applyRedisAuth };

try {
  applyRedisAuth(process.env);
} catch (err) {
  // The message names a variable and a path, never the password.
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}

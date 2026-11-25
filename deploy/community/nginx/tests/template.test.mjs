import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const TEMPLATE = read('../templates/default.conf.template');
const NGINX_CONF = read('../nginx.conf');

function apiLocation() {
  const start = TEMPLATE.indexOf('location /api/ {');
  assert.notEqual(start, -1, 'location /api/ { is missing');
  return TEMPLATE.slice(start, TEMPLATE.indexOf('\n    }', start));
}

test('proxies /api/ to the gateway without buffering', () => {
  const block = apiLocation();
  for (const line of [
    'proxy_pass http://${GATEWAY_UPSTREAM}/;',
    'proxy_buffering off;',
    'proxy_read_timeout 3600s;',
    'proxy_http_version 1.1;',
  ]) {
    assert.ok(block.includes(line), `missing in location /api/: ${line}`);
  }
});

test('leaves the cookie path to the gateway', () => {
  assert.ok(!TEMPLATE.includes('proxy_cookie_path'));
});

function nestedLocation(header) {
  const start = TEMPLATE.indexOf(header);
  assert.notEqual(start, -1, `${header} is missing`);
  return TEMPLATE.slice(start, TEMPLATE.indexOf('\n        }', start));
}

const UPLOAD_LOCATION = 'location ~ ^/api/(project/[0-9a-fA-F-]+/scan/import/start|scan-runs/[0-9a-fA-F-]+/results)$ {';
const WEBHOOK_LOCATION = 'location /api/webhooks/ {';

test('reads at most 1 MB of a request body by default, as the gateway does', () => {
  const server = TEMPLATE.slice(TEMPLATE.indexOf('server {'), TEMPLATE.indexOf('location /api/ {'));
  assert.ok(server.includes('client_max_body_size 1m;'));
  assert.equal(TEMPLATE.match(/client_max_body_size 101m;/g)?.length, 1, 'only one location takes an upload');
});

test('lets an import of two 50 MB files (a SARIF and its SBOM) reach the gateway on the upload routes only', () => {
  const block = nestedLocation(UPLOAD_LOCATION);
  assert.ok(apiLocation().includes(UPLOAD_LOCATION), 'nested in location /api/');
  for (const line of [
    'client_max_body_size 101m;',
    'client_body_timeout 30s;',
    'proxy_request_buffering off;',
    'rewrite ^/api/(.*)$ /$1 break;',
    'proxy_pass http://${GATEWAY_UPSTREAM};',
  ]) {
    assert.ok(block.includes(line), `missing in the upload location: ${line}`);
  }
  const re = /^\/api\/(project\/[0-9a-fA-F-]+\/scan\/import\/start|scan-runs\/[0-9a-fA-F-]+\/results)$/;
  assert.ok(re.test('/api/project/550e8400-e29b-41d4-a716-446655440000/scan/import/start'));
  assert.ok(re.test('/api/scan-runs/1f0b7c1e-9c1a-6a40-8000-000000000000/results'));
  assert.ok(!re.test('/api/project/x/vulnerabilities'));
  assert.ok(!re.test('/api/project/550e8400/scan/import/start/extra'));
});

test('the upload location takes a multipart body only: anything else is refused before it is read', () => {
  const block = nestedLocation(UPLOAD_LOCATION);
  const guard = block.indexOf('if ($content_type !~* "^multipart/form-data") {');
  assert.notEqual(guard, -1, 'the content type is checked');
  assert.ok(block.slice(guard).includes('return 415;'));
  assert.ok(guard < block.indexOf('proxy_pass'), 'before the request is passed on');
  const re = /^multipart\/form-data/i;
  assert.ok(re.test('multipart/form-data; boundary=x'));
  assert.ok(!re.test('application/json'));
  assert.ok(!re.test('text/plain'));
});

test('lets a webhook body up to the gateway webhook cap through', () => {
  const block = nestedLocation(WEBHOOK_LOCATION);
  assert.ok(apiLocation().includes(WEBHOOK_LOCATION), 'nested in location /api/');
  assert.ok(block.includes('client_max_body_size 4m;'));
  assert.ok(block.includes('proxy_pass http://${GATEWAY_UPSTREAM}/webhooks/;'));
});

test('overwrites X-Forwarded-For with the client address', () => {
  assert.ok(apiLocation().includes('proxy_set_header X-Forwarded-For $remote_addr;'));
  assert.ok(!TEMPLATE.includes('$proxy_add_x_forwarded_for'));
});

test('drops a client-supplied CF-Connecting-IP', () => {
  assert.ok(apiLocation().includes('proxy_set_header CF-Connecting-IP "";'));
});

test('its CSP names no cybedefend.com origin and allows the storage URL', () => {
  assert.ok(!TEMPLATE.includes('cybedefend.com'));
  assert.ok(TEMPLATE.includes("connect-src 'self' ${CYBEDEFEND_STORAGE_PUBLIC_URL}"));
});

test('serves the SPA with an index fallback', () => {
  assert.ok(TEMPLATE.includes('try_files $uri $uri/ /index.html;'));
  assert.ok(TEMPLATE.includes('listen 8080;'));
  assert.ok(TEMPLATE.includes('root /usr/share/nginx/html;'));
});

test('reads only the two variables envsubst renders', () => {
  const braced = [...TEMPLATE.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(braced)].sort(), ['CYBEDEFEND_STORAGE_PUBLIC_URL', 'GATEWAY_UPSTREAM']);
});

test('nginx.conf includes the rendered templates from /tmp/conf.d', () => {
  assert.ok(NGINX_CONF.includes('include /tmp/conf.d/*.conf;'));
  assert.ok(!NGINX_CONF.includes('/etc/nginx/conf.d'));
  assert.ok(NGINX_CONF.includes('pid /tmp/nginx.pid;'));
});

test('takes X-Forwarded-Proto only from a trusted proxy, else the scheme of the connection', () => {
  // The source is the peer's own address ($realip_remote_addr), matched against
  // CYBEDEFEND_TRUSTED_PROXIES by the geo block rendered at start.
  assert.ok(TEMPLATE.includes('include /tmp/cybedefend/trusted-proxy.conf;'), 'the geo block of the trusted proxies is included');
  assert.ok(TEMPLATE.indexOf('include /tmp/cybedefend/trusted-proxy.conf;') < TEMPLATE.indexOf('server {'), 'at http level');
  const map = /map "\$cd_trusted_proxy:\$http_x_forwarded_proto" \$cd_forwarded_proto \{([^}]*)\}/.exec(TEMPLATE);
  assert.ok(map, 'the forwarded scheme is keyed on the trust of the peer');
  const entries = map[1].split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(entries, ['default $scheme;', '"1:https" https;', '"1:http" http;']);
  assert.ok(!/map \$http_x_forwarded_proto/.test(TEMPLATE), 'no map trusts the client header alone');
  assert.ok(apiLocation().includes('proxy_set_header X-Forwarded-Proto $cd_forwarded_proto;'));
  assert.match(TEMPLATE, /map \$cd_forwarded_proto \$cd_hsts \{/);
});

test('nginx names no version', () => {
  assert.ok(NGINX_CONF.includes('server_tokens off;'));
});

test('serves config.js from /tmp, where the read-only container writes it at start', () => {
  assert.match(TEMPLATE, /location = \/config\.js \{\s*alias \/tmp\/config\.js;\s*\}/);
});

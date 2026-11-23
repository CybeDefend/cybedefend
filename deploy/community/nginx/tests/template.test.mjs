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

test('lets an import of two 50 MB files (a SARIF and its SBOM) reach the gateway', () => {
  assert.ok(TEMPLATE.includes('client_max_body_size 101m;'));
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

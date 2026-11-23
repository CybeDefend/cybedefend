// The front's trusted proxies: CYBEDEFEND_TRUSTED_PROXIES is rendered, at
// start, into the real-ip directives the front's server block includes. A
// value that is not a list of IPv4/IPv6 addresses or CIDRs stops the front
// before nginx starts, and is never rendered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../entrypoint.d/15-cybedefend-trusted-proxies.sh', import.meta.url));
const TEMPLATE = readFileSync(fileURLToPath(new URL('../templates/default.conf.template', import.meta.url)), 'utf8');
const REAL_IP_CONF = '/tmp/cybedefend/real-ip.conf';

/** Runs the entrypoint script with the value, into a temporary file; geo: the trusted-proxy.conf beside it. */
function render(value) {
  const dir = mkdtempSync(join(tmpdir(), 'cd-trusted-proxies-'));
  const out = join(dir, 'sub', 'real-ip.conf');
  const geoOut = join(dir, 'sub', 'trusted-proxy.conf');
  try {
    const env = { PATH: process.env.PATH };
    if (value !== undefined) env.CYBEDEFEND_TRUSTED_PROXIES = value;
    const res = spawnSync('sh', [SCRIPT, out], { encoding: 'utf8', env });
    return {
      status: res.status,
      stderr: res.stderr,
      conf: existsSync(out) ? readFileSync(out, 'utf8') : null,
      geo: existsSync(geoOut) ? readFileSync(geoOut, 'utf8') : null,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const directives = (conf) =>
  conf
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

test('the server block includes the rendered real-ip file', () => {
  const server = TEMPLATE.slice(TEMPLATE.indexOf('server {'));
  const include = `include ${REAL_IP_CONF};`;
  assert.ok(server.includes(include), `missing in server: ${include}`);
  assert.ok(server.indexOf(include) < server.indexOf('location /api/ {'), 'included before the locations');
  assert.match(readFileSync(SCRIPT, 'utf8'), new RegExp(`out="\\$\\{1:-${REAL_IP_CONF.replaceAll('/', '\\/')}\\}"`));
});

test('the script is executable, or the nginx image skips it and nginx stops on the missing include', () => {
  assert.ok(statSync(SCRIPT).mode & 0o111, `${SCRIPT} is not executable`);
});

test('unset or empty: no proxy is trusted, nothing is rendered but a comment', () => {
  for (const value of [undefined, '', '   ']) {
    const r = render(value);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(directives(r.conf), [], JSON.stringify(value));
    assert.deepEqual(directives(r.geo), ['geo $realip_remote_addr $cd_trusted_proxy {', 'default 0;', '}'], JSON.stringify(value));
  }
});

test('the same proxies, and they alone, may say the scheme: a geo block on the peer address', () => {
  const r = render(' 172.17.0.1 , fd00::/8');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(directives(r.geo), [
    'geo $realip_remote_addr $cd_trusted_proxy {',
    'default 0;',
    '172.17.0.1 1;',
    'fd00::/8 1;',
    '}',
  ]);
});

test('one CIDR: trusted, and the client address is read from X-Forwarded-For', () => {
  const r = render('10.0.0.0/8');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(directives(r.conf), [
    'set_real_ip_from 10.0.0.0/8;',
    'real_ip_header X-Forwarded-For;',
    'real_ip_recursive on;',
  ]);
});

test('several values, addresses and CIDRs, spaces around the commas', () => {
  const r = render(' 172.17.0.1 , 192.168.10.0/24,203.0.113.7/32 ');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(directives(r.conf), [
    'set_real_ip_from 172.17.0.1;',
    'set_real_ip_from 192.168.10.0/24;',
    'set_real_ip_from 203.0.113.7/32;',
    'real_ip_header X-Forwarded-For;',
    'real_ip_recursive on;',
  ]);
});

test('IPv6 addresses and CIDRs', () => {
  const ok = ['::1', 'fd00::/8', '2001:db8::/32', '2001:0db8:85a3:0000:0000:8a2e:0370:7334', '::ffff:192.0.2.1', 'fe80::1/64', '2001:db8::1:0:0:1'];
  const r = render(ok.join(','));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(
    directives(r.conf).filter((l) => l.startsWith('set_real_ip_from')),
    ok.map((v) => `set_real_ip_from ${v};`),
  );
});

test('an invalid value refuses to start, says why, and renders nothing', () => {
  const bad = [
    'proxy.example.com',
    '10.0.0.0/33',
    '256.1.1.1',
    '10.0.0',
    '10.0.0.01',
    '10.0.0.0/08',
    '10.0.0.0/',
    '/24',
    '10.0.0.0/8/8',
    '10.0.0.0/8,',
    '10.0.0.0/8;,10.0.0.1',
    '10.0.0.1; include /etc/passwd',
    '10.0.0.1\nreal_ip_header X-Real-IP',
    'unix:',
    '0.0.0.0/0',
    '::/0',
    '2001:db8::/129',
    '1::2::3',
    ':::1',
    '1:2:3:4:5:6:7:8:9',
    '1:2:3:4:5:6:7',
    '12345::1',
    'g::1',
    '1.2.3.4::',
    '::1.2.3',
    '$remote_addr',
  ];
  for (const value of bad) {
    const r = render(value);
    assert.notEqual(r.status, 0, `accepted: ${JSON.stringify(value)}`);
    assert.equal(r.conf, null, `rendered for ${JSON.stringify(value)}`);
    assert.equal(r.geo, null, `geo rendered for ${JSON.stringify(value)}`);
    assert.match(r.stderr, /CYBEDEFEND_TRUSTED_PROXIES/, JSON.stringify(value));
  }
});

test('a refused value leaves no earlier rendering in place', () => {
  // The entry point writes a temporary file and renames it: a failed start
  // never leaves a file nginx could read. Simulated with the same path twice.
  const dir = mkdtempSync(join(tmpdir(), 'cd-trusted-proxies-'));
  const out = join(dir, 'real-ip.conf');
  try {
    const run = (v) => spawnSync('sh', [SCRIPT, out], { encoding: 'utf8', env: { PATH: process.env.PATH, CYBEDEFEND_TRUSTED_PROXIES: v } });
    assert.equal(run('10.0.0.0/8').status, 0);
    assert.ok(existsSync(join(dir, 'trusted-proxy.conf')));
    assert.notEqual(run('nope').status, 0);
    assert.ok(!existsSync(out), 'the previous rendering is removed on a refusal');
    assert.ok(!existsSync(join(dir, 'trusted-proxy.conf')), 'the previous geo block is removed on a refusal');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

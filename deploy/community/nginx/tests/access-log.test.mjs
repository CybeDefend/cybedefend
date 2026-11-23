// The front's access log never writes an invitation token nor a query string:
// the path segment after /invite/ and /api/auth/invitations/ is masked, in the
// request and in the Referer, and every query string is dropped.
//
// The maps of nginx.conf are read and applied here as nginx applies them
// (the first matching regex wins; its named captures fill the value), so the
// sample lines below go through the very regexes nginx runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NGINX_CONF = readFileSync(fileURLToPath(new URL('../nginx.conf', import.meta.url)), 'utf8');
const TEMPLATE = readFileSync(fileURLToPath(new URL('../templates/default.conf.template', import.meta.url)), 'utf8');
const TOKEN = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef';

/** The entries of `map <source> <target> { … }` in nginx.conf. */
function mapOf(source, target) {
  const re = new RegExp(`map \\${source} \\${target} \\{\\n([\\s\\S]*?)\\n\\s*\\}\\n`);
  const m = re.exec(NGINX_CONF);
  assert.ok(m, `nginx.conf has map ${source} ${target}`);
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const e = /^("[^"]*"|\S+)\s+("[^"]*"|\S+);$/.exec(l);
      assert.ok(e, `unreadable map line: ${l}`);
      const unquote = (t) => (t.startsWith('"') ? t.slice(1, -1) : t);
      return { key: unquote(e[1]), value: unquote(e[2]) };
    });
}

/** Applies a map as nginx does: exact keys, then regexes in order, then default. */
function applyMap(entries, input) {
  const exact = entries.find((e) => !e.key.startsWith('~') && e.key !== 'default' && e.key === input);
  if (exact) return exact.value;
  for (const e of entries.filter((x) => x.key.startsWith('~'))) {
    const caseless = e.key.startsWith('~*');
    const m = new RegExp(e.key.slice(caseless ? 2 : 1), caseless ? 'i' : '').exec(input);
    if (m) return e.value.replace(/\$\{?(\w+)\}?/g, (_, name) => m.groups?.[name] ?? '');
  }
  return entries.find((e) => e.key === 'default')?.value ?? '';
}

const loggedUri = (uri) => applyMap(mapOf('$request_uri', '$cd_log_uri'), uri);
const loggedReferer = (ref) => applyMap(mapOf('$http_referer', '$cd_log_referer'), ref);

test('the invitation page is logged without its token', () => {
  assert.equal(loggedUri(`/invite/${TOKEN}`), '/invite/***');
  assert.equal(loggedUri(`/invite/${TOKEN}?utm_source=mail`), '/invite/***');
  assert.equal(loggedUri(`//invite/${TOKEN}`), '//invite/***');
});

test('the invitation API is logged without its token', () => {
  assert.equal(loggedUri(`/api/auth/invitations/${TOKEN}/accept`), '/api/auth/invitations/***/accept');
  assert.equal(loggedUri(`/api/auth/invitations/${TOKEN}`), '/api/auth/invitations/***');
  assert.equal(loggedUri(`/api/auth/invitations/${TOKEN}/accept?x=${TOKEN}`), '/api/auth/invitations/***/accept');
});

test('the Jira webhook is logged without its token', () => {
  assert.equal(loggedUri(`/api/webhooks/jira/${TOKEN}`), '/api/webhooks/jira/***');
  assert.equal(loggedUri(`//api//webhooks/jira/${TOKEN}?x=1`), '//api//webhooks/jira/***');
  assert.equal(loggedReferer(`https://appsec.example.com/api/webhooks/jira/${TOKEN}`), 'https://appsec.example.com/api/webhooks/jira/***');
  assert.equal(loggedUri('/api/webhooks/github'), '/api/webhooks/github');
});

test('every other path is logged as is, without its query string', () => {
  assert.equal(loggedUri('/api/projects/123/results'), '/api/projects/123/results');
  assert.equal(loggedUri(`/reset-password?token=${TOKEN}`), '/reset-password');
  assert.equal(loggedUri('/assets/index.js?v=1'), '/assets/index.js');
  assert.equal(loggedUri('/'), '/');
});

test('the Referer is masked the same way', () => {
  assert.equal(loggedReferer(`https://appsec.example.com/invite/${TOKEN}`), 'https://appsec.example.com/invite/***');
  assert.equal(loggedReferer(`https://appsec.example.com/reset-password?token=${TOKEN}`), 'https://appsec.example.com/reset-password');
  assert.equal(loggedReferer(`https://appsec.example.com/invite/${TOKEN}#x`), 'https://appsec.example.com/invite/***');
  assert.equal(loggedReferer('https://appsec.example.com/projects'), 'https://appsec.example.com/projects');
  assert.equal(loggedReferer(''), '-', 'no Referer is written -, as in the combined format');
});

test('the access log uses the masked format, which names no raw request field', () => {
  const format = /log_format\s+cd_masked\s+([\s\S]*?);/.exec(NGINX_CONF);
  assert.ok(format, 'nginx.conf declares log_format cd_masked');
  const fields = format[1];
  for (const v of ['$cd_log_uri', '$cd_log_referer', '$remote_addr', '$status', '$body_bytes_sent', '$http_user_agent', '$time_local', '$request_method']) {
    assert.ok(fields.includes(v), `cd_masked logs ${v}`);
  }
  for (const raw of ['$request ', '$request"', "$request'", '$request_uri', '$uri', '$args', '$query_string', '$http_referer', '$request_line']) {
    assert.ok(!fields.includes(raw), `cd_masked never logs ${raw}`);
  }
  const logs = [...(NGINX_CONF + TEMPLATE).matchAll(/^\s*access_log\s+([^;]+);/gm)].map((m) => m[1].trim());
  assert.ok(logs.length > 0, 'an access_log is declared');
  for (const l of logs) assert.match(l, /^(\S+\s+cd_masked|off)$/, `access_log ${l}`);
});

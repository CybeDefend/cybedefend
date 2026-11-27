// node --test skills/cybedefend/scripts/usage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeCode, runUsage, shortCount, sumCalls, usageLine } from './usage.mjs';
import { eachLine } from './usage-log.mjs';

const ID = '5561bb8e-b9b0-4d40-9e7a-fac486109630';
const at = (min) => new Date(Date.UTC(2026, 10, 27, 9, min)).toISOString();
const prompt = (min, content = 'run the audit') => ({ type: 'user', timestamp: at(min), message: { role: 'user', content } });
const toolResult = (min) => ({ type: 'user', timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } });
const answer = (min, id, usage, model = 'claude-opus-5-5') => ({
  type: 'assistant',
  timestamp: at(min),
  message: { id, model, role: 'assistant', usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0, ...usage } },
});

/** A fake ~/.claude with one session (and its sub-agents), in a folder removed after the test. */
function fakeHome(t, main, subAgents = {}) {
  const home = mkdtempSync(join(tmpdir(), 'usage-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, '.claude', 'projects', '-Users-someone-repo');
  mkdirSync(join(dir, ID, 'subagents'), { recursive: true });
  mkdirSync(join(home, '.claude', 'projects', '-Users-someone-other'), { recursive: true });
  const jsonl = (rows) => `${rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n')}\n`;
  writeFileSync(join(dir, `${ID}.jsonl`), jsonl(main));
  for (const [name, rows] of Object.entries(subAgents)) writeFileSync(join(dir, ID, 'subagents', `${name}.jsonl`), jsonl(rows));
  return home;
}

const env = { CLAUDE_CODE_SESSION_ID: ID };

test('counts each call once, from the prompt that started the run to the verdict, sub-agents included', (t) => {
  const home = fakeHome(
    t,
    [
      prompt(0, 'something else, before'),
      answer(1, 'msg_before', { output_tokens: 999 }),
      prompt(10, '/cybedefend'),
      // One answer, two blocks: the same usage twice.
      answer(10, 'msg_a', { input_tokens: 5, cache_creation_input_tokens: 1000, output_tokens: 200 }),
      answer(10, 'msg_a', { input_tokens: 5, cache_creation_input_tokens: 1000, output_tokens: 200 }),
      toolResult(11),
      answer(12, 'msg_b', { input_tokens: 3, cache_read_input_tokens: 5000, output_tokens: 50 }),
      'not json {',
      answer(13, 'msg_err', { output_tokens: 7 }, '<synthetic>'),
      answer(40, 'msg_after', { output_tokens: 999 }),
    ],
    { 'agent-1': [answer(14, 'msg_sub', { cache_read_input_tokens: 2000, output_tokens: 100 }, 'claude-sonnet-5-5')], 'agent-old': [answer(2, 'msg_old', { output_tokens: 999 })] },
  );
  // The first script ran two minutes after the prompt; finish at minute 30.
  const u = runUsage({ since: at(12), until: at(30), env, home });
  assert.equal(u.agent, 'Claude Code');
  assert.equal(u.since, at(10));
  assert.equal(u.calls, 3);
  assert.deepEqual([u.input, u.cacheWrite, u.cacheRead, u.output], [8, 1000, 7000, 350]);
  assert.equal(u.total, 8358);
  assert.equal(u.subAgents, 1);
  assert.deepEqual(u.models.map((m) => [m.model, m.calls, m.total]), [['claude-opus-5-5', 2, 6258], ['claude-sonnet-5-5', 1, 2100]]);
});

test('a tool result or a note of the harness does not move the start of the run', (t) => {
  const home = fakeHome(t, [prompt(10), answer(10, 'm1', { output_tokens: 1 }), toolResult(11), { ...prompt(11, 'skill text'), isMeta: true }, answer(12, 'm2', { output_tokens: 1 })]);
  assert.equal(runUsage({ since: at(12), until: at(20), env, home }).calls, 2);
});

test('null when no reader knows the harness, the session id is not one, or the log is missing', (t) => {
  const home = fakeHome(t, [prompt(10), answer(10, 'm1', { output_tokens: 1 })]);
  assert.equal(runUsage({ since: at(10), until: at(20), env: {}, home }), null);
  assert.equal(runUsage({ since: at(10), until: at(20), env: { CLAUDE_CODE_SESSION_ID: '../../etc/passwd' }, home }), null);
  assert.equal(runUsage({ since: at(10), until: at(20), env: { CLAUDE_CODE_SESSION_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, home }), null);
  assert.equal(runUsage({ since: at(10), until: at(20), env, home: join(home, 'nowhere') }), null);
  assert.equal(runUsage({ since: null, until: at(20), env, home }), null);
  assert.equal(runUsage({ since: at(30), until: at(20), env, home }), null);
});

test('CLAUDE_CONFIG_DIR replaces ~/.claude', (t) => {
  const home = fakeHome(t, [prompt(10), answer(10, 'm1', { output_tokens: 4 })]);
  assert.equal(runUsage({ since: at(10), until: at(20), env: { ...env, CLAUDE_CONFIG_DIR: join(home, '.claude') }, home: '/nonexistent' }).output, 4);
});

test('another harness is one more reader', () => {
  const fake = { name: 'Other', detect: (e) => e.OTHER === '1', read: () => ({ calls: [{ model: 'm', input: 1, cacheWrite: 0, cacheRead: 0, output: 2 }], subAgents: 0, since: at(0) }) };
  const u = runUsage({ since: at(0), until: at(1), env: { OTHER: '1' }, readers: [claudeCode, fake] });
  assert.equal(u.agent, 'Other');
  assert.equal(u.total, 3);
});

test('the sentence and the short counts', () => {
  assert.equal(shortCount(999), '999');
  assert.equal(shortCount(1234), '1.2 k');
  assert.equal(shortCount(45678), '46 k');
  assert.equal(shortCount(1234567), '1.23 M');
  assert.equal(shortCount(12345678), '12.3 M');
  const u = { agent: 'Claude Code', subAgents: 2, ...sumCalls([{ model: 'x', input: 10, cacheWrite: 2000, cacheRead: 1_000_000, output: 30_000 }]) };
  assert.equal(usageLine(u), '1.03 M tokens over 1 model call (x): 1.00 M read from the prompt cache, 2.0 k written to it, 10 of other input, 30 k of output, 2 sub-agents included. Read from the Claude Code session log, from the message that started this run up to its verdict.');
  assert.equal(usageLine(null), '');
});

test('a notification of the harness is not the prompt that started the run', (t) => {
  const note = { ...prompt(11, '<task-notification>done</task-notification>'), origin: { kind: 'task-notification' }, promptSource: 'system' };
  const typed = { ...prompt(10, '/cybedefend'), origin: { kind: 'human' } };
  const home = fakeHome(t, [typed, answer(10, 'm1', { output_tokens: 100 }), note, answer(11, 'm2', { output_tokens: 200 }), prompt(11, '[Request interrupted by user]'), answer(12, 'm3', { output_tokens: 1 })]);
  assert.equal(runUsage({ since: at(12), until: at(20), env, home }).output, 301);
});

test('null when the run did not start in this session, or the session was not at work during it', (t) => {
  const home = fakeHome(t, [prompt(10), answer(10, 'm1', { output_tokens: 1 })]);
  // A watch state from before this session: no prompt before it here.
  assert.equal(runUsage({ since: at(5), until: at(20), env, home }), null);
  // An id inherited from a session that was idle for hours.
  assert.equal(runUsage({ since: new Date(Date.UTC(2026, 10, 27, 14)), until: new Date(Date.UTC(2026, 10, 27, 15)), env, home }), null);
  // A bare date is not a time.
  assert.equal(runUsage({ since: '2026-11-27', until: at(20), env, home }), null);
  assert.equal(runUsage({ since: at(10), until: at(20), env: { ...env, CYBEDEFEND_NO_USAGE: '1' }, home }), null);
});

test('the counts round before they choose their unit', () => {
  assert.equal(shortCount(999_499), '999 k');
  assert.equal(shortCount(999_500), '1.00 M');
  assert.equal(shortCount(9_949), '9.9 k');
  assert.equal(shortCount(9_950), '10 k');
  assert.equal(shortCount(9_999_999), '10.0 M');
});

test('a log is read a line at a time, an overlong line skipped', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lines-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'log.jsonl');
  writeFileSync(file, `a\n${'x'.repeat(3 * 1024 * 1024)}\nb\nc`);
  const seen = [];
  assert.equal(eachLine(file, (l) => seen.push(l), { maxLine: 1024 * 1024 }), true);
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.equal(eachLine(file, () => {}, { maxBytes: 10 }), false);
});

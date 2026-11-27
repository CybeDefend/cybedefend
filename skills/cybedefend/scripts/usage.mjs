// What the run cost the coding agent, in tokens: read from the agent's own
// session log on this machine, never estimated, never priced. The agent cannot
// see what it spends; its harness writes it down, each harness in its own
// format. One reader per harness turns that log into the same few numbers:
//
//   { agent, calls, input, cacheWrite, cacheRead, output, total, models: [...], subAgents }
//
// A harness with no reader here, or whose log cannot be found, gives null:
// the report then says nothing about tokens. Adding a harness is adding a
// reader to READERS: detect(env) says whether this process runs under it,
// read({ env, home, since, until }) returns the calls or null.
//
// What is counted: every model call of the session (and of its sub-agents)
// from the user's message that started the run (the last one before its first
// script) up to `until` (finish), each call once. Nothing leaves the machine
// and no log is changed. Known limits: the agent's own report after finish is
// not in it; the call a harness makes to compact a conversation is not logged
// as an answer; a session resumed under a new id keeps its earlier sub-agents
// under the old one. CYBEDEFEND_NO_USAGE=1 turns it off.

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** A session log larger than this is not read. */
const MAX_LOG_BYTES = 128 * 1024 * 1024;
/** A line longer than this (a huge tool result) is skipped: no answer's usage is that long. */
const MAX_LINE_BYTES = 4 * 1024 * 1024;
/** At most this many sub-agent logs are read. */
const MAX_SUB_AGENTS = 500;
/** The session must have been at work this close to the run's start and to finish: an inherited id of another session is not this run. */
const ACTIVE_WITHIN_MS = 30 * 60 * 1000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FIELDS = ['input', 'cacheWrite', 'cacheRead', 'output'];

const count = (n) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
/** A time with its zone, as a number; null for anything else (a bare date would widen the window). */
const time = (t) => {
  const ms = t instanceof Date ? t.getTime() : ISO.test(String(t ?? '')) ? Date.parse(t) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/**
 * Calls `fn` with each line of a file, read a megabyte at a time: a long
 * session log never sits whole in memory. False when the file cannot be read
 * or is larger than MAX_LOG_BYTES.
 */
export function eachLine(file, fn, { maxBytes = MAX_LOG_BYTES, maxLine = MAX_LINE_BYTES } = {}) {
  let fd;
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > maxBytes) return false;
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(1024 * 1024);
    let rest = Buffer.alloc(0);
    let skipping = false;
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0; ) {
      const chunk = rest.length ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n);
      let start = 0;
      for (let i; (i = chunk.indexOf(10, start)) !== -1; start = i + 1) {
        if (!skipping) fn(chunk.toString('utf8', start, i));
        skipping = false;
      }
      rest = Buffer.from(chunk.subarray(start));
      // A line too long to be an answer: dropped up to its end.
      if (rest.length > maxLine) {
        rest = Buffer.alloc(0);
        skipping = true;
      }
    }
    if (rest.length && !skipping) fn(rest.toString('utf8'));
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** True for a message the user typed: not a tool's result, not a note the harness added (a task notification, the skill's text). */
function isPrompt(r) {
  if (r?.type !== 'user' || r.isMeta || r.isSidechain || r.isCompactSummary) return false;
  // Recent logs say who wrote the entry; older ones do not.
  if (r.origin && r.origin.kind !== 'human') return false;
  if (r.promptSource && r.promptSource !== 'user') return false;
  const c = r.message?.content;
  if (typeof c === 'string') return c.trim() !== '' && !c.startsWith('[Request interrupted');
  return Array.isArray(c) && c.length > 0 && c.every((b) => b?.type !== 'tool_result');
}

/** What one log holds for this count: the calls up to `until`, the prompts, and when it was last written to. */
function readLog(file, until) {
  const calls = [];
  const prompts = [];
  let last = null;
  const ok = eachLine(file, (line) => {
    // Only the two kinds of entry that matter are parsed.
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) return;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      return; // a line cut while it was being written
    }
    const at = time(r?.timestamp);
    if (at === null || at > until) return;
    if (last === null || at > last) last = at;
    if (isPrompt(r)) prompts.push(at);
    const m = r.message;
    if (r.type !== 'assistant' || !m?.usage || !m.id) return;
    // A message the harness made up itself (an error shown as an answer) called no model.
    if (!m.model || m.model === '<synthetic>') return;
    const u = m.usage;
    calls.push({ id: String(m.id), at, model: String(m.model).slice(0, 80), input: count(u.input_tokens), cacheWrite: count(u.cache_creation_input_tokens), cacheRead: count(u.cache_read_input_tokens), output: count(u.output_tokens) });
  });
  return ok ? { calls, prompts, last } : null;
}

/** Adds the calls at or after `from` to `byId`, one entry per call; true when at least one was in the window. */
function addCalls(byId, calls, from) {
  let any = false;
  for (const c of calls) {
    if (c.at < from) continue;
    any = true;
    // One answer is written as one line per block (text, tool call), each carrying the usage of the whole answer: counted once, with the largest numbers seen.
    const seen = byId.get(c.id);
    if (seen) for (const f of FIELDS) seen[f] = Math.max(seen[f], c[f]);
    else byId.set(c.id, { ...c });
  }
  return any;
}

/** Claude Code: ~/.claude/projects/<project>/<session>.jsonl, its sub-agents in <session>/subagents/. */
export const claudeCode = {
  name: 'Claude Code',
  detect: (env) => SESSION_ID.test(String(env.CLAUDE_CODE_SESSION_ID ?? '')),
  read({ env, home, since, until }) {
    const id = String(env.CLAUDE_CODE_SESSION_ID);
    // A relative CLAUDE_CONFIG_DIR would be read from the audited repository: only an absolute one is followed.
    const config = env.CLAUDE_CONFIG_DIR && isAbsolute(env.CLAUDE_CONFIG_DIR) ? env.CLAUDE_CONFIG_DIR : join(home, '.claude');
    const projects = join(config, 'projects');
    let dirs;
    try {
      dirs = readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      return null;
    }
    // The project folder is named after the session's first working directory: found by the session's file rather than rebuilt.
    const dir = dirs.map((d) => join(projects, d.name)).find((d) => existsSync(join(d, `${id}.jsonl`)));
    if (!dir) return null;
    const main = readLog(join(dir, `${id}.jsonl`), until);
    if (!main) return null;
    // The run starts with the user's message that asked for it: the opening block and the reading of the skill come before the first script.
    const before = main.prompts.filter((p) => p <= since);
    // No such message in this session: the run started in another one (a finish run again the next day), and this session's numbers are not the run's.
    if (!before.length) return null;
    const from = Math.max(...before);
    // An id inherited from another session (an agent started from Claude Code's terminal) names a session that was not at work during this run.
    const busy = (t) => main.calls.some((c) => Math.abs(c.at - t) <= ACTIVE_WITHIN_MS);
    if (!busy(since) || !busy(until)) return null;
    const byId = new Map();
    addCalls(byId, main.calls, from);
    let subAgents = 0;
    const subDir = join(dir, id, 'subagents');
    let subFiles = [];
    try {
      subFiles = readdirSync(subDir).filter((f) => f.endsWith('.jsonl')).slice(0, MAX_SUB_AGENTS);
    } catch {
      /* no sub-agent in this session */
    }
    for (const f of subFiles) {
      const sub = readLog(join(subDir, f), until);
      if (sub && addCalls(byId, sub.calls, from)) subAgents += 1;
    }
    return { calls: [...byId.values()], subAgents, since: new Date(from).toISOString() };
  },
};

/** The harnesses this file can read, in the order they are tried. */
export const READERS = [claudeCode];

/** The calls of a reader, added up: in all and per model, the model used most first. */
export function sumCalls(calls) {
  const zero = () => ({ calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0 });
  const all = zero();
  const per = new Map();
  for (const c of calls) {
    if (!per.has(c.model)) per.set(c.model, { model: c.model, ...zero() });
    for (const t of [all, per.get(c.model)]) {
      t.calls += 1;
      for (const f of FIELDS) t[f] += c[f];
      t.total += c.input + c.cacheWrite + c.cacheRead + c.output;
    }
  }
  return { ...all, models: [...per.values()].sort((a, b) => b.total - a.total) };
}

/**
 * The tokens this run cost, or null when no reader knows the harness or finds
 * its log, or CYBEDEFEND_NO_USAGE is set. `since` is when the run started (its
 * first script), `until` when it is counted (finish). Never throws.
 */
export function runUsage({ since, until = new Date(), env = process.env, home = homedir(), readers = READERS } = {}) {
  try {
    if (['1', 'true', 'yes'].includes(String(env.CYBEDEFEND_NO_USAGE ?? '').toLowerCase())) return null;
    const from = time(since);
    const to = time(until);
    if (from === null || to === null || from > to) return null;
    for (const reader of readers) {
      if (!reader.detect(env)) continue;
      const got = reader.read({ env, home, since: from, until: to });
      if (!got?.calls?.length) continue;
      return { agent: reader.name, since: got.since, until: new Date(to).toISOString(), ...sumCalls(got.calls), subAgents: got.subAgents || 0 };
    }
    return null;
  } catch {
    return null;
  }
}

/** 1234567 as "1.23 M", 45678 as "46 k": the unit is chosen after rounding, so 999,999 is "1.00 M", never "1000 k". */
export function shortCount(n) {
  if (n >= 999_500) {
    const m = n / 1e6;
    return `${m >= 9.995 ? m.toFixed(1) : m.toFixed(2)} M`;
  }
  if (n >= 1000) {
    const k = n / 1e3;
    return `${k >= 9.95 ? k.toFixed(0) : k.toFixed(1)} k`;
  }
  return String(n);
}

/** The run's tokens in one sentence, for the terminal and the audit page. */
export function usageLine(u) {
  if (!u) return '';
  const models = u.models.map((m) => m.model).join(', ');
  return (
    `${shortCount(u.total)} tokens over ${u.calls} model ${u.calls === 1 ? 'call' : 'calls'} (${models}): ${shortCount(u.cacheRead)} read from the prompt cache, ${shortCount(u.cacheWrite)} written to it, ${shortCount(u.input)} of other input, ${shortCount(u.output)} of output` +
    `${u.subAgents ? `, ${u.subAgents} sub-${u.subAgents === 1 ? 'agent' : 'agents'} included` : ''}. Read from the ${u.agent} session log, from the message that started this run up to its verdict.`
  );
}

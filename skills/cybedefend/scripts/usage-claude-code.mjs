// The reader of Claude Code's session log, for usage.mjs:
// ~/.claude/projects/<project>/<session>.jsonl (or under CLAUDE_CONFIG_DIR),
// its sub-agents in <session>/subagents/, one JSON entry a line. The session
// is the one of CLAUDE_CODE_SESSION_ID, which Claude Code gives the commands
// it runs.

import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { count, eachLine, FIELDS, time } from './usage-log.mjs';

/** At most this many sub-agent logs are read. */
const MAX_SUB_AGENTS = 500;
/** The session must have been at work this close to the run's start and to finish: an inherited id of another session is not this run. */
const ACTIVE_WITHIN_MS = 30 * 60 * 1000;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

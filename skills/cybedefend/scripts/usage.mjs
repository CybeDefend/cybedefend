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
// read({ env, home, since, until }) returns the calls or null. Each reader is
// a file of its own (usage-claude-code.mjs), built on usage-log.mjs.
//
// What is counted: every model call of the session (and of its sub-agents)
// from the user's message that started the run (the last one before its first
// script) up to `until` (finish), each call once. Nothing leaves the machine
// and no log is changed. Known limits: the agent's own report after finish is
// not in it; the call a harness makes to compact a conversation is not logged
// as an answer; a session resumed under a new id keeps its earlier sub-agents
// under the old one. CYBEDEFEND_NO_USAGE=1 turns it off.

import { homedir } from 'node:os';
import { claudeCode } from './usage-claude-code.mjs';
import { FIELDS, time } from './usage-log.mjs';

export { claudeCode };

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

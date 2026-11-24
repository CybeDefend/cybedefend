// The live view of /cybedefend: one page in the user's browser that shows the
// run while it happens. The tools start one by one, the AI scanner's count of
// entry points goes up, each proven flaw comes in as a line, and the verdict
// closes it. It works with every coding agent, because it is a page and a
// file: the scripts of the skill write the state of the run in
// .cybedefend/out/watch-state.js, and .cybedefend/out/watch.html reads that
// file again every second.
//
// Nothing here can stop a run: every write is tried once and a failure is
// silent. The page reads only its own state file, shows every value as text
// (never as HTML), and sends nothing anywhere.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME, PALETTE, fonts } from './look.mjs';
import { openCommand } from './os.mjs';

/** The tools of scanners.lock as a person names them: label, what they read, why they stay out of a repository. */
export const TOOLS = {
  opengrep: ['Opengrep', 'code', 'no source file here'],
  'trivy-fs': ['Trivy', 'dependencies', 'no dependency file here'],
  'trivy-config': ['Trivy config', 'infrastructure', 'no configuration here'],
  gitleaks: ['Gitleaks', 'secrets', 'no file here'],
  zizmor: ['zizmor', 'CI/CD', 'no GitHub Actions workflow here'],
  'trivy-image': ['Trivy image', 'containers', 'no image named'],
  bandit: ['Bandit', 'Python code', 'no Python here'],
  gosec: ['gosec', 'Go code', 'no Go module here'],
  brakeman: ['Brakeman', 'Rails code', 'no Rails app here'],
  checkov: ['Checkov', 'infrastructure', 'no infrastructure as code here'],
  poutine: ['poutine', 'CI/CD', 'no CI pipeline here'],
  noir: ['OWASP Noir', 'entry points', 'nothing to map here'],
  govulncheck: ['govulncheck', 'Go call graph', 'no Go module here'],
};

export const STEPS = ['Scanners', 'AI scanner', 'Triage', 'Dashboard', 'Report'];

export const toolLabel = (name) => TOOLS[name]?.[0] ?? name;
export const toolArea = (name, type) => TOOLS[name]?.[1] ?? ({ sast: 'code', sca: 'dependencies', iac: 'infrastructure', secret: 'secrets', cicd: 'CI/CD', container: 'containers', context: 'context' }[type] ?? type ?? '');

/** Why a tool did not run, in a few words, from the manifest's or the plan's reason. */
export function whyNot(name, detail = '') {
  const d = String(detail);
  if (/nothing it reads/.test(d) || d === '') return TOOLS[name]?.[2] ?? 'nothing it reads here';
  if (/not installed/.test(d)) return 'not installed, and Docker cannot run it';
  // Any other reason, whole when it is short, cut at a word when it is not.
  const text = d.replace(/\s+/g, ' ').trim();
  return text.length <= 90 ? text : `${text.slice(0, text.lastIndexOf(' ', 90))} …`;
}

const stateFile = (out) => join(out, 'watch-state.js');
export const pageFile = (out) => join(out, 'watch.html');

export function readWatch(out) {
  try {
    const text = readFileSync(stateFile(out), 'utf8');
    return JSON.parse(text.slice(text.indexOf('(') + 1, text.lastIndexOf(')')));
  } catch {
    return null;
  }
}

// Every state of the run, in order, with its time: what the replay plays again.
const historyFile = (out) => join(out, 'watch-history.jsonl');
/** The page of the replay, and its state: next to the run's own, which a replay never touches. */
export const replayFile = (out) => join(out, 'watch-replay.html');
const replayStateFile = (out) => join(out, 'watch-replay-state.js');

function writeTo(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  // Written whole, then moved: the page never reads half a file.
  writeFileSync(tmp, `window.__cybedefend(${JSON.stringify(state)});\n`);
  renameSync(tmp, file);
}

function write(out, state) {
  mkdirSync(out, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeTo(stateFile(out), state);
  try {
    // Kept for the replay; a run that goes on for hours stops adding to it.
    const file = historyFile(out);
    if (!existsSync(file) || statSync(file).size < 60_000_000) appendFileSync(file, `${JSON.stringify({ t: Date.now(), s: state })}\n`);
  } catch {
    /* the history is a comfort, never a reason to stop */
  }
}

// The last run that reached its verdict, kept outside the results folder: a new run, or a folder emptied before one, does not take it away.
const keptFile = (out) => join(dirname(out), 'replay', 'last-run.jsonl');

/** The states of the last run, oldest first; none when the run was made before they were kept. */
export function readHistory(out, file = historyFile(out)) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((f) => f && Number.isFinite(f.t) && f.s);
  } catch {
    return [];
  }
}

/** Keeps the run for a later replay once it has its verdict. Never throws. */
export function keepReplay(out) {
  try {
    if (!readHistory(out).some((f) => f.s.endedAt)) return false;
    mkdirSync(dirname(keptFile(out)), { recursive: true });
    copyFileSync(historyFile(out), keptFile(out));
    return true;
  } catch {
    return false;
  }
}

/**
 * What a replay plays: this run when it reached its verdict; otherwise the
 * last run that did, when one was kept; otherwise what there is of this one.
 * `which` says it: 'this', 'kept' or 'unfinished'.
 */
export function replaySource(out) {
  const current = readHistory(out);
  if (current.some((f) => f.s.endedAt)) return { frames: current, which: 'this' };
  const kept = readHistory(out, keptFile(out));
  if (kept.length) return { frames: kept, which: 'kept' };
  return { frames: current, which: 'unfinished' };
}

/**
 * When each state of the last run is shown again, in milliseconds from the
 * start of the replay. As it happened by default; `speed` plays it faster,
 * `maxGap` (seconds) cuts every wait to that length, and what came after the
 * verdict (a live step made later) follows three seconds apart at most.
 */
export function replayTimeline(frames, { speed = 1, maxGap = null } = {}) {
  const rate = Number(speed) > 0 ? Number(speed) : 1;
  const cap = Number(maxGap) > 0 ? Number(maxGap) * 1000 : Infinity;
  const at = [0];
  for (let i = 1; i < frames.length; i += 1) {
    let gap = Math.max(0, frames[i].t - frames[i - 1].t);
    if (frames[i - 1].s.endedAt) gap = Math.min(gap, 3000);
    at.push(at[i - 1] + Math.min(gap, cap) / rate);
  }
  return at;
}

/**
 * Plays the last run again on a page of its own, state by state. The clock
 * of the page starts at zero: the times of the run are moved to now. Returns
 * the number of states played, 0 when there is no history. `sleep` and `now`
 * are given by the tests.
 */
export async function replayWatch({ out, speed = 1, maxGap = null, delay = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), onReady = () => {} } = {}) {
  const { frames } = replaySource(out);
  if (!frames.length) return 0;
  const at = replayTimeline(frames, { speed, maxGap });
  mkdirSync(out, { recursive: true });
  writeFileSync(replayFile(out), pageHtml().split('watch-state.js').join('watch-replay-state.js'));
  const begin = now() + Math.max(0, Number(delay) || 0) * 1000;
  const ended = frames.findIndex((f) => f.s.endedAt);
  // Once the verdict is there the page says how long the run took, not how long this replay lasted.
  const took = (s) => (s.endedAt ? Math.max(0, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000)) : null);
  const shown = (i) => ({ ...frames[i].s, startedAt: new Date(begin).toISOString(), endedAt: frames[i].s.endedAt ? new Date(begin + at[ended]).toISOString() : null, replay: true, ...(Number.isFinite(took(frames[i].s)) ? { took: took(frames[i].s) } : {}) });
  // One replay at a time on that page: asked again while one plays, the new one takes over and the old one stops writing.
  const lock = join(out, 'watch-replay.lock');
  const token = `${process.pid}.${begin}.${Math.random()}`;
  writeFileSync(lock, token);
  const mine = () => {
    try {
      return readFileSync(lock, 'utf8') === token;
    } catch {
      return false;
    }
  };
  writeTo(replayStateFile(out), shown(0));
  onReady(replayFile(out));
  for (let i = 0; i < frames.length; i += 1) {
    const wait = begin + at[i] - now();
    if (wait > 0) await sleep(wait);
    if (!mine()) return i;
    writeTo(replayStateFile(out), shown(i));
  }
  return frames.length;
}

/** A new run: a fresh state, and the page next to it. */
export function startWatch({ out, repo, branch, now = new Date() }) {
  try {
    const state = {
      v: 1,
      repo: String(repo ?? ''),
      branch: String(branch ?? ''),
      startedAt: now.toISOString(),
      endedAt: null,
      steps: STEPS.map((title, i) => ({ title, state: i === 0 ? 'run' : 'todo', note: '' })),
      setup: 'run',
      tools: [],
      scan: { files: null, seconds: null },
      audit: { of: null, reviewed: 0, flaws: 0, leads: 0 },
      triage: null,
      feed: [],
      verdict: null,
      links: { dashboard: null, report: null },
    };
    // A new run: its history starts here.
    mkdirSync(out, { recursive: true });
    writeFileSync(historyFile(out), '');
    write(out, state);
    writeFileSync(pageFile(out), pageHtml());
    return state;
  } catch {
    return null;
  }
}

/** Changes the state of the run in place. Never throws; without a run to show, it does nothing. */
export function updateWatch(out, change) {
  try {
    const state = readWatch(out);
    if (!state) return null;
    change(state);
    write(out, state);
    return state;
  } catch {
    return null;
  }
}

/** One tool's line of the page: created when it is first named. */
export function setTool(state, name, patch) {
  if (name === 'trivy-fs-sbom') return; // the SBOM is Trivy's second pass, not a tool of its own
  let tool = state.tools.find((t) => t.name === name);
  if (!tool) {
    tool = { name, label: toolLabel(name), area: toolArea(name, patch.type), state: 'wait', results: null, seconds: null, note: '' };
    state.tools.push(tool);
  }
  const { type, ...rest } = patch;
  Object.assign(tool, rest);
}

export function setStep(state, n, patch) {
  const step = state.steps[n - 1];
  if (step) Object.assign(step, patch);
}

/** A line of the feed as a sentence: one line, 240 characters at most, a capital first. A path or a name of the code keeps its case. */
const sentence = (text) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
  return /^[a-z][a-z']*(?=[\s,:.!?]|$)/.test(s) ? s[0].toUpperCase() + s.slice(1) : s;
};

/**
 * A line of the feed. The same words for the same place are one line: said twice, shown once.
 * Two flaws on one line of code, each in its own words, are two lines. Returns true when added.
 */
export function addFeed(state, item) {
  const text = sentence(item.text);
  if (!text) return false;
  const kind = item.kind ?? 'note';
  const where = String(item.where ?? '').slice(0, 120);
  if (state.feed.some((f) => f.kind === kind && f.text === text && (f.where ?? '') === where)) return false;
  state.seq = Number(state.seq ?? 0) + 1;
  state.feed.push({ id: state.seq, at: new Date().toISOString(), kind, text, where, severity: item.severity ?? '' });
  if (state.feed.length > 60) state.feed.splice(0, state.feed.length - 60);
  return true;
}

/**
 * The findings of the audit as its file has them: one line of the feed for each, no more and no
 * fewer. A line the review already said for that place keeps its words and its time (the agent
 * said it the moment the proof failed); what the review said and the file does not hold goes.
 */
export function setFindings(state, list) {
  const said = state.feed.filter((f) => f.kind === 'flaw' || f.kind === 'lead');
  const now = new Date().toISOString();
  const fresh = list.map((item) => {
    const where = String(item.where ?? '').slice(0, 120);
    const i = said.findIndex((f) => f.kind === item.kind && (f.where ?? '') === where);
    const before = i >= 0 ? said.splice(i, 1)[0] : null;
    const text = sentence(item.text);
    // `file`: the audit file holds it. `said`: the review gave it its own words.
    if (before && (!text || text === before.text)) return { ...before, file: true, said: true };
    state.seq = Number(state.seq ?? 0) + 1;
    // The title the file gives a finding is the one the dashboard and the report show: it takes the place of the words
    // the review said when the proof failed, at the same time in the list. A new id: the page shows the new line.
    if (before) return { ...before, id: state.seq, text, file: true, said: true };
    return { id: state.seq, at: now, kind: item.kind, text, where, severity: item.severity ?? '', file: true };
  }).filter((f) => f.text);
  const others = state.feed.filter((f) => f.kind !== 'flaw' && f.kind !== 'lead');
  state.feed = [...others, ...fresh].map((f, i) => [f, i]).sort((x, y) => String(x[0].at).localeCompare(String(y[0].at)) || x[1] - y[1]).map((x) => x[0]);
  return fresh.length;
}

/**
 * A flaw or a lead the review says (progress --flaw, --lead). Returns true when it is one more
 * finding. When the audit file already holds a finding for that place that the review has not
 * worded yet, these are its words for the screen and the count stays as the file has it.
 */
export function sayFinding(state, item) {
  const text = sentence(item.text);
  const where = String(item.where ?? '').slice(0, 120);
  if (!text) return false;
  const held = where ? state.feed.find((f) => f.kind === item.kind && (f.where ?? '') === where && f.file && !f.said) : null;
  if (!held) return addFeed(state, item);
  // A new id: the page takes the old line away and shows this one.
  state.seq = Number(state.seq ?? 0) + 1;
  Object.assign(held, { id: state.seq, text, said: true });
  return false;
}

/** The AI scanner's line for the terminal, the same shape in every run and with every agent. */
export function counterLine(audit = {}) {
  const reviewed = Number(audit.reviewed ?? 0);
  const of = Number(audit.of ?? 0);
  const flaws = Number(audit.flaws ?? 0);
  const leads = Number(audit.leads ?? 0);
  const found = `${flaws} flaw${flaws === 1 ? '' : 's'} proven${leads ? `, ${leads} lead${leads === 1 ? '' : 's'}` : ''}`;
  if (!of) return `AI scanner  ${reviewed} entry point${reviewed === 1 ? '' : 's'} reviewed, ${found}`;
  const filled = Math.max(0, Math.min(20, Math.round((reviewed / of) * 20)));
  return `AI scanner  ${'█'.repeat(filled)}${'░'.repeat(20 - filled)}  ${reviewed}/${of} entry points, ${found}`;
}

/** Opens the page without taking the keyboard away from the terminal (macOS: open -g). */
export function openWatch(out, { file = pageFile(out), front = false } = {}) {
  if (!existsSync(file)) return false;
  // In the background during a run (the terminal keeps the keyboard); in front when the user asked for the page itself.
  const [cmd, args] = openCommand(file, { background: !front });
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const assetDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const asset = (name) => {
  try {
    return readFileSync(join(assetDir, name), 'utf8').replace(/<\?xml[^>]*\?>\s*/, '');
  } catch {
    return '';
  }
};

// The logo of each tool, from assets/tools (where each comes from: SOURCES.md there). A tool without one shows its name alone.
const LOGOS = {
  opengrep: 'opengrep.svg',
  'trivy-fs': 'trivy.svg',
  'trivy-config': 'trivy.svg',
  'trivy-image': 'trivy.svg',
  gitleaks: 'gitleaks.svg',
  zizmor: 'zizmor.svg',
  bandit: 'bandit.png',
  gosec: 'gosec.png',
  brakeman: 'brakeman.png',
  checkov: 'checkov.png',
  noir: 'noir.png',
  govulncheck: 'go.svg',
};

/** The logos as data the page carries with it: the page stays one file that calls nothing. */
export function toolLogos() {
  const seen = {};
  const out = {};
  for (const [tool, file] of Object.entries(LOGOS)) {
    try {
      seen[file] ??= `data:${file.endsWith('.svg') ? 'image/svg+xml' : 'image/png'};base64,${readFileSync(join(assetDir, 'tools', file)).toString('base64')}`;
      out[tool] = seen[file];
    } catch {
      /* a logo that is missing leaves the name alone */
    }
  }
  return out;
}

// The live page adds to the report's frame only what moves while a run goes on. Everything flows down the page:
// no block takes the height of the window and nothing is laid over the rest, so a long reason, a thirteenth tool
// or a twentieth finding makes the page longer and never piles up.
//
// What moves, and why: the timer counts; the eye of the logo beats while the run goes on; the step that runs fills,
// with a light along it (its fill is measured where the run gives a count, and travels where it gives none); a tool
// that runs glows and is swept by a light; a counter that changes swells for a moment; a line of the feed slides in,
// and a proven flaw lights up as it lands; the question the method asks is typed again every three seconds. A person
// who asked their system for less motion gets none of it.
const STYLE = `
${PALETTE}
${FRAME}
.timer{text-align:right}
.timer .w{display:block;font:400 11.5px/1 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--faint)}
.timer .w::before{content:"";display:inline-block;width:7px;height:7px;margin-right:9px;border-radius:50%;background:var(--mint);vertical-align:1px}
.clock{display:block;margin-top:9px;font:400 clamp(58px,4.3vw,84px)/1 'JetBrains Mono',monospace;letter-spacing:-.05em;font-variant-numeric:tabular-nums;color:var(--ink);text-shadow:0 0 34px rgba(143,115,255,.55)}
.running .timer .w::before{background:var(--violet);animation:beat 1.2s ease-in-out infinite}
.running .clock{animation:tick 1s steps(1) infinite}
.ended .clock{text-shadow:0 0 34px rgba(47,227,183,.35)}
.replay .timer .w{color:var(--lav)}
.logo svg{height:64px}
.running .logo svg g:first-of-type path:nth-of-type(3){transform-box:fill-box;transform-origin:center;animation:eye 1.8s ease-in-out infinite}
.running .logo svg{filter:drop-shadow(0 0 14px rgba(47,227,183,.28))}
header.hd .in{min-height:108px}
.where{font:400 13px/1.5 'JetBrains Mono',monospace;color:var(--faint);margin-bottom:18px;overflow-wrap:anywhere}
.where b{color:var(--lav);font-weight:400}
/* The sentence that says where the run is: smaller than a verdict, which takes the size of the report's. */
.hero{padding-top:clamp(26px,3.2vw,48px)}
h1{font-size:clamp(32px,4.1vw,62px);min-height:2em}
h1.ok,h1.no{font-size:clamp(38px,5.4vw,88px)}
h1.ok,h1.no{min-height:0}
h1 .nb{display:inline-block;max-width:100%;overflow-wrap:anywhere}
.lead{min-height:2.9em}
.lead .askq{display:inline-block;color:var(--ink);font-weight:500;animation:ask .55s cubic-bezier(.2,.7,.2,1) both}
.lead .askq::after{content:"";display:inline-block;width:.5em;height:1.05em;margin-left:7px;vertical-align:-.17em;background:var(--mint);animation:blink 1s steps(1) infinite}
.lead a{display:inline-block;margin:18px 12px 0 0;padding:11px 20px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--ink);font-size:15.5px;font-weight:600;text-decoration:none;transition:border-color .2s,background .2s}
.lead a:hover{border-color:var(--lav)}
.lead a:first-of-type{background:var(--violet);border-color:var(--violet);color:var(--bg)}
/* The steps are one bar in four parts. Each is as wide as its words and its share of what is left: the four numbers
   further down are not theirs, and no number sits under a step. */
.rail{list-style:none;display:flex;gap:10px;margin-top:34px}
.rail li{flex:1 1 auto;min-width:0;position:relative;display:grid;grid-template-columns:auto auto minmax(0,1fr);column-gap:10px;align-items:baseline;padding-top:18px;color:var(--faint);font-size:15px;font-weight:500;transition:color .3s}
.rail .n{font:400 12.5px 'JetBrains Mono',monospace}
.rail .p{font:400 12.5px 'JetBrains Mono',monospace;color:var(--lav);font-variant-numeric:tabular-nums}
.rail .trk{position:absolute;left:0;right:0;top:0;height:6px;border-radius:3px;background:var(--line);overflow:hidden}
.rail .trk b{position:relative;display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,var(--violet),var(--lav));overflow:hidden;transition:width .7s cubic-bezier(.2,.7,.2,1)}
.rail li.run{color:var(--ink)}
.rail li.run .n{color:var(--lav)}
.rail li.run .trk{box-shadow:0 0 22px rgba(143,115,255,.5);animation:glow 1.6s ease-in-out infinite}
.rail li.run .trk::after,.rail li.run .trk b::after{content:"";position:absolute;top:0;bottom:0;left:-90px;width:90px;background:linear-gradient(90deg,transparent,rgba(189,174,255,.4),transparent);animation:pass 1.5s linear infinite}
.rail li.run .trk b::after{background:linear-gradient(90deg,transparent,rgba(255,255,255,.95),transparent);animation-duration:1.1s}
.rail li.ind .trk b{width:34%;animation:travel 1.4s cubic-bezier(.45,0,.55,1) infinite}
.rail li.ind .trk::after{display:none}
.rail li.done{color:var(--body)}
.rail li.done .n{color:var(--mint)}
.rail li.done .trk b{background:var(--mint)}
.rail li.done .p::after{content:"\\2713";color:var(--mint)}
section{margin-top:52px}
section.none{display:none}
.body:not(.review) #sec-ai{display:none}
h2{font:800 25px/1.15 'Rubik',sans-serif;letter-spacing:-.03em}
h2+p{font-size:15.5px;color:var(--body);margin-top:6px;min-height:1.5em}
.cols{margin-top:20px}
.cols .big{font-size:clamp(42px,3.7vw,64px)}
.big span,.big{transform-origin:left center}
.big span{display:inline-block}
.big small{font:600 .38em 'Rubik',sans-serif;color:var(--faint);letter-spacing:-.02em}
.bump{animation:bump .7s cubic-bezier(.2,.7,.2,1)}
.bar{height:4px;margin-top:16px;background:var(--line);border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;width:0;border-radius:2px;background:linear-gradient(90deg,var(--violet),var(--lav));transition:width .8s cubic-bezier(.2,.7,.2,1)}
.bar.ind i{width:34%;animation:travel 1.4s cubic-bezier(.45,0,.55,1) infinite}
.feed{list-style:none;margin-top:14px;border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
.feed li{position:relative;display:grid;grid-template-columns:96px minmax(0,1fr);column-gap:16px;padding:14px 20px;border-top:1px solid var(--line);animation:in .4s cubic-bezier(.2,.7,.2,1) both}
.feed li:first-child{border-top:0}
.feed .k{font:400 11.5px/2.1 'JetBrains Mono',monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--violet)}
.feed li.k-flaw .k{color:var(--red)} .feed li.k-lead .k{color:var(--body)} .feed li.k-live .k{color:var(--mint)}
.feed li.k-flaw{animation:in .4s cubic-bezier(.2,.7,.2,1) both,land 1.8s ease-out both}
.feed li.k-flaw::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--red)}
.feed li.k-live::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--mint)}
.feed .t{font-size:16.5px;line-height:1.4;color:var(--ink);overflow-wrap:anywhere}
.feed .w{grid-column:2;font:400 12.5px/1.5 'JetBrains Mono',monospace;color:var(--faint);overflow-wrap:anywhere;margin-top:3px}
.feed li.none{display:block;color:var(--faint);font-size:15px}
.running .feed li.none{background:linear-gradient(90deg,transparent,rgba(143,115,255,.14),transparent) 0 0/40% 100% no-repeat;animation:sweep 2.2s linear infinite}
.tools{list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:10px;margin-top:16px}
/* A line of a tool: its mark, its name and what it reads, and what it gave. When the three do not fit on one line, what it gave goes under, whole. */
.tool{position:relative;overflow:hidden;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;padding:13px 16px;min-width:0;border:1px solid var(--line);border-radius:14px;background:var(--panel);animation:in .4s cubic-bezier(.2,.7,.2,1) both;transition:border-color .4s,box-shadow .4s}
.tool .lg{flex:none;width:38px;height:38px;border-radius:10px;background:var(--raise);border:1px solid var(--line);color:var(--ink);display:flex;align-items:center;justify-content:center;font:600 15px 'Rubik',sans-serif;transition:opacity .4s}
.tool .lg img{max-width:22px;max-height:22px;width:auto;height:auto;display:block}
.tool .who{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;display:flex;flex-direction:column;transition:opacity .4s}
.tool .name{font-weight:600;font-size:16px;line-height:1.3}
.tool .area{color:var(--faint);font-size:13.5px;line-height:1.4}
.tool .res{flex:none;max-width:100%;margin-left:auto;font-size:14px;color:var(--body);text-align:right;font-variant-numeric:tabular-nums}
.tool .res b{color:var(--ink);font-weight:600}
.tool .sec{font:400 12.5px 'JetBrains Mono',monospace;color:var(--faint);margin-left:12px}
.tool.ready .lg,.tool.ready .who{opacity:.72}
.tool.ready .res{width:46px;height:6px;border-radius:3px;background:linear-gradient(90deg,var(--line),var(--faint),var(--line)) 0 0/200% 100%;animation:shim 1.1s linear infinite}
.tool.wait .lg,.tool.wait .who{opacity:.6} .tool.wait .res{color:var(--faint)}
.tool.wait .res::before{content:"";display:inline-block;width:6px;height:6px;margin-right:8px;border-radius:50%;background:var(--faint);vertical-align:1px;animation:beat 1.8s ease-in-out infinite}
.tool.run{border-color:rgba(143,115,255,.6);box-shadow:0 0 0 1px rgba(143,115,255,.18),0 14px 44px -20px rgba(143,115,255,.75)}
.tool.run::after{content:"";position:absolute;top:0;bottom:0;left:-45%;width:45%;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(189,174,255,.16),transparent);animation:pass 1.6s linear infinite}
.tool.run .lg{border-color:rgba(143,115,255,.6);animation:glow 1.6s ease-in-out infinite}
.tool.run .res{color:var(--lav);font-weight:500}
.tool.run .res::before{content:"";display:inline-block;width:11px;height:11px;margin-right:8px;vertical-align:-1px;border:2px solid rgba(143,115,255,.3);border-top-color:var(--lav);border-radius:50%;animation:spin .7s linear infinite}
.tool.done .res::after{content:"";display:inline-block;width:7px;height:7px;margin-left:12px;border-radius:50%;background:var(--mint);box-shadow:0 0 10px rgba(47,227,183,.7)}
.tool.fail .lg{opacity:.55}
.notes{list-style:none;margin-top:8px;max-width:900px}
.notes li{font-size:14.5px;line-height:1.5;color:var(--body);padding:9px 0 0 22px;position:relative;overflow-wrap:anywhere}
.notes li::before{content:"";position:absolute;left:0;top:19px;width:9px;height:2px;background:var(--violet)}
.notes b{color:var(--ink);font-weight:600}
.more{font-size:14px;line-height:1.5;color:var(--faint);margin-top:14px;max-width:900px}
.more:empty{display:none}
footer.ft{margin-top:64px}
@keyframes pass{from{left:-45%}to{left:100%}}
@keyframes travel{from{transform:translateX(-110%)}to{transform:translateX(300%)}}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes ask{from{opacity:0;transform:translateY(.5em);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes blink{50%{opacity:0}}
@keyframes beat{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}
@keyframes eye{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.72)}}
@keyframes glow{0%,100%{box-shadow:0 0 0 rgba(143,115,255,0)}50%{box-shadow:0 0 22px rgba(143,115,255,.6)}}
@keyframes tick{0%{text-shadow:0 0 44px rgba(143,115,255,.9)}50%{text-shadow:0 0 30px rgba(143,115,255,.45)}}
@keyframes bump{0%{transform:scale(1)}35%{transform:scale(1.14);filter:brightness(1.35)}100%{transform:scale(1)}}
@keyframes land{from{background:rgba(255,93,124,.2)}to{background:transparent}}
@keyframes sweep{from{background-position:-67% 0}to{background-position:167% 0}}
@keyframes shim{from{background-position:200% 0}to{background-position:0 0}}
/* A wide screen, once the scanners are done: what the AI scanner finds on the left, the scanners in a column on the right. */
@media screen and (min-width:1180px){.body.review{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,27%);column-gap:clamp(32px,3.4vw,56px);align-items:start}.body.review .tools{grid-template-columns:minmax(0,1fr)}}
/* Half a laptop screen (a terminal on the left, this page on the right), then a phone: the same page, one column. */
@media screen and (max-width:760px){.clock{font-size:46px}header.hd .in{min-height:88px}.logo svg{height:40px}.timer .w{font-size:10.5px}.where{margin-bottom:14px}.rail{gap:6px;margin-top:28px}.rail li{grid-template-columns:auto minmax(0,1fr);font-size:13px;padding-top:14px}.rail .n,.rail .p{font-size:11.5px}.rail .s{grid-column:1/-1;grid-row:2}section{margin-top:38px}.cols{grid-template-columns:1fr 1fr;gap:10px}.cols>*{padding:16px 16px 18px}.cols .big{font-size:46px}.cap{font-size:14px}.feed li{grid-template-columns:minmax(0,1fr);row-gap:0;padding:12px 16px}.feed .w{grid-column:1}.tools{grid-template-columns:minmax(0,1fr)}footer.ft{margin-top:48px;flex-direction:column;gap:4px}}
@media screen and (max-width:440px){.clock{font-size:40px}.logo svg{height:36px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none !important;transition:none !important}}
`;

// What the page shows as steps: the triage runs in the background while the AI scanner reviews, so the two are one step here.
const RAIL = ['Scanners', 'AI scanner and triage', 'Dashboard', 'Report'];

// The page's own script. Every value of the state goes in as text.
const SCRIPT = `
(function(){
  var S=null,run=null,nums={},have={},queue=[],busy=false,first=true,subKey=null,tick=0;
  var ASKS=['Who may call this, and is that checked on the server?','Is each object loaded by an id checked against the caller?','Is every query on shared data filtered by the tenant of the caller?','Can the caller set a field only the server should set?','Can a step of a flow be skipped, replayed or run out of order?','Can an amount go below zero, or the same request count twice?','Does a session or a token end when it should?','Does the answer hold more than the caller may see?','Does a check that exists in name check anything?','Then, for each lead: a test that fails today is its proof.'];
  function setSub(key,build){if(key===subKey)return;subKey=key;var sub=$('sub');sub.textContent='';build(sub)}
  var $=function(id){return document.getElementById(id)};
  var el=function(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
  window.__cybedefend=function(s){S=s;try{render()}catch(e){}};
  function poll(){var s=document.createElement('script');s.src='watch-state.js?'+Date.now();s.onload=s.onerror=function(){s.remove()};document.head.appendChild(s)}
  function clock(){if(!S)return;var a=Date.parse(S.startedAt),b=S.endedAt?Date.parse(S.endedAt):Date.now();var t=Math.max(0,Math.round((b-a)/1000));var ran=S.replay&&S.endedAt&&typeof S.took==='number';if(ran)t=S.took;$('clock').textContent=String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');$('clockw').textContent=S.replay?(ran?'Replay. The run took ':S.endedAt?'Replay, done in ':'Replay, running for '):(S.endedAt?'Done in ':'Running for ')}
  // A counter that changes counts up to its new value, and swells for a moment so the eye catches it.
  function bump(e){var c=String(e.className||'').replace(/\s*bump/g,'');e.className=c+' bump';setTimeout(function(){e.className=c},700)}
  function count(id,to){to=Number(to)||0;var from=nums[id]||0;if(from===to){$(id).textContent=to;return}nums[id]=to;bump($(id));var t0=performance.now();(function step(now){var p=Math.min(1,(now-t0)/600);$(id).textContent=Math.round(from+(to-from)*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step)})(t0)}
  function plural(n,one,many){return n+' '+(n===1?one:many)}
  function safeLink(href){return typeof href==='string'&&/^(http:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?\\/|file:\\/\\/)/.test(href)?href:null}
  // The title: the name of the repository stays in one piece, with what follows it, so a name with a hyphen is never cut in two.
  function title(h,before,name,after){h.textContent=before;if(name)h.appendChild(el('span','nb',name+after));else h.appendChild(document.createTextNode(after))}
  // A list of the page rebuilt only when what it says changes.
  function list(id,items,build){var box=$(id),k=JSON.stringify(items);if(box.getAttribute('data-k')===k)return;box.setAttribute('data-k',k);box.textContent='';items.forEach(function(it){box.appendChild(build(it))})}
  function render(){
    if(run!==S.startedAt){run=S.startedAt;nums={};have={};queue=[];first=true;subKey=null;$('feed').textContent='';$('tools').textContent=''}
    $('repo').textContent=S.repo||'';$('branch').textContent=S.branch?', branch '+S.branch:'';
    // A replay says it is one, at the top and at the bottom of the page.
    $('foot').textContent=S.replay?'/cybedefend, a replay of the last run. Nothing runs again: this page shows the run as it was.':'/cybedefend, live. This page reads the run on this machine and sends nothing.';
    clock();
    // What moves on the page moves while the run goes on, and rests once it has its verdict.
    $('app').className=(S.endedAt?'ended':'running')+(S.replay?' replay':'');
    var cur=0;S.steps.forEach(function(st,i){if(st.state==='run'&&!cur)cur=i+1});
    // Before the plan says which tools this repository calls for, the page shows the ones the skill carries, getting ready.
    var pre=!S.tools.length&&S.setup==='run'&&!S.endedAt;
    var tools=pre?CATALOG.map(function(c){return{name:c[0],label:c[1],area:c[2],state:'ready'}}):S.tools;
    // The triage runs while the AI scanner reviews: the page shows the two as one step.
    var a2=S.steps[1].state,a3=S.steps[2].state,both=a2===a3?a2:(a2==='todo'&&a3==='todo')?'todo':'run';
    // How far each step is, where the run gives a count: the tools that ended out of the tools of this repository, the entry
    // points reviewed out of the map's total. A step that runs without a count moves all the same, with no number.
    var called=0,ended=0;S.tools.forEach(function(t){if(t.state!=='skip'){called++;if(t.state==='done'||t.state==='fail')ended++}});
    var au=S.audit||{},far=[called?[ended,called]:null,au.of?[Math.min(Number(au.reviewed)||0,au.of),au.of]:null,null,null];
    [S.steps[0].state,both,S.steps[3].state,S.steps[4].state].forEach(function(st,i){
      var m=far[i],open=st==='run'&&!m;
      $('step'+(i+1)).className=st+(open?' ind':'');
      $('step'+(i+1)+'f').style.width=st==='done'?'100%':open?'':st==='run'?Math.round(100*m[0]/m[1])+'%':'0%';
      $('step'+(i+1)+'p').textContent=st==='run'&&m?m[0]+'/'+m[1]:'';
    });
    // While the scanners run, they are the page. Once they are done, what the AI scanner finds comes above them.
    $('body').className='body'+(S.steps[0].state==='done'?' review':'');
    var h=$('h1');h.className='';$('page').className='page';
    if(S.live&&S.live.state==='run'){
      title(h,'The proven flaws are replayed on the running application.','','');
      var seen=S.feed.filter(function(f){return f.kind==='live'}).length;
      setSub('live|'+seen,function(sub){sub.textContent='Started on this machine by this step, with throwaway data. '+plural(seen,'replay','replays')+' so far.'});
    }else if(S.verdict&&!queue.length&&!busy){
      h.className=S.verdict.ship?'ok':'no';$('page').className='page '+h.className;
      title(h,'',S.repo||'This branch',S.verdict.ship?' can ship.':' is not ready to ship.');
      // The sentence the report opens on, with the same numbers: what blocks in the code, and the advisories on the packages. They add up to the count.
      var V=S.verdict,has=function(x){return x!==undefined&&x!==null};
      var line=V.ship?(V.toFix?'It can ship, with '+plural(V.toFix,'thing','things')+' to fix.':"Nothing to fix before this branch ships."):plural(V.blocking,'finding blocks','findings block')+' the deploy'+(has(V.advisories)?': '+(has(V.findings)?V.findings:(V.flaws||0))+' in the code and its configuration, '+plural(V.advisories,'advisory','advisories')+' on '+plural(V.packages||0,'package','packages')+' to upgrade.':'.');
      var d=safeLink(S.links&&S.links.dashboard),r=safeLink(S.links&&S.links.report);
      setSub('verdict|'+line+'|'+d+'|'+r,function(sub){
        sub.appendChild(el('span','',line+' '));
        if(d||r)sub.appendChild(el('br'));
        if(d){var a=el('a','','Open the dashboard');a.setAttribute('href',d);sub.appendChild(a)}
        if(r){var b=el('a','','Open the audit page');b.setAttribute('href',r);sub.appendChild(b)}
      });
    }else{
      var titles={0:'Getting ready.',1:'Setting up the dashboard on this machine.',2:'The AI scanner is reviewing every entry point.',3:'Every scanner finding is judged against this code.',4:"The team's policies are giving the verdict.",5:'Writing the report.'};
      if(!S.verdict&&cur===1&&S.setup!=='run')title(h,'The scanners are reading ',S.repo||'the repository','.');
      // Between two steps nothing is marked as running: the page says what is done and what comes next.
      else if(!S.verdict&&!cur&&S.steps[1].state==='done')title(h,'The review is done. The verdict comes next.','','');
      else if(!S.verdict&&!cur&&S.steps[0].state==='done')title(h,'The scanners are done. The AI scanner comes next.','','');
      else title(h,S.verdict?titles[4]:(titles[cur]||titles[0]),'','');
      var notes=S.steps.filter(function(st){return st.state==='run'&&st.note}).map(function(st){return st.note});
      // While the review runs, the page says what the method asks of each entry point: the method, never a count it does not have.
      if(notes.length)setSub('notes|'+notes.join(' '),function(sub){sub.textContent=notes.join(' ')});
      else if(cur===2&&!S.verdict){var q=ASKS[tick%ASKS.length];setSub('ask|'+q,function(sub){sub.appendChild(el('span','','It asks of every entry point: '));sub.appendChild(el('span','askq',q))})}
      else if(cur===1&&S.setup!=='run'&&S.tools.length)setSub('scan',function(sub){sub.textContent='Open source scanners. The stack of the repository decides which ones run.'});
      else if(pre)setSub('setup',function(sub){sub.textContent='The scanners start as soon as it answers.'});
      else setSub('none',function(){});
    }
    // One row per tool this repository calls for. A tool it has nothing for is named once, under the list; a tool that did
    // not finish keeps its row, and its reason is written whole under the list: what happened, and what it changes for this run.
    var ran=0,planned=0,stopped=[],unneeded=[],unable=[],named={};
    tools.forEach(function(t,at){
      var id='tool-'+t.name.replace(/[^a-z0-9-]/gi,''),row=$(id);named[id]=1;
      if(t.state==='skip'){
        if(row)row.remove();
        var why=t.note||'nothing it reads here';
        (/not installed|cannot|could not/.test(why)?unable:unneeded).push(t.label+' ('+why+')');
        return;
      }
      if(t.state!=='ready')planned++;
      if(!row){
        // Every line known at that moment shows at once: a wave of forty milliseconds from one to the next, no more.
        row=el('li','tool');row.id=id;row.style.animationDelay=(at*40)+'ms';
        var lg=el('span','lg'),src=LOGOS[t.name],letter=String(t.label||t.name).charAt(0).toUpperCase();
        // The mark of the tool on a dark tile; a tool without one, or with a mark too wide for a tile, shows its first letter.
        if(src){var im=el('img');im.setAttribute('alt','');im.onload=function(){if(this.naturalWidth>2.4*this.naturalHeight)this.parentNode.textContent=letter};im.setAttribute('src',src);lg.appendChild(im)}else lg.textContent=letter;
        var who=el('span','who');who.appendChild(el('span','name'));who.appendChild(el('span','area'));
        row.appendChild(lg);row.appendChild(who);row.appendChild(el('span','res'));$('tools').appendChild(row);
      }
      if(t.state==='done')ran++;
      if(t.state==='fail')stopped.push([t.label,String(t.note||'').replace(/^did not finish[:.]?\\s*/i,'')]);
      var key=[t.state,t.label,t.area,t.results,t.seconds,t.unit].join('|');
      if(row.getAttribute('data-k')===key)return;
      row.setAttribute('data-k',key);
      row.className='tool '+t.state;row.children[1].children[0].textContent=t.label;row.children[1].children[1].textContent=t.area;
      var res=row.children[2];res.textContent='';
      if(t.state==='done'){if(t.results!==null&&t.results!==undefined){res.appendChild(el('b','',String(t.results)));res.appendChild(document.createTextNode(' '+(t.unit||'found')))}if(t.seconds!==null&&t.seconds!==undefined)res.appendChild(el('span','sec',t.seconds+' s'))}
      else if(t.state==='run')res.textContent='running';
      else if(t.state==='fail')res.textContent='did not finish';
      else if(t.state==='wait')res.textContent='waiting';
    });
    // A line of a tool the run no longer names leaves the list.
    [].slice.call($('tools').children).forEach(function(row){if(!named[row.id])row.remove()});
    $('sec-tools').className=tools.length?'':'none';
    $('toolsnote').textContent=pre?'Open source scanners. The stack of the repository decides which ones run.':planned?ran+' of '+planned+' ran'+(S.scan&&S.scan.files?' on '+S.scan.files+' files':'')+(S.scan&&S.scan.seconds!==null&&S.scan.seconds!==undefined?' in '+S.scan.seconds+' s':'')+'.':'';
    list('toolnotes',stopped,function(n){var li=el('li');li.appendChild(el('b','',n[0]));li.appendChild(document.createTextNode(' did not finish'+(n[1]?': '+n[1]:'. The scan in the terminal says why.')));return li});
    $('left').textContent=[unneeded.length?'Not needed in this repository: '+unneeded.join(', ')+'.':'',unable.length?'Not run on this machine: '+unable.join(', ')+'.':''].filter(Boolean).join(' ');
    var a=S.audit||{};
    count('reviewed',a.reviewed);$('of').textContent=a.of?' / '+a.of:'';
    // Red is for what blocks: a count of zero flaws is written in the colour of the text.
    var fl=$('flaws');fl.className='big '+(Number(a.flaws)>0?'r':'i')+(/bump/.test(fl.className)?' bump':'');
    count('flaws',a.flaws);count('leads',a.leads);
    $('bar').style.width=a.of?(100*Math.min(1,(a.reviewed||0)/a.of))+'%':'';
    $('barw').className='bar'+(!a.of&&both==='run'?' ind':'');
    $('flawscap').textContent=(a.flaws===1?'flaw':'flaws')+' proven by a test that fails today';
    $('leadscap').textContent=(a.leads===1?'lead':'leads')+' to check, not proven yet';
    var t=S.triage;
    if(t){count('aside',t.setAside);$('triagecap').textContent='of the '+t.total+' findings of the scanners set aside by the triage: this code cannot reach them'}
    else{$('aside').textContent='0';$('triagecap').textContent=S.steps[2].state==='run'?'scanner findings set aside so far: the triage is judging them':'scanner findings set aside by the triage'}
    var feed=$('feed'),now={};
    S.feed.forEach(function(f,i){var k=f.id!==undefined?'i'+f.id:'n'+i;now[k]=1;if(!have[k]){have[k]=1;queue.push({k:k,f:f})}});
    Object.keys(have).forEach(function(k){if(!now[k]){delete have[k];var gone=document.getElementById('feed-'+k);if(gone)gone.remove();queue=queue.filter(function(q){return q.k!==k})}});
    if(!S.feed.length&&!feed.children.length)feed.appendChild(el('li','none','Nothing yet. A flaw shows here the moment its test fails.'));
    if(first&&S.endedAt){while(queue.length)put(queue.shift())}
    first=false;
    pump();
  }
  // What is proven is read first: the replays on the running application, the proven flaws, the leads, then what the review notes.
  // A line comes in at the top of its kind, so the newest of a kind leads it and the page grows downward.
  var RANK={live:0,flaw:1,lead:2,note:3};
  function rank(kind){return RANK[kind]===undefined?3:RANK[kind]}
  function put(q){
    var feed=$('feed'),f=q.f;if(feed.firstChild&&feed.firstChild.className==='none')feed.textContent='';
    var li=el('li','k-'+f.kind);li.id='feed-'+q.k;li.appendChild(el('span','k',f.kind==='flaw'?'proven':f.kind==='lead'?'lead':f.kind==='live'?'seen live':'note'));
    li.appendChild(el('span','t',f.text));if(f.where)li.appendChild(el('span','w',f.where));
    var rows=feed.children,at=null;
    for(var i=0;i<rows.length;i++){if(rank(String(rows[i].className).replace('k-',''))>=rank(f.kind)){at=rows[i];break}}
    if(at)feed.insertBefore(li,at);else feed.appendChild(li);
  }
  function pump(){
    if(busy||!queue.length)return;busy=true;put(queue.shift());
    // One line after the other, a tenth of a second apart: each is seen to land, and ten of them take a second.
    setTimeout(function(){busy=false;if(queue.length)pump();else if(S){try{render()}catch(e){}}},queue.length>8?45:110);
  }
  setInterval(poll,700);setInterval(clock,1000);setInterval(function(){tick++;if(S&&!S.endedAt){try{render()}catch(e){}}},3000);poll();
})();
`;

export function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CybeDefend, live</title>
${fonts('swap')}
<style>${STYLE}</style>
</head>
<body id="app" class="running">
<header class="hd"><div class="in"><div class="logo" role="img" aria-label="CybeDefend">${asset('logo.svg')}</div><div class="timer"><span class="w" id="clockw">Running for </span><span class="clock" id="clock">00:00</span></div></div></header>
<div class="page" id="page">
<div class="hero">
<p class="where"><b id="repo"></b><span id="branch"></span></p>
<h1 id="h1">Getting ready.</h1>
<p class="lead" id="sub"></p>
</div>
<ol class="rail">${RAIL.map((s, i) => `<li class="todo" id="step${i + 1}"><i class="trk"><b id="step${i + 1}f"></b></i><span class="n">0${i + 1}</span><span class="s">${s}</span><span class="p" id="step${i + 1}p"></span></li>`).join('')}</ol>
<div class="body" id="body">
<section id="sec-ai">
<h2>The AI scanner and the triage.</h2>
<div class="cols">
<div><p class="big v"><span id="reviewed">0</span><small id="of"></small></p><p class="cap">entry points reviewed one by one by the AI scanner</p><div class="bar" id="barw"><i id="bar"></i></div></div>
<div><p class="big r" id="flaws">0</p><p class="cap" id="flawscap">flaws proven by a test that fails today</p></div>
<div><p class="big i" id="leads">0</p><p class="cap" id="leadscap">leads to check, not proven yet</p></div>
<div><p class="big m" id="aside">0</p><p class="cap" id="triagecap"></p></div>
</div>
<ul class="feed" id="feed"></ul>
</section>
<section id="sec-tools" class="none">
<h2>The scanners.</h2>
<p id="toolsnote"></p>
<ul class="tools" id="tools"></ul>
<ul class="notes" id="toolnotes"></ul>
<p class="more" id="left"></p>
</section>
</div>
<footer class="ft"><span id="foot">/cybedefend, live. This page reads the run on this machine and sends nothing.</span><span>cybedefend.com</span></footer>
</div>
<script>var LOGOS=${JSON.stringify(toolLogos())},CATALOG=${JSON.stringify(Object.entries(TOOLS).map(([name, [label, area]]) => [name, label, area]))};${SCRIPT}</script>
</body>
</html>
`;
}

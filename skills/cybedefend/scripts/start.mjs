#!/usr/bin/env node
// The first half of /cybedefend in one command, so the agent spends one turn
// on it: the setup (seconds once it is done), the plan, the scanners, the
// send to the dashboard, a digest of what they found, short enough for the
// AI scanner to read whole, and last the scan tool by tool and the sentence
// the agent says to the user about it.
// Node alone runs it, on macOS, Linux, Windows (PowerShell, cmd or Git Bash)
// and WSL.

const USAGE = `Usage, from anywhere inside the repository:
  node start.mjs [--depth quick|deep] [--image <image>] [--no-open]

  --depth quick  the core scanners only
  --image <ref>  also scan the container image the user named
  --no-open      do not open the live page of the run in the browser (an
                 unattended run, CI; CYBEDEFEND_NO_OPEN=1 does the same)

Exit: 0 ready for the AI scanner. 2 a scanner or an import did not finish and
the rest went through (the lines above say which and why). 3 this machine cannot go on
(Docker stopped, the dashboard does not answer, the token is refused).
4 no project. 5 the dashboard was set up by someone else and needs the
user's own token (SKILL.md, step 1). 64 usage error.
`;

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const say = (s = '') => process.stdout.write(`${s}\n`);

class Stop extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const node = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts });

/** Runs a script of the skill, each line of its output handed to `line` as it comes; resolves with its exit code. */
function stream(args, line) {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    createInterface({ input: child.stdout }).on('line', (l) => line(l, 'out'));
    createInterface({ input: child.stderr }).on('line', (l) => line(l, 'err'));
    child.on('error', () => done(127));
    child.on('close', (code) => done(code ?? 1));
  });
}

function parseArgs(argv) {
  const o = { image: '', watch: ['--start'], scan: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--image') {
      o.image = argv[++i] ?? '';
      o.scan.push('--image', o.image);
    } else if (a === '--depth') o.scan.push('--depth', argv[++i] ?? '');
    else if (a === '--no-open') o.watch.push('--no-open');
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Stop(64, `start.mjs: unknown argument ${a}`);
  }
  return o;
}

/**
 * One scan of the send, as the user reads it. A tool that did not finish wrote
 * no file: nothing was sent, and the scan above already said why. A file the
 * dashboard did not take is said with the dashboard's own answer.
 */
export function sendLine(s) {
  if (s.state === 'skipped') return null;
  const name = String(s.scanner).padEnd(13);
  if (!s.scanId) return `  – ${name} nothing to send: it did not finish (the scan above says why)`;
  const n = Number(s.results ?? 0);
  const results = `${String(n).padStart(4)} result${n === 1 ? '' : 's'}`;
  if (['completed', 'completed_degraded'].includes(s.state)) {
    return `  ✓ ${name} ${results} sent as ${String(s.type).padEnd(9)} imported${s.state === 'completed_degraded' && s.errorMessage ? `, with this note from the dashboard: ${s.errorMessage}` : ''}`;
  }
  if (s.state === 'cancelled') return `  ! ${name} ${results} not imported: the import was cancelled on the dashboard`;
  if (s.errorMessage) return `  ! ${name} ${results} not imported: the dashboard answered "${s.errorMessage}"`;
  // Still at work when this script stopped waiting: nothing is lost, the dashboard goes on by itself.
  if (['queued', 'pending', 'running', 'processing', 'in_progress'].includes(String(s.state))) return `  … ${name} ${results} sent as ${String(s.type).padEnd(9)} the dashboard is still reading them: they show on its scans page when it is done`;
  return `  ! ${name} ${results} not imported: the dashboard could not read this file and gave no reason. Its scans page has the detail`;
}

/**
 * Where the run shows, as a sentence, from the line the live page printed
 * (`live view: <file>`, with "opened in the browser" when it was): the agent
 * never says a browser shows a page that did not open. `from`: the folder the
 * command runs from.
 */
export function liveWords(line, from = process.cwd()) {
  const file = /live view:\s*(.+?)(?:\s+\(opened in the browser.*)?$/.exec(String(line ?? '').trim())?.[1];
  if (!file) return '';
  if (/opened in the browser/.test(line)) return 'The run shows live in your browser.';
  // Short when the page is under the folder the command runs from, which is the usual case.
  const under = `${String(from).replace(/[\\/]+$/, '')}`;
  const shown = file.startsWith(`${under}/`) || file.startsWith(`${under}\\`) ? file.slice(under.length + 1) : file;
  return `No browser was opened: the page of the run is ${shown}.`;
}

/**
 * What the command ends on: the scan tool by tool, then one line with how it
 * ended and what follows, in order. First in that line, one message for the
 * user, in quotes: the scan as a sentence (`said`) and what the triage does
 * next. A user's screen folds a command's output, so they read the scan only
 * when the agent writes it; an agent writes a sentence it is handed where a
 * block of fourteen lines to copy goes unsaid, and it announces what it is
 * about to do, so the scan rides on that announcement. It is told to write
 * it as text: what an agent only thinks never reaches the screen.
 * `triage`: the findings the scanners gave (found), those left to judge, the
 * verdicts of the last run that stand and the files that changed since (null
 * when not known: the triage is started).
 */
export function closing({ block, said = '', seconds, rc, triage = null }) {
  const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  // `second`: what the agent does about the triage. `told`: the same, as the user reads it.
  let second = 'the triage to a sub-agent in the background (assess.md, the brief)';
  let told = 'The triage of what the scanners found starts in the background.';
  if (triage) {
    const { found, left, stand, changed } = triage;
    const standing = `${n(stand, 'verdict')} of the last run stand${stand === 1 ? 's' : ''}`;
    if (found === 0) {
      second = 'no triage to start: the scanners found nothing to judge';
      told = 'Nothing for the triage to judge.';
    } else if (stand > 0 && left === 0 && changed === 0) {
      second = `no triage to start: the ${standing}, and nothing the scanners read has changed since`;
      told = `No triage to run: the ${standing}, nothing the scanners read has changed since.`;
    } else if (stand > 0) {
      const rest = `${standing}, ${left === 0 ? 'no finding is' : left === 1 ? '1 finding is' : `${left} findings are`} left to judge, ${n(changed, 'file')} changed since`;
      second += `: ${rest}`;
      told = `The triage starts in the background: ${rest}.`;
    } else told = `The triage of the ${n(found, 'finding')} starts in the background.`;
  }
  const message = `${String(said).replace(/\s+/g, ' ').trim() || 'The scan is done.'} ${told}`;
  return [
    '',
    '▸ The scan, tool by tool',
    String(block ?? '').replace(/\s+$/, ''),
    '',
    `START: done in ${seconds} s (exit ${rc}). Next, in this order: 1. write this message to the user, as text in your reply (what you only think never reaches their screen): "${message}"; 2. ${second}; 3. the AI scanner (audit.md), saying where you are with progress after the map, after each file and at each proof; after a fix, finish.`,
  ].join('\n');
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const t0 = Date.now();
  const tmp = mkdtempSync(join(tmpdir(), 'cybedefend-start-'));
  const stop = (what, code) => new Stop(code, `\nSTART: stopped at ${what} (exit ${code})`);
  // The live page of the run (watch.mjs): a view, never a reason to stop.
  let live = '';
  const watch = (...a) => {
    const r = node([join(here, 'cybedefend.mjs'), 'watch', ...a]);
    for (const l of `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n')) {
      if (!l.includes('live view')) continue;
      say(l);
      live = l;
    }
  };
  try {
    // The name, in three rows: an agent's screen keeps the first three lines of a
    // command's output when it folds the rest, so the name is whole there. The
    // agent's own first message carries the large one (SKILL.md).
    let banner = 'CYBEDEFEND. One skill. A full security audit.\n';
    try {
      banner = readFileSync(join(here, '..', 'assets', 'banner-small.txt'), 'utf8');
    } catch {
      /* the plain line */
    }
    process.stdout.write(banner.endsWith('\n') ? banner : `${banner}\n`);
    watch(...opts.watch);

    // 1. The dashboard, the token, the project, the MCP server, a default policy.
    //    Its steps go to the screen as they come; its JSON is kept apart.
    let setupJson = '';
    const rcSetup = await stream([join(here, 'setup.mjs')], (l, from) => {
      if (from === 'out') setupJson += `${l}\n`;
      else process.stderr.write(`${l}\n`);
    });
    if (rcSetup !== 0) {
      process.stdout.write(setupJson);
      throw stop('the setup', rcSetup);
    }
    try {
      const s = JSON.parse(setupJson);
      say(`  dashboard: ${s.url}   project: ${s.projectUrl ?? 'none'}`);
      if (s.mcp?.name) say(`  MCP server for the next session: ${s.mcp.name}`);
    } catch {
      /* the setup said it all */
    }

    // 2. What runs here, and why.
    say();
    say('▸ The scanners that fit this repository');
    const plan = node([join(here, 'scan.mjs'), '--plan', ...opts.scan]);
    const planText = `${plan.stdout ?? ''}${plan.stderr ?? ''}`;
    if (plan.status !== 0) {
      process.stdout.write(planText);
      throw stop('the plan', plan.status ?? 1);
    }
    const planFile = join(tmp, 'plan.txt');
    writeFileSync(planFile, planText);
    const skipped = [];
    for (const line of planText.split('\n').slice(1)) {
      if (!line.trim()) continue;
      if (line.startsWith('note:')) {
        say(`  ${line}`);
        continue;
      }
      const c = line.trim().split(/\s+/);
      if (c[3] === 'skip') skipped.push(c[0]);
      else say(`  ${c[0].padEnd(14)} ${String(c[1] ?? '').padEnd(9)} ${c[3] ?? ''}`);
    }
    if (skipped.length) say(`  nothing to read here for: ${skipped.join(', ')}`);
    watch('--plan', planFile);

    // 3. The scanners.
    say();
    say('▸ Scanning');
    const rcScan = await stream([join(here, 'scan.mjs'), ...opts.scan], (l) => {
      if (!l.includes(': skipped, nothing it reads') && !l.startsWith('manifest: ')) say(l);
    });
    if (rcScan !== 0 && rcScan !== 2) throw stop('the scan', rcScan);

    // 4. Every result, to the dashboard.
    say();
    say('▸ Sending the results to the dashboard');
    const send = node([join(here, 'cybedefend.mjs'), 'send', ...(opts.image ? ['--image', opts.image] : [])]);
    const rcSend = send.status ?? 1;
    try {
      const r = JSON.parse(send.stdout);
      for (const s of r.scans ?? []) {
        const line = sendLine(s);
        if (line) say(line);
      }
      if (r.error) say(`  ! ${r.error}`);
    } catch {
      process.stdout.write(send.stderr ?? '');
    }
    if (rcSend !== 0 && rcSend !== 2) {
      process.stdout.write(send.stderr ?? '');
      throw stop('the send', rcSend);
    }

    // 5. What they found, for the AI scanner.
    say();
    say('▸ What the scanners found');
    const digest = node([join(here, 'cybedefend.mjs'), 'digest']);
    process.stdout.write(`${digest.stdout ?? ''}${digest.stderr ?? ''}`);

    watch('--step', '1', '--state', 'done');
    watch('--step', '2,3', '--state', 'run');

    // 6. The triage of the last run: its verdicts stand while the code they were given on has not changed.
    let triage = null;
    const check = node([join(here, 'cybedefend.mjs'), 'assess', '--check', '--fresh']);
    try {
      const d = JSON.parse(check.stdout);
      if (d.triage) triage = { found: Number(d.triage.scannerFindings), left: Number(d.triage.notJudged), stand: Number(d.lastTriage?.stand ?? 0), changed: d.lastTriage?.changed ? d.lastTriage.changed.length : 0 };
      const kept = String(check.stderr ?? '').split('\n').filter((l) => l.includes('of the last triage'));
      if (kept.length) {
        say();
        say('▸ The triage of the last run');
        for (const l of kept) say(l);
      }
    } catch {
      /* no word on the last triage: this run's triage judges everything */
    }

    // 7. The scan, tool by tool, then the line the agent acts on: the scan as a sentence for the user, and what follows.
    const rc = rcScan !== 0 || rcSend !== 0 ? 2 : 0;
    let board = { text: '', said: '' };
    try {
      board = JSON.parse(node([join(here, 'cybedefend.mjs'), 'board', '--json']).stdout);
    } catch {
      /* no board: the closing line still says what follows */
    }
    const said = [board.said, liveWords(live)].filter(Boolean).join(' ');
    say(closing({ block: board.text, said, seconds: Math.round((Date.now() - t0) / 1000), rc, triage }));
    return rc;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      if (e instanceof Stop) {
        if (e.code === 64) process.stderr.write(`${e.message}\n${USAGE}`);
        else say(e.message);
        process.exitCode = e.code;
      } else {
        process.stderr.write(`start.mjs: ${e?.stack ?? e}\n`);
        process.exitCode = 3;
      }
    },
  );
}

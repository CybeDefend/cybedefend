// The audit as one page to read and to hand over: .cybedefend/out/audit-report.html.
// Written by `cybedefend.mjs finish` from what the run already holds (the
// verdict, the triage, the map, the proof tests): no model call, no token.
// Self-contained but for its two typefaces (Rubik and JetBrains Mono, from
// Google Fonts as on cybedefend.com; without a network the page falls back
// to the system's).
//
// What it shows, in this order: the verdict; what a test proves today, each
// flaw with the test that is its exploit; what the scanners report, with the
// agent's assessment; the dependencies to upgrade; the secrets to revoke;
// what the review covered. No secret value ever reaches it: the proof tests'
// code is masked like every result.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FRAME, PALETTE, fonts } from './look.mjs';
import { envValue, isWsl } from './os.mjs';
import { insideRoot } from './trust.mjs';
import { usageLine } from './usage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A path or the name of a package, free to go to the next line after a slash: a long one is cut there before anywhere else. */
const breakable = (s) => esc(s).replace(/\//g, '/<wbr>');
/** A package or a place named in a cell that breaks anywhere to fit: a short one stays in one piece, a long one goes to the next line after a slash. */
const named = (s) => (String(s ?? '').length <= 32 ? `<code class="k">${esc(s)}</code>` : `<code>${breakable(s)}</code>`);

/** The version to move to, as a reader needs it: a Go pseudo-version says the fix is in a commit that no release holds yet. */
export const shownUpgrade = (v) => {
  if (!v) return 'no fixed version yet';
  const pseudo = /[-.]\d{14}-([0-9a-f]{12})$/.exec(String(v));
  return pseudo ? `no release yet (the fix is in commit ${pseudo[1]})` : String(v);
};

/** An asset of the skill (the logo), inlined; empty when it is not there. */
function asset(name) {
  try {
    return readFileSync(join(HERE, '..', 'assets', name), 'utf8').replace(/<\?xml[^>]*\?>\s*/, '');
  } catch {
    return '';
  }
}

/**
 * The source of a proof test, from "file > name", "file::name" or
 * "file::Class::name": the test's own lines, its marks above it, at most 60
 * lines. Null when the file or the test cannot be found.
 */
export function proofSource(root, proofTest) {
  const parts = String(proofTest ?? '').split(/\s+>\s+|::/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const file = parts[0];
  // The real path, in the repository: a committed link to a file elsewhere is not a proof of this code.
  const path = insideRoot(root, resolve(root, file));
  if (!path) return null;
  let lines;
  try {
    lines = readFileSync(path, 'utf8').split('\n');
  } catch {
    return null;
  }
  const name = parts[parts.length - 1].split('/')[0];
  const starts = /(\bdef |\bfunc |\bit(\.\w+)?\(|\btest(\.\w+)?\(|\bproof\(|\bdescribe\(|\bpublic void |\bfun |\bscenario |\bexample )/;
  let at = lines.findIndex((l) => l.includes(name) && starts.test(l));
  if (at < 0) at = lines.findIndex((l) => l.includes(name));
  if (at < 0) return null;
  let start = at;
  while (start > 0 && /^\s*(@|#|\/\/)/.test(lines[start - 1])) start -= 1;
  const indent = lines[at].match(/^\s*/)[0].length;
  let end = at + 1;
  for (; end < lines.length && end - start < 60; end += 1) {
    const l = lines[end];
    if (l.trim() === '') continue;
    const ind = l.match(/^\s*/)[0].length;
    if (ind <= indent && (starts.test(l) || /^\s*(@|class )/.test(l))) break;
    if (ind < indent && !/^[\s})\];,]*$/.test(l)) break;
  }
  while (end > at + 1 && lines[end - 1].trim() === '') end -= 1;
  // The marks of the next test are not this one's.
  while (end > at + 1 && /^\s*(@|#|\/\/)/.test(lines[end - 1])) end -= 1;
  return { file, name: parts[parts.length - 1], line: start + 1, code: lines.slice(start, end).join('\n'), cut: end - start >= 60 };
}

// The report is a web page, not a sheet: dark to the edges of the window, as wide as the window up to a wide screen.
// The header stays at the top with the way to each part; a proof shows what it says and the test that proves it side
// by side when there is room for both. The PDF is this page printed: the same dark page, to the edge of each sheet.
/**
 * The policy of the audit page. The page shows what the repository, the
 * scanners and the live replay wrote, and opens in the user's browser and in
 * the PDF step: it runs no script at all, loads its two typefaces and nothing
 * else, and takes images only from inside the page. Text that slips through
 * as markup is then never code.
 */
export const PAGE_POLICY = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'";

const STYLE = `
${PALETTE}
${FRAME}
/* Printed from the browser, every folded proof shows: the page runs no script to open them. */
@media print{details::details-content{content-visibility:visible;display:block;height:auto}}
html{scroll-behavior:smooth;scroll-padding-top:96px}
header.hd{position:sticky;top:0;z-index:5;background:rgba(10,9,16,.84);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.toc{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 4px}
.toc a{padding:7px 12px;border-radius:999px;font:400 12.5px/1.2 'JetBrains Mono',monospace;color:var(--body);text-decoration:none;transition:color .2s,background .2s}
.toc a:hover{color:var(--ink);background:var(--raise)}
.where{font:400 13px/1.6 'JetBrains Mono',monospace;color:var(--faint);margin-bottom:20px;overflow-wrap:anywhere}
.where b{color:var(--lav);font-weight:400}
.page{counter-reset:part}
h2{counter-increment:part;font:800 clamp(27px,2.7vw,40px)/1.1 'Rubik',sans-serif;letter-spacing:-.04em;margin-top:84px;padding-top:36px;border-top:1px solid var(--line)}
h2::before{content:counter(part,decimal-leading-zero);display:block;margin-bottom:14px;font:400 12.5px/1 'JetBrains Mono',monospace;letter-spacing:.14em;color:var(--lav)}
h2+p{font-size:17px;color:var(--body);margin-top:14px;max-width:48em}
/* A finding is a card. With its proof, what it says is on the left and the test on the right when the card is wide
   enough for two columns of text; otherwise one is under the other. */
.find{margin-top:16px;padding:26px 28px 28px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012))}
h2+p+.find,h2+.find{margin-top:28px}
.find.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,470px),1fr));gap:22px clamp(28px,3vw,48px);align-items:start}
.find h3{font:700 clamp(20px,1.7vw,24px)/1.25 'Rubik',sans-serif;letter-spacing:-.02em;max-width:30em}
.tag{margin-bottom:12px}
.sev{font:400 11.5px/1 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase}
.tag .sev{display:inline-block;padding:6px 10px;border:1px solid currentColor;border-radius:999px}
.sev.critical,.sev.high{color:var(--red)} .sev.medium{color:var(--ink)} .sev.low,.sev.info{color:var(--faint)}
.find .msg{font-size:16px;color:var(--body);margin-top:10px;max-width:46em}
dl.facts{display:grid;grid-template-columns:128px minmax(0,1fr);gap:9px 18px;margin-top:20px;padding-top:18px;border-top:1px solid var(--line);font-size:14.5px;max-width:60em}
dl.facts dt{font:400 11.5px/1.9 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
dl.facts dd{color:var(--ink);overflow-wrap:anywhere}
dl.facts dd.fix{color:var(--mint);font-weight:500}
dl.facts dd.blk{color:var(--red);font-weight:500}
code{color:var(--lav)}
details{margin-top:16px}
.find.two details{margin-top:0}
/* The test stays in view while the reader goes down what it proves. */
@media screen{.find.two>details{position:sticky;top:96px}}
summary{cursor:pointer;display:inline-block;padding:9px 16px;border:1px solid var(--line);border-radius:12px;background:var(--panel);font-size:14px;font-weight:500;color:var(--ink);list-style:none;overflow-wrap:anywhere;transition:border-color .2s}
summary:hover{border-color:var(--lav)}
summary::-webkit-details-marker{display:none}
summary::before{content:"+";display:inline-block;width:16px;color:var(--lav);font-weight:700}
details[open]>summary::before{content:"-"}
.term{background:#06050B;border:1px solid var(--line);border-radius:14px;box-shadow:0 30px 70px -40px rgba(143,115,255,.5);overflow:hidden;margin-top:12px}
.term .bar{padding:11px 16px;display:flex;gap:6px;align-items:center;border-bottom:1px solid var(--line);background:rgba(255,255,255,.025)}
.term .dot{flex:none;width:9px;height:9px;border-radius:50%;background:var(--line)}
.term .dot:first-child{background:var(--red)}
.term .name{margin-left:10px;font:400 12px/1.4 'JetBrains Mono',monospace;color:var(--faint);overflow-wrap:anywhere}
/* A line of code longer than the page goes to the next line: nothing of a proof is cut at the right edge. */
.term pre{font:400 12.5px/1.75 'JetBrains Mono',monospace;color:#DCD3F7;padding:16px 20px 18px;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}
/* A table is as wide as the page and no wider: its columns hold short values, a name or a path goes to the next line
   where it must, and a long sentence (the triage, what to do) is a line of its own under its row. */
.tw{margin-top:24px;border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
details>.tw{margin-top:12px}
table{border-collapse:collapse;width:100%;font-size:14px}
th{font:400 11.5px/1.4 'JetBrains Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);text-align:left;padding:13px 18px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.025);white-space:nowrap}
td{padding:12px 18px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
tbody tr:last-child>td{border-bottom:0}
td.w{white-space:nowrap}
code.k{white-space:nowrap}
td.n{font-variant-numeric:tabular-nums;white-space:nowrap}
td.y{color:var(--red);font-weight:600;white-space:nowrap}
tr.h>td{border-bottom:0;padding-bottom:4px}
tr.u>td{padding:0 18px 14px;color:var(--body);font-size:13.5px;line-height:1.55}
tr.u p{max-width:74em}
tr.u p+p{margin-top:3px}
tr.u b{color:var(--ink);font-weight:600}
ul.l{list-style:none;margin-top:22px;border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
ul.l li{font-size:15.5px;color:var(--body);padding:13px 20px 13px 44px;border-top:1px solid var(--line);position:relative;overflow-wrap:anywhere}
ul.l li:first-child{border-top:0}
ul.l li::before{content:"";position:absolute;left:20px;top:24px;width:10px;height:2px;background:var(--violet)}
ul.l li code{margin-right:6px}
.more{font-size:14px;color:var(--faint);margin-top:14px}
/* The way to each part leaves the header when the window has no room for it. */
@media screen and (max-width:1100px){.toc{display:none}}
/* Between a phone and a laptop the cells stand closer, so a table of seven columns still fits its page. */
@media screen and (max-width:1000px){th,td{padding-left:12px;padding-right:12px}tr.u>td{padding-left:12px;padding-right:12px}}
/* A narrow window: each row of a table becomes a block, and each value says what it is. */
@media screen and (max-width:760px){html{scroll-padding-top:76px}.logo svg{height:40px}header.hd .in{min-height:64px}.cols{grid-template-columns:1fr 1fr;gap:10px}.cols>*{padding:16px 16px 18px}.cap{font-size:14px}h2{margin-top:60px;padding-top:28px}.find{padding:20px 18px 22px;border-radius:16px}dl.facts{grid-template-columns:minmax(0,1fr);gap:0}dl.facts dt{margin-top:10px}table,tbody,tr,td{display:block}thead{display:none}tr{padding:12px 16px;border-bottom:1px solid var(--line)}tbody tr:last-child{border-bottom:0}tr.h{border-bottom:0;padding-bottom:2px}tr.u{padding-top:0}td,td.w,tr.h>td,tr.u>td{border:0;padding:2px 0;white-space:normal}td:empty{display:none}td[data-h]::before{content:attr(data-h) ": ";color:var(--faint);font-weight:400}footer.ft{flex-direction:column;gap:4px}}
/* Printed, it is the same dark page: the margins of each sheet are painted with the page's background, so no sheet
   is left with an unpainted edge, and nothing is cut between two sheets. */
@page{size:A4;margin:12mm 0;background:#0A0910}
@page:first{margin-top:0}
@media print{html{scroll-behavior:auto}header.hd{position:static;background:none;-webkit-backdrop-filter:none;backdrop-filter:none}header.hd .in{min-height:0;padding:9mm 14mm 5mm}.logo svg{height:46px}.toc{display:none}.page{max-width:none;padding:0 14mm}.hero{padding-top:10mm}.where{font-size:11.5px;margin-bottom:14px}h1{font-size:42px}.lead{font-size:16px;margin-top:14px}.cols{gap:8px;margin-top:26px}.cols>*{padding:14px 14px 16px;border-radius:12px;break-inside:avoid}.big{font-size:42px}.cap{font-size:12.5px;margin-top:10px}h2{font-size:26px;margin-top:34px;padding-top:22px;break-after:avoid}h2::before{margin-bottom:10px;break-after:avoid}h2+p{font-size:14.5px;margin-top:10px;break-after:avoid}h2+p+.find,h2+.find{margin-top:18px}.find{margin-top:12px;padding:16px 18px 18px;border-radius:14px;-webkit-box-decoration-break:clone;box-decoration-break:clone}.find.two{display:block}.find.two details{margin-top:14px}.term,.find details,.find .msg,dl.facts dt,dl.facts dd{break-inside:avoid}.find h3{font-size:18px;break-after:avoid}.tag{margin-bottom:9px;break-after:avoid}.find .msg{font-size:14px;margin-top:7px}dl.facts{font-size:13px;gap:5px 16px;margin-top:14px;padding-top:12px}dl.facts dt{font-size:10.5px}.term{box-shadow:none;margin-top:9px}.term .bar{padding:8px 14px}.term pre{font-size:11px;line-height:1.6;padding:12px 16px 14px}summary{border:0;padding:0;background:none;font-size:13px}.tw{margin-top:18px;-webkit-box-decoration-break:clone;box-decoration-break:clone}table{font-size:12.5px}th{padding:9px 10px;font-size:9.5px;letter-spacing:.04em}td{padding:8px 10px}tr.u>td{padding:0 10px 10px;font-size:12px}tr{break-inside:avoid}tr.h{break-after:avoid}ul.l{margin-top:16px;-webkit-box-decoration-break:clone;box-decoration-break:clone}ul.l li{font-size:14px;padding:10px 16px 10px 40px;break-inside:avoid}ul.l li::before{left:16px;top:20px}footer.ft{margin-top:36px;font-size:11px;break-before:avoid}}
`;

const sevWord = (s) => `<span class="sev ${esc(s)}">${esc(s)}</span>`;

/**
 * A table from columns { head, cell(row), cls?, keep?, under? }: a column whose
 * cells are all empty is left out, unless it says keep. A column that says
 * `under` holds a sentence, not a value: it is no column, it is written under
 * its row, as wide as the table, after its name.
 */
function table(columns, rows) {
  const filled = (c) => c.keep || rows.some((r) => String(c.cell(r) ?? '') !== '');
  const shown = columns.filter((c) => !c.under && filled(c));
  const under = columns.filter((c) => c.under && filled(c));
  return `<div class="tw"><table><thead><tr>${shown.map((c) => `<th>${esc(c.head)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => {
      const more = under.map((c) => [c.head, String(c.cell(r) ?? '')]).filter(([, text]) => text !== '');
      const cells = shown.map((c) => `<td${c.cls ? ` class="${typeof c.cls === 'function' ? c.cls(r) : c.cls}"` : ''} data-h="${esc(c.head)}">${c.cell(r) ?? ''}</td>`).join('');
      return `<tr${more.length ? ' class="h"' : ''}>${cells}</tr>${more.length ? `<tr class="u"><td colspan="${shown.length}">${more.map(([head, text]) => `<p><b>${esc(head)}.</b> ${text}</p>`).join('')}</td></tr>` : ''}`;
    })
    .join('')}</tbody></table></div>`;
}

/** The page as it is printed: every folded part open, so the PDF holds each proof and the whole map. */
export const printCopy = (html) => String(html).replace(/<details(?! open)(?=[\s>])/g, '<details open');

/**
 * Writes the page. `merged` is mergeAudit's result once markBlocking has run
 * on it; `v` the verdict; `blocks` what markBlocking returned; `coverage` the
 * map read by readMap (or null); `secrets` their places; `mask` masks the
 * located secret values in a text; `probes` the live requests still current,
 * `staleProbes` how many were made before the code last changed.
 */
/** The sentence that says verdicts came from files this machine did not write; null when none did. On the page and in the final answer. */
export function fromFilesNote({ applied = 0, held = [] } = {}) {
  const n = (count, one, many = `${one}s`) => `${count} ${Number(count) === 1 ? one : many}`;
  const heldCount = held.reduce((sum, h) => sum + h.verdicts, 0);
  const words = [];
  if (applied) words.push(`${n(applied, 'verdict')} of this answer come${applied === 1 ? 's' : ''} from files this machine did not write, applied with --accept-verdicts.`);
  if (heldCount) words.push(`${n(heldCount, 'verdict')} found in files this machine did not write ${heldCount === 1 ? 'was' : 'were'} not applied (${held.map((h) => h.file).join(', ')}).`);
  return words.length ? words.join(' ') : null;
}

export function writeReport({ root, out, merged, v, blocks, coverage, secrets = [], link, branch, commit, probes = [], staleProbes = 0, fromFiles = null, usage = null, mask = (t) => t, now = new Date() }) {
  const repo = basename(root);
  const s = merged.summary;
  const ship = v.verdict === 'SHIP';
  const blockingCount = v.blocking.reduce((n, b) => n + b.findings.length, 0);
  const code = merged.triage.filter((g) => !g.package);
  const order = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (b.blocks === true) - (a.blocks === true) || (b.score ?? 0) - (a.score ?? 0);
  const proven = code.filter((g) => g.proven === true).sort(order);
  const leads = code.filter((g) => g.proven === false);
  // What the triage set aside is out of the tables: it has its own section, with the reasons.
  const fromScanners = code.filter((g) => (g.proven === null || g.proven === undefined) && !g.setAside).sort(order);
  const packages = (merged.packages ?? []).filter((p) => !p.setAside);
  const triage = s.triage?.scannerFindings ? s.triage : null;
  const judged = (a) => (a ? `${esc({ not_exploitable: 'out of reach', theoretical: 'reachable', proven: 'proven' }[a.verdict] ?? a.verdict)}: ${esc(a.reason)}` : '');
  const date = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const who = (g) => (g.byAiScanner ? (g.byScanners.length ? `the AI scanner, and ${g.byScanners.join(', ')}` : 'the AI scanner alone') : g.byScanners.join(', '));
  const parts = [];
  // Each part of the page has a title, and a short name in the header that leads to it.
  const toc = [];
  const part = (id, name, title) => {
    toc.push([id, name]);
    return `<h2 id="${id}">${title}</h2>`;
  };

  // ── the verdict
  const rules = v.blocking.map((b) => b.rule).filter(Boolean);
  parts.push('<div class="hero">');
  parts.push(`<p class="where"><b>${esc(repo)}</b>${branch ? `, branch ${esc(branch)}` : ''}${commit ? `, commit ${esc(commit)}` : ''}, ${esc(date)}</p>`);
  parts.push(`<h1 class="${ship ? 'ok' : 'no'}">${ship ? `${esc(repo)} can ship.` : `${esc(repo)} is not ready to ship.`}</h1>`);
  parts.push(
    `<p class="lead">${
      ship
        ? `No rule of the team's policies blocks this branch.${v.warnings ? ` ${plural(v.warnings, 'finding matches', 'findings match')} a rule that only warns.` : ''}`
        : `<b>${plural(blockingCount, 'finding blocks', 'findings block')}</b> under the team's ${rules.length > 1 ? 'policies' : 'policy'}${rules.length ? ` ${rules.map((r) => `&ldquo;${esc(r)}&rdquo;`).join(', ')}` : ''}: ${blocks.findings ?? blocks.code.length} in the code and its configuration, ${plural(blocks.dependencies.advisories, 'advisory', 'advisories')} on ${plural(blocks.dependencies.packages, 'package')} to upgrade.`
    }</p>`,
  );
  // Set-asides that rest on a file this machine did not write: said where the page and its PDF are read, next to the verdict.
  const fromElsewhere = fromFiles ? fromFilesNote(fromFiles) : null;
  if (fromElsewhere) parts.push(`<p class="lead">${esc(fromElsewhere)}</p>`);
  parts.push('</div>');
  const numbers = [
    [blockingCount, ship ? 'm' : 'r', blockingCount === 1 ? 'finding blocks the deploy.' : 'findings block the deploy.'],
    [coverage?.rows ?? 0, 'v', `entry ${coverage?.rows === 1 ? 'point' : 'points'} reviewed one by one by the AI scanner.`],
    [proven.length, 'm', `${proven.length === 1 ? 'flaw' : 'flaws'} proven by a test that fails today${triage?.judged ? `, ${s.onlyAiScanner.length} seen by no scanner` : ''}.`],
    // With a triage: how much of what the scanners reported this code cannot reach.
    triage?.judged ? [triage.setAside, 'i', `of the ${triage.scannerFindings} findings of the scanners set aside by the triage: this code cannot reach them.`] : [s.onlyAiScanner.length, 'i', `of them seen by no scanner.`],
  ];
  parts.push(`<div class="cols">${numbers.map(([n, c, cap]) => `<div><p class="big ${c}">${n}</p><p class="cap">${esc(cap)}</p></div>`).join('')}</div>`);

  // ── what a test proves
  if (proven.length) {
    parts.push(part('proofs', 'Proofs', 'What a test proves today.'));
    parts.push('<p>Each flaw below is shown by a test in this repository. The test is the exploit: it does what an attacker would do, with test data, in the test process, and it fails for the reason given until the code is fixed.</p>');
    proven.forEach((g, i) => {
      const src = proofSource(root, g.proofTest);
      const seen = probes.filter((x) => x.finding === `${g.uri}:${g.line}`);
      const facts = [
        g.impact ? ['At stake', esc(mask(g.impact))] : null,
        g.attack ? ['How it is done', esc(mask(g.attack))] : null,
        ['Where', `<code>${esc(g.uri)}:${esc(g.line)}</code>`],
        g.entryPoint ? ['Entry point', `<code>${esc(g.entryPoint)}</code>`] : null,
        g.guarantee ? ['Guarantee', esc(g.guarantee)] : null,
        ['Found by', esc(who(g))],
        g.challenge === 'holds' ? ['Challenged', 'A second agent, which did not write this proof, tried to break it and could not.'] : null,
        g.score ? ['Rated', `${esc(g.score)} out of 10 by the AI scanner${s.severityFrom === 'dashboard' ? `, ${esc(g.severity)} in the dashboard with the project&rsquo;s context` : ''}`] : null,
        g.blocks ? ['Policy', 'Blocks the deploy', 'blk'] : null,
        seen.length ? ['Seen live', seen.map((x) => `${esc(x.request.method)} <code>${esc(x.request.url)}</code> answered ${esc(x.response.status)}${x.note ? `: ${esc(x.note)}` : ''}`).join('<br>')] : null,
        g.fix ? ['The fix', esc(g.fix), 'fix'] : null,
      ].filter(Boolean);
      parts.push(
        `<section class="find${src ? ' two' : ''}"><div><p class="tag">${sevWord(g.severity)}</p><h3>${esc(g.title)}</h3>` +
          `<p class="msg">${esc(mask(g.message))}</p>` +
          `<dl class="facts">${facts.map(([k, val, cls]) => `<dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${val}</dd>`).join('')}</dl>` +
          (src
            ? `</div><details${i < 3 ? ' open' : ''}><summary>The proof: ${esc(src.name)}</summary><div class="term"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="name">${esc(src.file)}:${esc(src.line)}</span></div><pre>${esc(mask(src.code))}${src.cut ? '\n...' : ''}</pre></div></details>`
            : `<p class="more">The proof: <code>${esc(g.proofTest)}</code></p></div>`) +
          '</section>',
      );
    });
  }

  // ── what the replay on the running application showed
  if (probes.length) {
    // The replays of a finding first; the sign-ups and the checks around them after, closed.
    const shown = [...probes.filter((x) => x.finding), ...probes.filter((x) => !x.finding && x.note)].slice(0, 30);
    parts.push(part('live', 'Live', 'What the application answered, on this machine.'));
    parts.push(`<p>The application was started here, with throwaway data, and the flaws above were replayed on it as requests: ${plural(probes.length, 'request')} in all, none to any other machine. Tokens, cookies and passwords are masked.</p>`);
    shown.forEach((x, i) => {
      const req = [`${x.request.method} ${x.request.url}`, ...Object.entries(x.request.headers ?? {}).map(([k, val]) => `${k}: ${val}`), ...(x.request.body ? ['', x.request.body] : [])].join('\n');
      // A whole HTML page says nothing here: the note says what it showed, and the page is in live.json.
      const answer = String(x.response.body ?? '');
      const page = answer.length > 400 && (/html/i.test(String(x.response.headers?.['content-type'] ?? '')) || /^\s*<(!doctype|html)/i.test(answer));
      const shownAnswer = page ? `(an HTML page of ${answer.length} characters, kept in .cybedefend/out/live.json)` : answer.length > 900 ? `${answer.slice(0, 900)}\n...` : answer;
      const res = [`${x.response.status}`, ...Object.entries(x.response.headers ?? {}).map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(', ') : val}`), ...(shownAnswer ? ['', shownAnswer] : [])].join('\n');
      parts.push(
        `<section class="find two"><div><h3>${esc(x.note ?? `${x.request.method} ${x.request.url}`)}</h3>` +
          `<dl class="facts">${x.finding ? `<dt>Finding</dt><dd><code>${esc(x.finding)}</code></dd>` : ''}<dt>Answer</dt><dd>${esc(x.response.status)}</dd></dl></div>` +
          `<details${i < 2 && x.finding ? ' open' : ''}><summary>The request and the answer</summary><div class="term"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="name">probe ${esc(x.id)}, ${esc(x.at ?? '')}</span></div><pre>${esc(mask(req))}\n\n${esc(mask(res))}</pre></div></details></section>`,
      );
    });
    if (probes.length > shown.length) parts.push(`<p class="more">${probes.length - shown.length} more ${probes.length - shown.length === 1 ? 'request' : 'requests'} (sign-ups and sign-ins of the test accounts) in <code>.cybedefend/out/live.json</code>.</p>`);
  }

  // A replay made before the code last changed is not evidence of what the application answers now.
  if (staleProbes) {
    if (!probes.length) parts.push(part('live', 'Live', 'What the application answered, on this machine.'));
    parts.push(`<p class="more">${plural(staleProbes, 'request')} of an earlier live replay ${staleProbes === 1 ? 'is' : 'are'} not shown: the code changed since. <code>/cybedefend live</code> replays the findings on the code as it is now.</p>`);
  }

  // ── what the scanners report
  if (fromScanners.length) {
    parts.push(part('scanners', 'Scanners', 'What the scanners report in the code and its configuration.'));
    parts.push(`<p>Open source scanners, run on a read-only copy of the files git sees.${triage?.judged ? ' The coding agent judged each finding against this code: the ones below were kept, with what makes them reachable.' : ''}</p>`);
    const rows = fromScanners.slice(0, 80);
    parts.push(
      table(
        [
          { head: 'Severity', cell: (g) => sevWord(g.severity), cls: 'w', keep: true },
          { head: 'Blocks', cell: (g) => (g.blocks ? 'yes' : ''), cls: 'y' },
          { head: 'Found by', cell: (g) => esc(who(g)), cls: 'w' },
          { head: 'Finding', cell: (g) => esc(g.title), keep: true },
          { head: 'Where', cell: (g) => `<code>${breakable(g.uri)}:${esc(g.line)}</code>`, keep: true },
          { head: 'The triage', cell: (g) => judged(g.assessment), under: true },
          { head: 'What to do', cell: (g) => esc(g.fix ?? ''), under: true },
        ],
        rows,
      ),
    );
    if (fromScanners.length > rows.length) parts.push(`<p class="more">${fromScanners.length - rows.length} more in <code>.cybedefend/out/triage.md</code> and in the dashboard.</p>`);
  }

  // ── dependencies
  if (packages.length || s.dependencies.packagesRead === 0) {
    parts.push(part('dependencies', 'Dependencies', 'Dependencies to upgrade.'));
    if (s.dependencies.packagesRead === 0) parts.push('<p>The dependencies were not checked: the scanner found no lockfile or pinned versions to read. This is not a clean result.</p>');
    else {
      const main = (merged.broughtInBy ?? []).filter((b) => b.dependency && b.dependency !== 'a direct dependency');
      parts.push(
        `<p>${plural(packages.reduce((n, p) => n + p.advisories, 0), 'advisory', 'advisories')} on ${plural(packages.length, 'package')}${triage?.packagesSetAside ? ' that run where an attacker&rsquo;s input can arrive' : ''}, one line per package to upgrade.${main.length ? ` What blocks comes in through ${main.slice(0, 3).map((b) => `<code>${esc(b.dependency)}</code> (${plural(b.advisories, 'advisory', 'advisories')})`).join(', ')}: upgrading or replacing it clears them together.` : ''}</p>`,
      );
      const rows = packages.slice(0, 60);
      parts.push(
        table(
          [
            { head: 'Severity', cell: (p) => sevWord(p.severity), cls: 'w', keep: true },
            { head: 'Package', cell: (p) => `<code>${breakable(p.package)}</code>`, keep: true },
            { head: 'Installed', cell: (p) => esc(p.installed), keep: true },
            { head: 'Upgrade to', cell: (p) => esc(shownUpgrade(p.upgradeTo)), keep: true },
            { head: 'Advisories', cell: (p) => String(p.advisories), cls: 'n', keep: true },
            { head: 'Blocks', cell: (p) => (p.blocking ? `yes (${p.blocking})` : ''), cls: 'y' },
            { head: 'Brought in by', cell: (p) => (p.via && p.via !== 'a direct dependency' ? `<code>${breakable(p.via)}</code>` : esc(p.via ?? '')) },
            { head: 'The triage', cell: (p) => judged(p.assessment), under: true },
          ],
          rows,
        ),
      );
      if (packages.length > rows.length) parts.push(`<p class="more">${packages.length - rows.length} more in <code>.cybedefend/out/triage.md</code>.</p>`);
    }
  }

  // ── what the triage set aside, and why
  if (triage?.setAside) {
    parts.push(part('set-aside', 'Set aside', 'What the triage set aside.'));
    parts.push(
      `<p>${plural(triage.setAside, 'finding')} of the scanners${triage.packagesSetAside ? `, on ${plural(triage.packagesSetAside, 'package')},` : ''} cannot be reached in this code. Each is in the dashboard under the status &ldquo;ignored&rdquo;, with the reason below: the policies do not count it, and anyone can open it again there.</p>`,
    );
    parts.push(
      table(
        [
          { head: 'Findings', cell: (r) => String(r.findings), cls: 'n', keep: true },
          { head: 'Why this code cannot be reached', cell: (r) => esc(r.reason), keep: true },
          { head: 'For example', cell: (r) => r.examples.map(named).join(', '), keep: true },
        ],
        triage.setAsideReasons.slice(0, 30),
      ),
    );
  }
  if (triage?.notJudged) parts.push(`<p class="more">${plural(triage.notJudged, 'finding')} of the scanners got no verdict and ${triage.notJudged === 1 ? 'stays' : 'stay'} open as reported: ${esc(triage.notJudgedFirst.join(', '))}${triage.notJudged > triage.notJudgedFirst.length ? ', and more' : ''}.</p>`);

  // ── secrets
  if (secrets.length) {
    parts.push(part('secrets', 'Secrets', 'Secrets to revoke.'));
    parts.push('<p>A secret in a repository is exposed, whatever the code does with it. Its owner revokes it and issues a new one; removing it from the file does not undo the exposure. Values are never shown here.</p>');
    parts.push(`<ul class="l">${secrets.slice(0, 40).map((x) => `<li><code>${esc(x.file)}:${esc(x.line)}</code> ${esc(String(x.kind).replace(/-/g, ' '))}</li>`).join('')}</ul>`);
    if (secrets.length > 40) parts.push(`<p class="more">${secrets.length - 40} more in the dashboard.</p>`);
  }

  // ── leads
  if (leads.length) {
    parts.push(part('leads', 'Leads', 'Leads the review could not prove.'));
    parts.push('<p>No test shows these yet, so they cannot block a deploy. They are places to look.</p>');
    parts.push(`<ul class="l">${leads.map((g) => `<li><code>${esc(g.uri)}:${esc(g.line)}</code> ${esc(mask(g.message))}</li>`).join('')}</ul>`);
  }

  // ── coverage
  if (coverage?.rows) {
    parts.push(part('coverage', 'Coverage', 'What the review covered.'));
    parts.push(
      `<p>${plural(coverage.rows, 'entry point')} listed from the code and reviewed one by one: ${coverage.ok} sound, ${coverage.finding} with a finding, ${coverage.lead} with a lead${coverage.notExamined ? `, ${coverage.notExamined} not examined in this run and named below` : ''}.</p>`,
    );
    const list = coverage.list ?? [];
    if (list.length) {
      parts.push(
        `<details${list.length <= 40 ? ' open' : ''}><summary>The map: ${plural(list.length, 'entry point')}, each with its verdict</summary>${table(
          [
            { head: 'Entry point', cell: (r) => `<code>${esc(r.entry.replace(/`/g, ''))}</code>`, cls: 'w', keep: true },
            { head: 'Verdict', cell: (r) => esc(r.verdict.replace(/[`*]/g, '')), keep: true },
          ],
          list,
        )}</details>`,
      );
    }
  }

  // ── method
  parts.push(part('method', 'Method', 'How this audit was made.'));
  parts.push(
    `<ul class="l"><li>The AppSec scanners, open source, ran on a read-only copy of the repository: ${esc(s.tools.filter((t) => t !== 'cybedefend-audit').join(', '))}.</li>` +
      '<li>The AI scanner is the coding agent of this session, following CybeDefend&rsquo;s method: it listed the entry points from the code, wrote what the code guarantees, and looked for what breaks it.</li>' +
      '<li>A flaw counts when a test in this repository shows it. What could not be proven is a lead, and cannot block.</li>' +
      (triage?.judged ? '<li>Every finding of the scanners was judged against the code: kept when the code runs where an attacker&rsquo;s input can arrive, set aside with its reason when it cannot be reached.</li>' : '') +
      `<li>The verdict is the one of the team&rsquo;s policies in the CybeDefend dashboard${link ? `: <a href="${esc(link)}">${esc(link)}</a>` : ''}.</li>` +
      // What the run cost the agent, as its harness logged it: said only when it could be read.
      (usage ? `<li>What the coding agent spent on this audit: ${esc(usageLine(usage))}</li>` : '') +
      '</ul>',
  );

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">
<title>CybeDefend audit of ${esc(repo)}</title>
${fonts('block')}
<style>${STYLE}</style>
</head>
<body>
<header class="hd"><div class="in"><div class="logo" role="img" aria-label="CybeDefend">${asset('logo.svg')}</div><nav class="toc" aria-label="The parts of this page">${toc.map(([id, name]) => `<a href="#${id}">${esc(name)}</a>`).join('')}</nav></div></header>
<div class="page ${ship ? 'ok' : 'no'}">
${parts.join('\n')}
<footer class="ft"><span>Generated by /cybedefend on ${esc(date)}. Every proof is a test in this repository: run it to see it fail.</span><span>cybedefend.com</span></footer>
</div>
</body>
</html>
`;
  const file = join(out, 'audit-report.html');
  writeFileSync(file, html);
  return file;
}

/** The browsers Windows installs, under its program folders: Edge comes with Windows 10 and 11. */
const WINDOWS_BROWSERS = [
  ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
  ['BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'],
  ['Chromium', 'Application', 'chrome.exe'],
];

/**
 * A browser of this machine that can print a page without a window: Chrome,
 * Chromium, Edge or Brave. On WSL, when Linux has none, the Windows one (the
 * caller then hands it Windows paths).
 */
export function findBrowser(env = process.env, { platform = process.platform, wsl = isWsl(env, platform) } = {}) {
  if (env.CYBEDEFEND_BROWSER) return existsSync(env.CYBEDEFEND_BROWSER) ? env.CYBEDEFEND_BROWSER : null;
  const win = platform === 'win32';
  const at = join;
  if (platform === 'darwin') {
    const apps = ['Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser'].flatMap((n) => [`/Applications/${n}.app/Contents/MacOS/${n}`, join(env.HOME ?? '', 'Applications', `${n}.app`, 'Contents', 'MacOS', n)]);
    for (const file of apps) if (existsSync(file)) return file;
  }
  if (win) {
    for (const base of ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map((k) => envValue(env, k)).filter(Boolean)) {
      for (const parts of WINDOWS_BROWSERS) if (existsSync(at(base, ...parts))) return at(base, ...parts);
    }
  }
  const names = win ? ['chrome.exe', 'msedge.exe', 'brave.exe'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
  for (const dir of String(envValue(env, 'PATH') ?? '').split(win ? ';' : ':').filter(Boolean)) for (const n of names) if (existsSync(at(dir, n))) return at(dir, n);
  if (wsl) {
    for (const base of ['/mnt/c/Program Files', '/mnt/c/Program Files (x86)']) {
      for (const parts of WINDOWS_BROWSERS) if (existsSync(join(base, ...parts))) return join(base, ...parts);
    }
  }
  return null;
}

/** The Windows side of WSL: a Linux path as Windows reads it, and Windows' own temporary folder seen from Linux. */
function wslBridge() {
  const toWin = (p) => {
    const r = spawnSync('wslpath', ['-w', p], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const temp = spawnSync('cmd.exe', ['/d', '/c', 'echo %TEMP%'], { encoding: 'utf8', cwd: '/mnt/c' });
  const winTemp = temp.status === 0 ? temp.stdout.trim() : '';
  const linuxTemp = winTemp ? spawnSync('wslpath', ['-u', winTemp], { encoding: 'utf8' }).stdout?.trim() : '';
  return { toWin, linuxTemp: linuxTemp && existsSync(linuxTemp) ? linuxTemp : null };
}

/**
 * The same page as a PDF, to hand over: printed by a browser of the machine in headless mode,
 * with a profile of its own in a temporary folder, so the user's browser, its windows and its
 * session are never touched. Returns the PDF's path, or null when no browser is found or the
 * print fails: the page itself stays the report, and nothing here can fail a run.
 */
export function printPdf(htmlFile, { env = process.env, timeout = 20000 } = {}) {
  if (env.CYBEDEFEND_NO_PDF === '1' || env.CI) return null;
  const browser = findBrowser(env);
  if (!browser) return null;
  const pdf = htmlFile.replace(/\.html$/, '.pdf');
  // On WSL with the Windows browser, the page, the profile and the PDF go
  // through Windows' own temporary folder, then the PDF comes back here.
  const viaWindows = browser.startsWith('/mnt/') && isWsl(env);
  const bridge = viaWindows ? wslBridge() : null;
  if (viaWindows && !bridge?.linuxTemp) return null;
  let profile = null;
  try {
    rmSync(pdf, { force: true });
    profile = mkdtempSync(join(viaWindows ? bridge.linuxTemp : tmpdir(), 'cybedefend-pdf-'));
    // What is printed is a copy of the page with every folded part open: the PDF holds each proof, not the first three.
    const copy = join(profile, 'audit-report.html');
    writeFileSync(copy, printCopy(readFileSync(htmlFile, 'utf8')));
    let page = pathToFileURL(copy).href;
    let printed = pdf;
    let profileArg = profile;
    if (viaWindows) {
      printed = join(profile, 'audit-report.pdf');
      const winProfile = bridge.toWin(profile);
      if (!winProfile) return null;
      profileArg = `${winProfile}\\user-data`;
      page = `file:///${winProfile.split('\\').join('/')}/audit-report.html`;
    }
    const pdfArg = viaWindows ? `${bridge.toWin(profile)}\\audit-report.pdf` : pdf;
    const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', `--user-data-dir=${profileArg}`, '--no-pdf-header-footer', '--print-to-pdf-no-header', '--virtual-time-budget=5000', `--print-to-pdf=${pdfArg}`, page];
    // A browser run as root (a container) refuses its sandbox.
    if (process.getuid?.() === 0 && !viaWindows) args.unshift('--no-sandbox');
    spawnSync(browser, args, { stdio: 'ignore', timeout, windowsHide: true });
    if (viaWindows && existsSync(printed)) copyFileSync(printed, pdf);
    if (existsSync(pdf) && statSync(pdf).size > 1000 && readFileSync(pdf).subarray(0, 5).toString('latin1') === '%PDF-') return pdf;
    rmSync(pdf, { force: true });
    return null;
  } catch {
    return null;
  } finally {
    // The browser's last processes may still write in the profile as it closes: a few tries, then leave it to the system.
    try {
      if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch {
      /* a temporary folder left behind is no reason to fail */
    }
  }
}

#!/usr/bin/env node
// The HTTP side of /cybedefend: checks a SARIF file, imports it, waits for the
// scan, reads the policy verdict, starts a scan on the instance's own
// scanners, asks for a report. No dependency: Node 18 or later.
//
//   node cybedefend.mjs doctor
//   node cybedefend.mjs check <file.sarif> [--type <type>] [--audit [--map <map.md>]]
//   node cybedefend.mjs digest               what the scanners found, in a few dozen lines
//   node cybedefend.mjs board                what each tool of the scan did, one line per tool
//   node cybedefend.mjs progress [--of <n>] [--reviewed <n>] [--flaw "..." --where <file:line>] [--lead "..."]  the AI scanner's count, on the screen and on the live page
//   node cybedefend.mjs write-audit          the audit's findings, from .cybedefend/out/findings.json to audit.sarif
//   node cybedefend.mjs finish [--no-open] [--no-set-aside] [--accept-verdicts <digest>]  check, triage, send, merge, verdict, dashboard
//   node cybedefend.mjs assess --save <file> [--part <name>] | assess [--accept-verdicts <digest>]  save the triage you wrote; apply it alone
//   node cybedefend.mjs assess --check [--wait [seconds]] [--accept-verdicts <digest>]  the triage against this scan's findings, nothing sent
//   node cybedefend.mjs keep --reviewed a,b  bring back the last audit's findings in files this run did not review
//   node cybedefend.mjs keep --fixed <test>,<file:line>  after a fix: the last audit without the findings that were fixed
//   node cybedefend.mjs blocks               what blocks, short: the working list of /cybedefend fix
//   node cybedefend.mjs ignore <finding id> --reason "<the user's reason>"
//   node cybedefend.mjs show <file>          a file that holds a secret, the secret masked
//   node cybedefend.mjs import <file.sarif> --type <type> [--sbom <bom.cdx.json>] [--image <ref>] [--branch <b>] [--no-wait] [--add-to-run]
//   node cybedefend.mjs send [--out <dir>] [--branch <b>] [--image <ref>] [--add-to-run]
//   node cybedefend.mjs verdict [--run <run.json>]
//   node cybedefend.mjs instance-scan [--branch <b>]
//   node cybedefend.mjs report [--kind owasp|cwe] [--format pdf|html|json] [--branch <b>]
//
// Environment: CYBEDEFEND_URL (default http://localhost:8080, the address of
// the dashboard; the API is under /api) and CYBEDEFEND_TOKEN (a personal
// access token, cdp_...). The token is read here and sent only to
// CYBEDEFEND_URL; it is never printed, and no message quotes a header.
//
// Output: one JSON document on stdout, messages for the user on stderr.
// Exit: 0 done (verdict: SHIP), 1 verdict BLOCK, 2 a scan failed,
// 3 the instance cannot be used (not reachable, token missing or refused),
// 4 no project for this repository, 64 usage error.

import { readFileSync, writeFileSync, existsSync, statSync, lstatSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCANNED, openCommand } from './os.mjs';
import { insideRoot, readNote, realOr, remember, remembered, runGit, sha256, trustedRoot, TreeRefused, within } from './trust.mjs';
import { writeReport, printPdf, shownUpgrade, fromFilesNote } from './report.mjs';
import { runUsage, usageLine } from './usage.mjs';
import { startWatch, updateWatch, readWatch, setTool, setStep, addFeed, setFindings, sayFinding, counterLine, openWatch, pageFile, toolLabel, toolArea, whyNot, replayTimeline, replayWatch, replayFile, replaySource, keepReplay } from './watch.mjs';

export const IMPORT_TYPES = ['sast', 'iac', 'secret', 'cicd', 'sca', 'container'];
export const LIMITS = { uploadBytes: 52_428_800, decompressedBytes: 209_715_200, results: 100_000, runs: 20 };
const SCAN_TERMINAL = new Set(['completed', 'completed_degraded', 'failed', 'cancelled']);
const SCAN_TIMEOUT_MS = Number(process.env.CYBEDEFEND_SCAN_TIMEOUT_MS ?? 15 * 60_000);
const EVALUATION_TIMEOUT_MS = Number(process.env.CYBEDEFEND_EVALUATION_TIMEOUT_MS ?? 3 * 60_000);
const POLL_MS = Number(process.env.CYBEDEFEND_POLL_MS ?? 2_000);
const BUSY_RETRIES = 4;

class Exit extends Error {
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const say = (line) => process.stderr.write(`${line}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Arguments ──────────────────────────────────────────────────────────────

/** Flags that never take a value, so the word after them stays positional. */
const BOOLEAN_FLAGS = new Set(['policy', 'audit', 'add-to-run', 'check']);

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key.startsWith('no-')) flags[key.slice(3)] = false;
      else if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

// ─── The repository ─────────────────────────────────────────────────────────

// Every git command goes through runGit (trust.mjs): the repository's own configuration runs no program.
function git(args, cwd = process.cwd()) {
  return runGit(args, { cwd, encoding: 'utf8' }).trim();
}

/** The repository's root, with its .cybedefend tree checked before anything there is read or written (trust.mjs). */
export function repoRoot(cwd = process.cwd()) {
  try {
    return trustedRoot(cwd);
  } catch (e) {
    if (e instanceof TreeRefused) throw new Exit(3, e.message);
    throw new Exit(64, 'Not inside a git repository: run this from the repository you work on.');
  }
}

export function currentBranch(root, given) {
  if (typeof given === 'string' && given !== '') return given;
  let branch = '';
  try {
    branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  } catch {
    /* no commit yet */
  }
  if (!branch || branch === 'HEAD') throw new Exit(64, 'No branch checked out (detached HEAD): pass --branch <name>.');
  return branch;
}

/**
 * The project of this repository on this dashboard, from .cybedefend/config.json:
 * "appsec" (written by setup.mjs, with the dashboard's address) first, then the
 * top-level "projectId" (what create_project writes). The file comes with the
 * repository: when this machine knows another project for this repository on
 * this dashboard (setup.mjs created, found or was told it), nothing is sent and
 * the user is asked. The dashboard's address itself never comes from the file.
 */
export function projectId(root, inst, env = process.env) {
  const isId = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
  // The user's own choice, from the environment (a CI runner, where setup never ran): the file has no say.
  if (env.CYBEDEFEND_PROJECT_ID !== undefined) {
    if (!isId(env.CYBEDEFEND_PROJECT_ID)) throw new Exit(4, 'CYBEDEFEND_PROJECT_ID is not a project id.');
    return env.CYBEDEFEND_PROJECT_ID;
  }
  const known = inst ? readNote(root, 'project.json')?.[inst.url] : undefined;
  if (!isId(known)) {
    throw new Exit(4, `This machine has no record of this repository's project on ${inst?.url ?? 'this dashboard'}: run node scripts/setup.mjs from it (it finds or creates the project, and asks when .cybedefend/config.json names another one), or set CYBEDEFEND_PROJECT_ID. A project id read from the repository is never used on its own: the repository decides what that file says.`);
  }
  const file = join(root, '.cybedefend', 'config.json');
  let config = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, 'utf8')) ?? {};
    } catch {
      throw new Exit(4, '.cybedefend/config.json is not valid JSON.');
    }
  }
  // Both ids of the file name this project, or nothing is sent: the top-level one is what the MCP server reads.
  const named = [config.appsec?.url === inst.url ? config.appsec?.projectId : undefined, config.projectId].filter((v) => v !== undefined && v !== null);
  const other = named.find((v) => v !== known);
  if (other !== undefined) {
    throw new Exit(4, `.cybedefend/config.json names project ${other}, and this repository's project on this dashboard is ${known}. The file comes with the repository: it does not choose where the results go, and nothing was sent. Ask the user which project to use, then run setup.mjs again with --project <id>.`);
  }
  return known;
}

// ─── The SARIF check ────────────────────────────────────────────────────────

/**
 * The checks the instance makes before it imports, done before the upload so
 * a bad file costs no scan: size, JSON, SARIF 2.1.0, runs, results, tool
 * names, paths inside the repository. Returns { ok, problems, runs, results, tools, warnings }.
 */
export function checkSarif(buffer, { fileName = 'results.sarif', type, audit = false } = {}) {
  const problems = [];
  const warnings = [];
  const name = fileName.toLowerCase();
  if (!(name.endsWith('.sarif') || name.endsWith('.json') || name.endsWith('.sarif.gz'))) {
    problems.push('the file must end in .sarif, .json or .sarif.gz');
  }
  if (type !== undefined && !IMPORT_TYPES.includes(type)) problems.push(`the type must be one of ${IMPORT_TYPES.join(', ')}`);
  if (buffer.length === 0) problems.push('the file is empty');
  if (buffer.length > LIMITS.uploadBytes) problems.push(`the file is ${buffer.length} bytes, over the 50 MiB limit (gzip it as .sarif.gz)`);
  if (problems.length) return { ok: false, problems, warnings, runs: 0, results: 0, tools: [] };

  let text = buffer;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    if (!name.endsWith('.gz')) problems.push('the file is gzip: name it .sarif.gz');
    try {
      text = gunzipSync(buffer, { maxOutputLength: LIMITS.decompressedBytes });
    } catch {
      return { ok: false, problems: [...problems, 'the gzip file cannot be read, or is over 200 MiB once decompressed'], warnings, runs: 0, results: 0, tools: [] };
    }
  } else if (name.endsWith('.gz')) {
    problems.push('the file is named .gz but is not gzip');
  }
  let doc;
  try {
    let s = text.toString('utf8');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    doc = JSON.parse(s);
  } catch {
    return { ok: false, problems: [...problems, 'the file is not JSON'], warnings, runs: 0, results: 0, tools: [] };
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.runs)) {
    return { ok: false, problems: [...problems, 'the file is not a SARIF document (no runs array)'], warnings, runs: 0, results: 0, tools: [] };
  }
  if (doc.version !== '2.1.0') problems.push(`the SARIF version is ${JSON.stringify(doc.version)}, the import reads 2.1.0`);
  if (doc.runs.length === 0) problems.push('the file has no run');
  if (doc.runs.length > LIMITS.runs) problems.push(`the file has ${doc.runs.length} runs, over the limit of ${LIMITS.runs}`);

  const tools = [];
  let results = 0;
  let outside = 0;
  let suppressed = 0;
  doc.runs.forEach((run, i) => {
    const tool = run?.tool?.driver?.name;
    if (typeof tool !== 'string' || tool.trim() === '') problems.push(`run ${i + 1} has no tool.driver.name`);
    else if (!tools.includes(tool)) tools.push(tool);
    const list = Array.isArray(run?.results) ? run.results : [];
    results += list.length;
    for (const r of list) {
      if (Array.isArray(r?.suppressions) && r.suppressions.some((s) => s?.status === undefined || s?.status === 'accepted')) suppressed += 1;
      for (const loc of r?.locations ?? []) {
        const uri = loc?.physicalLocation?.artifactLocation?.uri;
        if (typeof uri !== 'string') continue;
        const path = uri.replace(/^file:\/\//, '');
        if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) outside += 1;
      }
    }
  });
  if (results > LIMITS.results) problems.push(`the file has ${results} results, over the limit of ${LIMITS.results}`);
  if (outside) warnings.push(`${outside} location(s) are absolute or leave the repository: the instance skips them (invalid_path)`);
  if (suppressed) warnings.push(`${suppressed} result(s) are suppressed in the file: the instance skips them, so their findings resolve`);
  if (type === 'container' && doc.runs.length > 1) warnings.push('a container import is the whole picture of one image');
  if (audit) problems.push(...checkAudit(doc));
  return { ok: problems.length === 0, problems, warnings, runs: doc.runs.length, results, tools };
}

export const AUDIT_TOOL = 'cybedefend-audit';

/**
 * What the audit's own file must hold, beyond SARIF (audit.md, step 4): one
 * run of cybedefend-audit, one rule per finding, audit/<kind>/<severity>/<finding>,
 * with a CWE and a security-severity in that band, and for each result a
 * location, a message, and a proof test when it says it is proven. A lead
 * that is not proven is a note. Returns the problems.
 *
 * The band is in the id because the dashboard keeps the severity of the
 * first result it saw for a rule id: a finding first seen as medium would
 * stay medium, and never block, after its score went up.
 */
export const severityBand = (score) => (score >= 9 ? 'critical' : score >= 7 ? 'high' : score >= 4 ? 'medium' : 'low');

export function checkAudit(doc) {
  const problems = [];
  const runs = Array.isArray(doc?.runs) ? doc.runs : [];
  if (runs.length !== 1) problems.push(`the audit file has ${runs.length} runs: it has one, of ${AUDIT_TOOL}`);
  runs.forEach((run, i) => {
    const at = runs.length > 1 ? `run ${i + 1}: ` : '';
    if (run?.tool?.driver?.name !== AUDIT_TOOL) problems.push(`${at}the tool name is ${JSON.stringify(run?.tool?.driver?.name)}, it must be ${AUDIT_TOOL}`);
    const rules = new Map((run?.tool?.driver?.rules ?? []).map((r) => [r?.id, r]));
    for (const [id, rule] of rules) {
      // One rule per finding, audit/<kind>/<severity>/<finding>; a file of an earlier version has one per kind and severity.
      const idParts = typeof id === 'string' ? /^audit\/[a-z0-9-]+\/(critical|high|medium|low)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/.exec(id) : null;
      if (!idParts) problems.push(`${at}rule ${JSON.stringify(id)}: the id is audit/<kind>/<severity>/<finding>, lower case, the severity one of critical, high, medium, low`);
      const title = rule?.shortDescription?.text;
      if (typeof title !== 'string' || title.trim().length < 10) problems.push(`${at}rule ${id}: shortDescription.text is the finding's title in the dashboard, a sentence that says what happens`);
      // The dashboard shows a rule's name, when it has one, instead of its short description.
      if (rule?.name !== undefined && rule.name !== title) problems.push(`${at}rule ${id}: leave out "name", the dashboard would show it as the title instead of the short description`);
      const tags = Array.isArray(rule?.properties?.tags) ? rule.properties.tags : [];
      if (!tags.some((t) => /^CWE-\d+$/.test(String(t)))) problems.push(`${at}rule ${id}: no CWE-<n> in properties.tags`);
      const sev = Number(rule?.properties?.['security-severity']);
      if (!(sev > 0 && sev <= 10)) problems.push(`${at}rule ${id}: properties.security-severity is a number from 0.1 to 10, as text`);
      else if (idParts && idParts[1] !== severityBand(sev)) problems.push(`${at}rule ${id}: security-severity ${sev} is ${severityBand(sev)}, so the id ends in /${severityBand(sev)}`);
    }
    let leads = 0;
    (Array.isArray(run?.results) ? run.results : []).forEach((r, j) => {
      const where = `${at}result ${j + 1}`;
      if (!rules.has(r?.ruleId)) problems.push(`${where}: its ruleId ${JSON.stringify(r?.ruleId)} is not a rule of the run`);
      if (typeof r?.message?.text !== 'string' || r.message.text.trim().length < 20) problems.push(`${where}: the message says which guarantee breaks, from which input`);
      const loc = r?.locations?.[0]?.physicalLocation;
      if (typeof loc?.artifactLocation?.uri !== 'string' || !(Number(loc?.region?.startLine) >= 1)) problems.push(`${where}: a file and a start line are needed`);
      const props = r?.properties ?? {};
      if (props.proven === true) {
        if (typeof props.proofTest !== 'string' || props.proofTest.trim() === '') problems.push(`${where}: proven, so properties.proofTest names the test`);
        if (r.level === 'note') problems.push(`${where}: proven, so its level is error or warning`);
        if (typeof props.fix !== 'string' || props.fix.trim().length < 10) problems.push(`${where}: proven, so properties.fix says in one sentence what to change in this code`);
      } else if (props.proven === false) {
        leads += 1;
        if (r.level !== 'note') problems.push(`${where}: not proven, so its level is note`);
        // The policies judge severity: a lead nobody proved must never block a deploy.
        const sev = Number(rules.get(r?.ruleId)?.properties?.['security-severity']);
        if (sev >= 4) problems.push(`${where}: not proven, so its rule is a low one of its own (audit/<kind>/low/<finding>, security-severity under 4): a lead must not block a deploy`);
      } else {
        problems.push(`${where}: properties.proven is true or false`);
      }
    });
    if (leads > 5) problems.push(`${at}${leads} leads not proven: keep the five strongest`);
    // The dashboard keeps one finding per rule and line: a second result there would vanish into the first.
    const seen = new Map();
    (Array.isArray(run?.results) ? run.results : []).forEach((r, j) => {
      const loc = r?.locations?.[0]?.physicalLocation;
      const key = `${r?.ruleId}|${loc?.artifactLocation?.uri}|${loc?.region?.startLine}`;
      if (seen.has(key)) problems.push(`${at}results ${seen.get(key)} and ${j + 1} are both ${r?.ruleId} at ${loc?.artifactLocation?.uri}:${loc?.region?.startLine}: the dashboard keeps one finding per rule and line. Point each at the line that shows it (the field it reads, the statement that uses it), or make them one finding`);
      else seen.set(key, j + 1);
    });
  });
  return problems;
}

// ─── The audit's findings, from a short list to the SARIF file ──────────────

/**
 * The kinds the audit names, each with the sentence that says the class of
 * flaw and its CWE. A finding has a title of its own (what happens in this
 * code); the kind gives it its CWE, its OWASP category and the class of flaw
 * its description ends on, the same in every project.
 */
export const KINDS = {
  // Rights
  'missing-authentication': ['A route answers a caller who has not signed in', 306],
  'missing-object-authorization': ['An object is read or changed without checking that the caller may use it', 639, 'API1:2023'],
  'missing-role-check': ['A privileged action is open to a caller without the role', 862, 'API5:2023'],
  'missing-tenant-filter': ["Shared data is read or changed without the caller's tenant in the query", 639, 'API1:2023'],
  'cross-tenant-reference': ['An object of one tenant can be attached to an object of another', 639, 'API1:2023'],
  'privilege-escalation': ['A caller can give themselves a role or a right nobody gave them', 269, 'API5:2023'],
  'rights-kept-after-removal': ['A right that was taken away keeps working', 285],
  'unprotected-alternate-path': ['The same action is served by a second path that skips the check', 288, 'API9:2023'],
  'self-approval': ['A request can be approved by the person who made it', 863],
  // Input trusted too early
  'mass-assignment': ['A field the caller must not set is taken from the request', 915, 'API3:2023'],
  'client-controlled-value': ['A value the server should decide is taken from the client', 807],
  'decision-on-client-word': ['A decision is made on what the caller says, with nothing checked', 807],
  'hidden-parameter-trusted': ['A parameter the interface never shows is trusted by the server', 472],
  'header-trusted': ['A header the caller controls is trusted for a decision or a link', 348],
  'third-party-data-trusted': ["Data from another service is used as if it were the code's own", 20, 'API10:2023'],
  'check-that-does-nothing': ['A security check exists in name and checks nothing', 693],
  'check-fails-open': ['A check lets the request through when it fails or cannot decide', 636],
  // Business logic
  'business-logic-bypass': ['A business constraint can be bypassed with a request that looks legal', 840],
  'unvalidated-amount': ['An amount is accepted without checking its sign, its range or what is available', 1284],
  'incorrect-calculation': ['A computation of money or rights gives a wrong result on values that look legal', 682],
  'inconsistent-data-accepted': ['Data that is valid in form and impossible in the business is accepted', 1288],
  'state-flow-bypass': ['A step of a flow can be skipped, replayed, or run with other values than the ones it validated', 841],
  'expiry-not-checked': ['Something that has expired is still accepted', 672],
  'missing-idempotency': ['The same request can be applied more than once', 837],
  'race-condition': ['A check and the action it protects are not atomic', 362],
  'usage-limit-not-enforced': ['A function can be used more times than its rule allows', 799, 'API6:2023'],
  'plan-limit-not-enforced': ['A plan or a quota is checked in the interface and not by the server', 602],
  'payment-not-verified': ['An order is marked paid without the payment being confirmed by its provider', 345],
  'unbounded-resource-use': ['A request can ask for an unbounded amount of work or data', 770, 'API4:2023'],
  // Identity and sessions
  'signature-not-verified': ['A signature or a token is accepted without being verified', 347, 'API2:2023'],
  'forgeable-session': ['A session or a token can be forged by the caller', 565, 'API2:2023'],
  'predictable-token': ['A token or an identifier can be guessed', 330, 'API2:2023'],
  'session-not-invalidated': ['A session or a token keeps working after it should have ended', 613, 'API2:2023'],
  'session-fixation': ['A session identifier set before sign-in is kept after it', 384],
  'second-factor-bypass': ['The second factor can be skipped', 304, 'API2:2023'],
  'third-party-sign-in-not-bound': ['A sign-in through another service accepts an answer it cannot tie to its own request', 352],
  'unverified-email-trusted': ['An e-mail address nobody verified gives access to an account or an organization', 287],
  'reset-without-proof': ['A credential can be changed without proof of identity', 640, 'API2:2023'],
  'weak-password-policy': ['Weak passwords are accepted', 521, 'API2:2023'],
  'no-attempt-limit': ['Sign-in or reset attempts are not limited', 307, 'API2:2023'],
  'account-enumeration': ['An answer tells which accounts exist', 204],
  'timing-leak': ['A secret is compared in a way that leaks it through time', 208],
  // Data that leaves
  'sensitive-data-exposure': ['A response returns data the caller may not see', 200, 'API3:2023'],
  'cache-shared-between-users': ['A response that holds private data is cached and served to another user', 524],
  'secret-in-logs': ['A secret or personal data is written to the logs', 532],
  'secret-in-url': ['A secret travels in a URL', 598],
  'verbose-error': ['An error returns the internals of the application to the caller', 209, 'API8:2023'],
  'password-stored-in-clear': ['A password is stored or compared in clear', 256],
  'weak-password-hash': ['A password is stored with a hash too fast to resist guessing', 916],
  'weak-cryptography': ['A broken or home-made algorithm protects a secret', 327],
  'cleartext-transport': ['Sensitive data is sent without encryption', 319],
  'committed-secret': ['A key or a password is committed in the repository', 798],
  // Dangerous calls
  'sql-injection': ['Input reaches an SQL statement', 89],
  'nosql-injection': ['Input reaches a database query as an operator', 943],
  'command-injection': ['Input reaches a shell command', 78],
  'code-injection': ['Input is run as code', 94],
  'template-injection': ['Input is rendered as a template', 1336],
  'path-traversal': ['Input chooses a file path', 22],
  'unrestricted-upload': ['A file is accepted without checking its type, its size or where it is stored', 434],
  'ssrf': ['Input chooses a URL the server fetches', 918, 'API7:2023'],
  'stored-xss': ['Input is rendered as HTML', 79],
  'reflected-xss': ['Input comes back in a page without encoding', 79],
  'header-injection': ['Input reaches a response header or an e-mail header', 93],
  'formula-injection': ['Input reaches a spreadsheet export as a formula', 1236],
  'open-redirect': ['Input chooses where the user is sent', 601],
  'unsafe-deserialization': ['Untrusted data is deserialized', 502],
  'xml-external-entity': ['An XML parser resolves external entities', 611],
  'prototype-pollution': ['Input sets properties on a prototype every object shares', 1321],
  'regex-denial-of-service': ['Input reaches a regular expression that can take exponential time', 1333],
  // Configuration in code
  'state-change-on-get': ['A request that changes state can be forged from another site', 352],
  'cross-origin-open-with-credentials': ["Any site may call the API with the user's cookies", 942, 'API8:2023'],
  'cookie-without-protection': ['A session cookie is sent without the flags that protect it', 614],
  'websocket-origin-not-checked': ['A WebSocket accepts a connection without checking who opens it', 1385],
  'debug-endpoint-exposed': ['A debug or internal endpoint is served', 489, 'API8:2023'],
  'insecure-default': ['A security setting falls back to an unsafe default when it is not set', 1188, 'API8:2023'],
  'missing-security-header': ['A security header or setting is missing or turned off', 693, 'API8:2023'],
  'no-audit-trail': ['A sensitive action leaves no trace of who did it', 778],
  'unhandled-input': ['An input makes the handler fail', 248],
  // Code that calls a model
  'prompt-injection': ['Text from outside reaches a prompt that decides an action', 1427],
  'model-output-trusted': ['The output of a model is used as a command, a query or a page with nothing checked', 1426],
  'tool-with-excess-rights': ['A tool given to a model can do more than its feature needs', 250],
  // The surfaces (surfaces/*.md): each page names the kinds of its own flaws.
  // AI agents
  'confused-deputy': ['An agent or a tool acts with its own rights where the user it acts for has fewer', 441],
  'action-not-bound-to-approval': ['An action runs with other arguments, another target or another user than the one asked for or approved', 863],
  'memory-poisoning': ["Outside content is saved in an agent's memory and later steers another user or another task", 1427],
  'context-shared-between-users': ['A conversation, a retrieval result or a model cache is shared between users or tenants', 668],
  'tool-peer-trusted': ["A tool server's names, descriptions or answers are trusted as identity or policy", 346],
  // Identity and HTTP
  'request-smuggling': ['Two components read the boundaries of one request differently', 444],
  'cache-poisoning': ['A value missing from the cache key changes a response the cache serves to others', 349],
  'token-not-bound': ['A token is accepted for another audience, issuer, client or account than the one it was issued for', 287, 'API2:2023'],
  'account-link-without-proof': ['An identity is linked to an existing account without proof that the account owner asked for it', 287, 'API2:2023'],
  'api-key-scope-not-enforced': ['An API key reaches more tenants, resources or actions than its record grants', 863],
  // Browser
  'dom-xss': ['Input reaches the page through the browser and runs as script', 79],
  'message-origin-not-checked': ['A message from another window is acted on without checking which origin sent it', 346],
  clickjacking: ['A page with a sensitive action can be framed and clicked through by another site', 1021],
  // Messaging and RPC
  'message-sender-not-verified': ['A message, an event or a webhook is acted on without checking who sent it', 345],
  'message-replay-accepted': ['A message already used, or older than the current state, is accepted again', 294],
  // Data and its copies
  'shared-key-between-tenants': ['A cache key, a file path or a unique name leaves out the tenant, so two tenants meet on it', 668],
  'export-beyond-rights': ['An export, a report or a backup holds data the caller may not read', 200],
  'restore-without-current-rights': ['A restore, an import or an undo brings back data or rights that current rules forbid', 285],
  'deleted-data-still-reachable': ['Data that was deleted or revoked can still be read or used through a copy', 459],
  'signed-link-overreach': ['A shared or signed link allows more objects, operations or time than it was issued for', 863],
  // Infrastructure and delivery
  'untrusted-code-in-privileged-workflow': ['A pipeline runs code from an untrusted contributor with secrets or write rights', 829],
  'service-identity-with-excess-rights': ['A workload or service identity can do more than its feature needs', 250],
  'code-fetched-without-integrity-check': ['Code or a dependency that ships is fetched from a source that can change, with no pinned version or checksum', 494],
  // Native, mobile and local
  'local-caller-not-verified': ['A local service, socket or exported component acts for a caller it never identified', 923],
  'deep-link-trusted': ['A deep link or a custom scheme starts a sensitive action with nothing checked', 939],
  'native-bridge-exposed': ['A web view gives the pages it loads native functions they should not reach', 749],
  'memory-corruption': ['Input makes the code read or write outside the memory it owns', 119],
  'integer-overflow': ['A size, an index or an amount wraps around or is truncated', 190],
};

/**
 * OWASP Top 10:2021, by CWE: the category each CWE of the list above belongs to, in OWASP's own
 * mapping (the "List of Mapped CWEs" of each category page, https://owasp.org/Top10/). A CWE that
 * OWASP maps to no category has no entry, and its findings carry no OWASP tag: none is guessed.
 */
export const OWASP_2021 = {
  22: 'A01', 200: 'A01', 285: 'A01', 352: 'A01', 441: 'A01', 601: 'A01', 639: 'A01', 668: 'A01', 862: 'A01', 863: 'A01',
  319: 'A02', 327: 'A02', 330: 'A02', 347: 'A02', 916: 'A02',
  20: 'A03', 78: 'A03', 79: 'A03', 89: 'A03', 93: 'A03', 94: 'A03',
  209: 'A04', 256: 'A04', 269: 'A04', 434: 'A04', 444: 'A04', 472: 'A04', 598: 'A04', 602: 'A04', 799: 'A04', 807: 'A04', 840: 'A04', 841: 'A04', 1021: 'A04',
  611: 'A05', 614: 'A05', 942: 'A05',
  287: 'A07', 288: 'A07', 294: 'A07', 304: 'A07', 306: 'A07', 307: 'A07', 346: 'A07', 384: 'A07', 521: 'A07', 613: 'A07', 640: 'A07', 798: 'A07',
  345: 'A08', 494: 'A08', 502: 'A08', 565: 'A08', 829: 'A08', 915: 'A08',
  532: 'A09', 778: 'A09',
  918: 'A10',
};

/** The tags of an audit rule: its CWE, then where OWASP files it (Top 10:2021 by CWE, API Security Top 10:2023 by kind). */
export function auditTags(kind, cwe) {
  const tags = ['security', `CWE-${cwe}`];
  if (OWASP_2021[cwe]) tags.push(`OWASP-${OWASP_2021[cwe]}:2021`);
  if (KINDS[kind]?.[2]) tags.push(`OWASP-${KINDS[kind][2]}`);
  return tags;
}

/** A text cut to a length at the end of a sentence, else of a word with "…": never in the middle of a word. */
export function fit(text, max) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if (stop >= max * 0.4) return head.slice(0, stop + 1);
  const cut = head.slice(0, max - 1);
  // The cut falls between two words: keep the last one whole.
  const word = t[max - 1] === ' ' ? cut.length : cut.lastIndexOf(' ');
  return `${(word > 0 ? cut.slice(0, word) : cut).replace(/[\s,;:]+$/, '')}…`;
}

/** The name of a proof test, without its file: "file > name", "file::name". */
const testNameOf = (proofTest) => String(proofTest ?? '').split(' > ').pop().split('::').pop().trim();
/** The file of a proof test, when its name carries one. */
const testFileOf = (proofTest) => /^(.+?)(?: > |::)/.exec(String(proofTest ?? ''))?.[1]?.trim() ?? '';
const slugOf = (text, max = 60) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '');
const withStop = (text) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * What names a finding in its rule id, the same from one run to the next:
 * its proof test, which stays in the repository until the fix, with its kind
 * and its file; for a lead, its entry point or its file. Never its line, its
 * title or its message: they change, and the dashboard would take the finding
 * for a new one.
 */
export function auditRuleKey({ kind, file, proofTest, entryPoint, lead, more = '' }) {
  const words = lead ? slugOf(entryPoint || file) : slugOf(testNameOf(proofTest).replace(/^test[_\s-]*security[_\s-]*/i, ''));
  const hash = createHash('sha256').update([kind, file, lead ? entryPoint ?? '' : proofTest, more].join('\n')).digest('hex').slice(0, 6);
  return `${words || 'finding'}-${hash}`;
}

/** "Why is it a vulnerability" in the dashboard, in Markdown: what happens, what is at stake, how it is done, the proof, the class of flaw. */
function auditDescription({ message, impact, steps, attack, guarantee, file, entryPoint, lead, proofTest, challenge, kindSentence, cwe }) {
  const parts = [message];
  if (impact) parts.push(`**What is at stake.** ${withStop(impact)}`);
  if (steps.length > 1) parts.push(`**How it is done.**\n\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`);
  else if (attack) parts.push(`**How it is done.** ${withStop(attack)}`);
  if (guarantee) parts.push(`**The guarantee that breaks.** ${withStop(guarantee)}`);
  parts.push(`**Where.** \`${file}\`${entryPoint ? `, reached through \`${entryPoint}\`` : ''}.`);
  if (lead) parts.push('**Status.** A lead of the AI scanner: no test shows it yet, so it is sent as a note and cannot block a deploy.');
  else {
    const testFile = testFileOf(proofTest);
    parts.push(`**The proof.** The test \`${testNameOf(proofTest)}\`${testFile ? ` in \`${testFile}\`` : ''} reproduces it: it fails on this flaw today and passes once the flaw is fixed.${challenge ? ' A second agent, which did not write this proof, tried to break it and could not.' : ''}`);
  }
  parts.push(`**Class of flaw.** ${kindSentence ? `${withStop(kindSentence)} ` : ''}[CWE-${cwe}](https://cwe.mitre.org/data/definitions/${cwe}.html).`);
  return parts.join('\n\n').slice(0, 10_000);
}

/** What a lead's message ends on: the fact that blocked the proof, and the check that would settle it. */
function leadParts(message) {
  const said = String(message ?? '').replace(/\s+/g, ' ').trim();
  return { missing: /Not proven:\s*(.+?)(?=\s*To settle it:|$)/i.exec(said)?.[1]?.trim() || '', settle: /To settle it:\s*(.+)$/i.exec(said)?.[1]?.trim() || '' };
}

/**
 * What a lead carries next to its exploitability in the dashboard, in place
 * of the words every finding nobody analysed gets: that it is a lead, the one
 * fact that is missing and the check that would settle it (1,000 characters).
 */
export function leadWords(message) {
  const { missing, settle } = leadParts(message);
  return fit(["A lead of the coding agent's review (/cybedefend): no test shows it yet, so it cannot block a deploy.", missing ? `What is missing: ${withStop(missing)}` : '', settle ? `To settle it: ${withStop(settle)}` : 'To settle it: write the test that shows it, or read the path that rules it out.'].filter(Boolean).join(' '), 1000);
}

/** "How to prevent" in the dashboard, in Markdown: the fix in this code, how to check it, how to keep the flaw away. */
function auditHelp({ lead, fix, proofTest, prevent, message }) {
  if (lead) {
    // A lead's message ends on the fact that blocked the proof and on the check that would settle it ("Not proven: ... To settle it: ..."):
    // each goes under its name, so the page of a lead is its own and no two leads read the same.
    const sentence = (t) => withStop(t.trim().replace(/^[a-z]/, (c) => c.toUpperCase()));
    const { missing, settle } = leadParts(message);
    return [
      missing?.trim() ? `**What is missing.** ${sentence(missing)}` : '',
      settle?.trim() ? `**To settle it.** ${sentence(settle)}` : '**To settle it.** Write the test that shows it, or read the path that rules it out: the description ends on the one fact that is missing.',
      'Until a test shows it, it stays a note and cannot block a deploy.',
    ].filter(Boolean).join('\n\n').slice(0, 20_000);
  }
  const testFile = testFileOf(proofTest);
  const parts = [`**The fix in this code.** ${withStop(fix)}`, `**How to check it.** Run the test \`${testNameOf(proofTest)}\`${testFile ? ` (\`${testFile}\`)` : ''}: it passes once the fix is in. Keep it in the suite, so the flaw cannot come back unseen.`];
  if (prevent) parts.push(`**To keep it from coming back.** ${withStop(prevent)}`);
  return parts.join('\n\n').slice(0, 20_000);
}

const plain = (markdown) => markdown.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/**
 * What the history of a proven finding says in the dashboard: the comment a
 * person reads (512 characters) and the reason next to "proven" (1,000).
 */
export function proofWords({ title, message, impact, fix, tests }) {
  const named = tests.map((t) => `"${t}"`);
  const many = tests.length > 1;
  const proof = many ? `The tests ${named.join(' and ')} reproduce it: they fail today and pass once it is fixed.` : `The test ${named[0]} reproduces it: it fails today and passes once it is fixed.`;
  const end = fix ? ` Fix: ${withStop(fit(fix, 220))}` : '';
  const head = `Found by the AI scanner and proven by a test. ${withStop(fit(title || message, 130))}`;
  const comment = `${fit(`${head} ${proof}`, 512 - end.length)}${end}`;
  const reason = fit(`Proven by ${many ? `the tests ${named.join(' and ')}, which fail` : `the test ${named[0]}, which fails`} on this flaw today. ${withStop(impact || message)}`, 1000);
  return { comment, reason };
}

/**
 * The audit's SARIF file from the short list the agent writes (audit.md,
 * step 4): { findings: [{ kind, score, where, title, message, attack, impact,
 * proofTest, fix, guarantee, entryPoint, prevent }, { kind, lead: true, where,
 * title, message }] }. One rule per finding: the dashboard shows a rule's
 * title, description and help on the finding's page, and never the result's
 * own message, so each finding carries its words in a rule of its own.
 * Returns { doc, problems }; with a problem, the doc is not to be written.
 */
export function auditFromFindings(input) {
  const list = Array.isArray(input) ? input : input?.findings;
  const problems = [];
  if (!Array.isArray(list)) return { doc: null, problems: ['the file holds { "findings": [ ... ] }'] };
  const rules = new Map();
  const results = [];
  list.forEach((f, i) => {
    const at = `finding ${i + 1}`;
    const text = (v) => (typeof v === 'string' ? v.trim() : '');
    const kind = text(f?.kind);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(kind)) return problems.push(`${at}: "kind" names the flaw in lower case with hyphens (missing-object-authorization)`);
    const known = KINDS[kind];
    const cwe = Number(String(f.cwe ?? known?.[1] ?? '').replace(/^CWE-/i, ''));
    if (!(cwe >= 1)) return problems.push(`${at}: "${kind}" is not one of the kinds of audit.md, so it needs its "cwe" (a number)`);
    const where = /^(.+):(\d+)$/.exec(text(f.where));
    if (!where || Number(where[2]) < 1) return problems.push(`${at}: "where" is file:line, the file relative to the repository root`);
    const file = where[1].replace(/^\.\//, '');
    // The title a person reads in the dashboard and on the audit page: this finding's own.
    const title = text(f.title).replace(/\.$/, '');
    const titleRule = '"title" is this finding\'s own title, in the words of the person it hurts: who can do what, to whom or to what ("A member of one organization can export another organization\'s project")';
    if (title.length < 15) return problems.push(`${at}: ${titleRule}`);
    if (title.length > 110) return problems.push(`${at}: ${titleRule}. It is ${title.length} characters long: 110 at most, the rest goes in "message"`);
    if (known && title.toLowerCase() === known[0].toLowerCase()) return problems.push(`${at}: ${titleRule}. This one is the sentence of the kind, true for any repository: say what happens in this finding`);
    if (/\S\.[A-Za-z0-9]{1,5}:\d+/.test(title) || /^audit\//.test(title) || title.toLowerCase().startsWith(kind)) return problems.push(`${at}: ${titleRule}. It names what happens, never a file, a line or a rule`);
    if (text(f.message).length < 20) return problems.push(`${at}: "message" says which guarantee breaks, from which input, and what it costs`);
    const lead = f.lead === true || f.proven === false;
    const score = f.score === undefined && lead ? 3 : Number(f.score);
    if (!(score > 0 && score <= 10)) return problems.push(`${at}: "score" is a number from 0.1 to 10 (9 and above critical, 7 high, 4 medium)`);
    if (lead && score >= 4) return problems.push(`${at}: a lead nobody proved has a score under 4, so that it cannot block a deploy`);
    if (!lead && !text(f.proofTest)) return problems.push(`${at}: proven, so "proofTest" names the test that fails (or "lead": true when no test shows it)`);
    if (!lead && text(f.fix).length < 10) return problems.push(`${at}: proven, so "fix" says in one sentence what to change in this code`);
    // How it is done, step by step, and what it costs: what a person needs to understand the finding without the code open.
    const steps = Array.isArray(f.attack) ? f.attack.map(text).filter(Boolean) : [];
    const attack = steps.length ? steps.join(' ') : text(f.attack);
    if (!lead && attack.length < 40) return problems.push(`${at}: proven, so "attack" says how it is done, step by step as the test does it: who signs in, which request with which values, what comes back (a list of steps, or a few sentences)`);
    const impact = text(f.impact);
    if (!lead && impact.length < 20) return problems.push(`${at}: proven, so "impact" says what the caller gets and who pays for it, in a sentence ("Every customer's project data can be downloaded by any account")`);
    // The second agent's challenge (audit.md, step 3): "holds" once it tried to break the proof and could not.
    const challenge = lead ? '' : text(f.challenge);
    if (challenge && challenge !== 'holds') return problems.push(`${at}: "challenge" is "holds" once the second agent tried to break the proof and could not. A proof it broke is corrected and challenged again, or the finding goes back to a lead ("lead": true)`);
    const proofTest = lead ? '' : text(f.proofTest);
    const entryPoint = text(f.entryPoint);
    const band = severityBand(score);
    const keyOf = (more) => `audit/${kind}/${band}/${auditRuleKey({ kind, file, proofTest, entryPoint, lead, more })}`;
    let id = keyOf('');
    // Two leads of one kind in one file, with no entry point to tell them apart: the title does.
    if (lead && rules.has(id) && rules.get(id).shortDescription.text !== title) id = keyOf(title);
    if (!rules.has(id)) {
      const description = auditDescription({ message: text(f.message), impact, steps, attack, guarantee: text(f.guarantee), file, entryPoint, lead, proofTest, challenge: challenge === 'holds', kindSentence: known?.[0], cwe });
      const help = auditHelp({ lead, fix: text(f.fix), proofTest, prevent: text(f.prevent), message: text(f.message) });
      rules.set(id, {
        id,
        shortDescription: { text: title },
        fullDescription: { text: description, markdown: description },
        help: { text: plain(help), markdown: help },
        helpUri: `https://cwe.mitre.org/data/definitions/${cwe}.html`,
        properties: { tags: auditTags(kind, cwe), 'security-severity': String(score) },
      });
    }
    const rule = rules.get(id);
    // Two places of one flaw, shown by one test, share its rule: it carries the highest score.
    if (score > Number(rule.properties['security-severity'])) rule.properties['security-severity'] = String(score);
    const properties = lead ? { proven: false, title } : { proven: true, title, proofTest, fix: text(f.fix), score, attack, impact };
    if (challenge) properties.challenge = challenge;
    if (text(f.guarantee)) properties.guarantee = text(f.guarantee);
    if (entryPoint) properties.entryPoint = entryPoint;
    if (!lead && text(f.prevent)) properties.prevent = text(f.prevent);
    results.push({
      ruleId: id,
      level: lead ? 'note' : score >= 7 ? 'error' : 'warning',
      message: { text: text(f.message) },
      locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: Number(where[2]) } } }],
      properties,
    });
  });
  const doc = {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{ tool: { driver: { name: AUDIT_TOOL, informationUri: 'https://github.com/CybeDefend/cybedefend', rules: [...rules.values()] } }, results }],
  };
  return { doc, problems };
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

/**
 * The dashboard and the token: CYBEDEFEND_URL and CYBEDEFEND_TOKEN when set,
 * else what setup.mjs saved in ~/.cybedefend/appsec/credentials.json, so the
 * user never exports anything. A saved token goes only to its own dashboard.
 */
export function instance(env = process.env) {
  let url = env.CYBEDEFEND_URL ? env.CYBEDEFEND_URL.replace(/\/+$/, '') : '';
  let token = env.CYBEDEFEND_TOKEN || '';
  if (!token) {
    const file = join(env.CYBEDEFEND_APPSEC_HOME || join(homedir(), '.cybedefend', 'appsec'), 'credentials.json');
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      const savedUrl = String(saved.url ?? '').replace(/\/+$/, '');
      if (!url || url === savedUrl) {
        url = savedUrl;
        token = saved.token ?? '';
      }
    } catch {
      /* nothing saved yet */
    }
  }
  url = url || 'http://localhost:8080';
  return { url, api: `${url}/api`, token };
}

// The dashboard allows each user 300 requests a minute, and blocks one who
// goes over for a minute, then two, then four (gateway, throttler.guard.ts).
// A large audit makes that many calls by itself, and so do two repositories
// checked at once. So every call is counted, across the processes of this
// machine, in a small file next to the credentials, and waits its turn when
// the minute is full; and a refusal (429) is waited out, once.
const REQUESTS_PER_MINUTE = Number(process.env.CYBEDEFEND_REQUESTS_PER_MINUTE ?? 240);
const PACE_FILE = join(process.env.CYBEDEFEND_APPSEC_HOME || join(homedir(), '.cybedefend', 'appsec'), '.requests');
let paceSaid = false;

async function pace() {
  if (!(REQUESTS_PER_MINUTE > 0)) return;
  for (let turn = 0; turn < 4; turn += 1) {
    const now = Date.now();
    let stamps = [];
    try {
      stamps = readFileSync(PACE_FILE, 'utf8').split('\n').map(Number).filter((t) => t > now - 60_000 && t <= now);
    } catch {
      /* no file yet */
    }
    if (stamps.length < REQUESTS_PER_MINUTE) {
      try {
        mkdirSync(dirname(PACE_FILE), { recursive: true });
        writeFileSync(PACE_FILE, [...stamps, now].join('\n'), { mode: 0o600 });
      } catch {
        /* counting is a courtesy: never a reason to fail */
      }
      return;
    }
    const wait = Math.max(1_000, stamps[stamps.length - REQUESTS_PER_MINUTE] + 60_500 - now);
    if (!paceSaid) say(`  … the dashboard allows 300 requests a minute: waiting ${Math.ceil(wait / 1000)} s before the next ones`);
    paceSaid = true;
    await sleep(wait);
  }
}

async function call(inst, method, path, { json, form, timeoutMs = 60_000 } = {}) {
  if (!inst.token) throw new Exit(3, 'No token for the dashboard yet: run node scripts/setup.mjs, which sets up the dashboard and the token.');
  const headers = { authorization: `Bearer ${inst.token}` };
  let body;
  if (json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) body = form;
  let res;
  for (let attempt = 0; ; attempt += 1) {
    await pace();
    try {
      res = await fetch(`${inst.api}${path}`, { method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Exit(3, `The instance does not answer at ${inst.url}. Is it running? (docker compose ps, in the deploy folder)`);
    }
    if (res.status !== 429) break;
    await res.text().catch(() => '');
    const seconds = Math.ceil(Number(res.headers.get('retry-after')) || 60);
    // A form body cannot be sent twice, and a long block is the user's to wait out.
    if (attempt >= 1 || seconds > 150 || form) throw new Exit(3, `The dashboard limits requests (300 a minute for each user) and asks to wait ${seconds > 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} s`}. Nothing is lost: run the same command again after that.`);
    say(`  … the dashboard asks to wait ${seconds} s (too many requests in a minute): waiting, then going on`);
    await sleep((seconds + 1) * 1000);
  }
  const text = await res.text();
  let data;
  try {
    data = text === '' ? undefined : JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (res.status === 401) throw new Exit(3, 'The instance refused the token (401): it is wrong, expired or revoked. Create a new one in the dashboard.');
  if (res.status === 403) throw new Exit(3, 'The token has no right on this project (403). Check the project in .cybedefend/config.json and your team.');
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

const codeOf = (res) => (res.data && typeof res.data === 'object' && typeof res.data.code === 'string' ? res.data.code : undefined);

/** Waits for a scan to end. Returns the scan's last answer. */
export async function waitScan(inst, project, scanId, { timeoutMs = SCAN_TIMEOUT_MS, pollMs = POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const res = await call(inst, 'GET', `/project/${project}/scan/${scanId}`);
    if (res.status !== 200) throw new Exit(3, `Reading scan ${scanId} answered HTTP ${res.status}.`);
    last = res.data;
    if (SCAN_TERMINAL.has(last?.state)) return last;
    await sleep(pollMs);
  }
  throw new Exit(2, `Scan ${scanId} is still ${last?.state ?? 'unknown'} after ${Math.round(timeoutMs / 60000)} min.`, { scanId, state: last?.state });
}

// ─── import ─────────────────────────────────────────────────────────────────

export async function importFile(inst, { root, project, file, type, sbom, image, branch, wait = true, pollMs }) {
  if (!IMPORT_TYPES.includes(type)) throw new Exit(64, `--type is one of ${IMPORT_TYPES.join(', ')}.`);
  if (type === 'container' && !image) throw new Exit(64, 'A container import needs --image <the image reference>.');
  if (type !== 'container' && image) throw new Exit(64, '--image goes only with --type container.');
  if (sbom && type !== 'sca') throw new Exit(64, '--sbom goes only with --type sca.');
  const path = resolve(root, file);
  if (!existsSync(path)) throw new Exit(64, `No file at ${file}.`);
  const buffer = readFileSync(path);
  const check = checkSarif(buffer, { fileName: basename(path), type });
  if (!check.ok) throw new Exit(64, `The file cannot be imported: ${check.problems.join('; ')}.`, { check });
  for (const w of check.warnings) say(`warning: ${w}`);

  const form = new FormData();
  const fileName = basename(path).toLowerCase().endsWith('.gz') ? 'results.sarif.gz' : basename(path).toLowerCase().endsWith('.json') ? 'results.json' : 'results.sarif';
  form.append('file', new Blob([buffer]), fileName);
  form.append('type', type);
  form.append('branch', branch);
  form.append('format', 'sarif');
  if (image) form.append('image', image);
  if (sbom) {
    const sbomPath = resolve(root, sbom);
    form.append('sbom', new Blob([readFileSync(sbomPath)]), sbomPath.endsWith('.gz') ? 'bom.json.gz' : 'bom.json');
  }
  try {
    const head = git(['rev-parse', 'HEAD'], root);
    if (/^[0-9a-f]{40}$/.test(head)) form.append('commit', head);
  } catch {
    /* no commit yet */
  }

  let res;
  for (let attempt = 0; ; attempt += 1) {
    res = await call(inst, 'POST', `/project/${project}/scan/import/start`, { form, timeoutMs: 300_000 });
    if (res.status === 503 && codeOf(res) === 'IMPORT_BUSY' && attempt < BUSY_RETRIES) {
      const waitS = Math.min(Number(res.retryAfter) || 15, 60);
      say(`The instance is busy with other imports: retrying in ${waitS} s.`);
      await sleep(waitS * 1000);
      continue;
    }
    break;
  }
  if (res.status === 404) throw new Exit(3, 'This instance has no import route (HTTP 404). The SARIF import is a Community Edition feature: on CybeDefend Cloud, use instance-scan.');
  if (res.status !== 202 || !res.data?.scanId) {
    const code = codeOf(res);
    throw new Exit(code === 'IMPORT_TYPE_NOT_AVAILABLE' ? 3 : 2, `The import was refused: HTTP ${res.status}${code ? ` ${code}` : ''}.`, { code });
  }
  const scanId = res.data.scanId;
  if (!wait) return { scanId, state: 'queued', type, tools: check.tools, results: check.results };
  const scan = await waitScan(inst, project, scanId, { pollMs });
  return {
    scanId,
    type,
    state: scan.state,
    tools: check.tools,
    results: check.results,
    detected: scan.vulnerabilityDetected,
    errorMessage: scan.errorMessage,
    errorCode: scan.errorCode,
  };
}

// ─── send: every file of a scan.mjs run ──────────────────────────────────────

export function readManifest(file) {
  if (!existsSync(file)) throw new Exit(64, `No manifest at ${file}: run scan.mjs first.`);
  const [header, ...rows] = readFileSync(file, 'utf8').trim().split('\n');
  const cols = header.split('\t');
  return rows.filter(Boolean).map((line) => Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v])));
}

export async function sendRun(inst, { root, project, out, branch, image, pollMs, addToRun = false }) {
  const entries = readManifest(join(out, 'manifest.tsv'));
  const sbom = entries.find((e) => e.type === 'sbom' && e.status === 'ok');
  const scans = [];
  for (const e of entries) {
    // The SBOM goes with the sca import; a context file (the attack surface
    // map, a call graph) is for the agent and never leaves the machine.
    if (e.type === 'sbom' || e.type === 'context') continue;
    const tier = e.tier ?? 'core';
    if (e.status !== 'ok') {
      scans.push({ scanner: e.name, type: e.type, tier, state: e.status, detail: e.detail });
      continue;
    }
    say(`${e.name}: sending as ${e.type}`);
    const r = await importFile(inst, {
      root,
      project,
      file: e.file,
      type: e.type,
      sbom: e.type === 'sca' && sbom ? sbom.file : undefined,
      image: e.type === 'container' ? image : undefined,
      branch,
      pollMs,
    });
    say(`${e.name}: ${['failed', 'cancelled'].includes(r.state) ? 'not imported' : r.state}${r.errorMessage ? ` (${r.errorMessage})` : ''}`);
    scans.push({ scanner: e.name, tier, ...r });
  }
  let run = { projectId: project, branch, at: new Date().toISOString(), scans };
  const runFile = join(out, 'run.json');
  if (addToRun && existsSync(runFile)) {
    // After an instance-scan: the tools run here join the cluster's run.
    const earlier = JSON.parse(readFileSync(runFile, 'utf8'));
    const names = new Set(scans.map((x) => x.scanner));
    run = { ...earlier, scans: [...(earlier.scans ?? []).filter((x) => !names.has(x.scanner)), ...scans] };
  }
  writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
  return run;
}

// ─── verdict: the policies' answer for the scans of a run ───────────────────

/** How long a scan may stay without an evaluation before we take it that no policy applies. */
const NO_POLICY_AFTER_MS = Number(process.env.CYBEDEFEND_NO_POLICY_AFTER_MS ?? 20_000);

async function evaluation(inst, project, scanId, { timeoutMs = EVALUATION_TIMEOUT_MS, pollMs = POLL_MS } = {}) {
  const started = Date.now();
  for (;;) {
    const res = await call(inst, 'GET', `/projects/${project}/scans/${scanId}/evaluation-status`);
    if (res.status !== 200) return { status: 'UNAVAILABLE', http: res.status };
    const s = res.data ?? {};
    if (s.status === 'COMPLETED' || s.status === 'FAILED') return s;
    // No evaluation a while after the scan ended: no policy applies to this project.
    if (s.hasEvaluation === false && Date.now() - started > NO_POLICY_AFTER_MS) return { ...s, status: 'NOT_STARTED' };
    if (Date.now() - started > timeoutMs) return { ...s, status: 'TIMEOUT' };
    await sleep(pollMs);
  }
}

export async function verdict(inst, { project, run, pollMs }) {
  // Each scan's evaluation covers the whole branch as it stood when that scan
  // ended, and stays so: an early scan of the run still sees what a later
  // import resolved. So the last evaluation of the run decides. "compliant"
  // is false on a mere warning: what blocks is the blocking count and the
  // BLOCK violations.
  const byRule = new Map();
  const fallback = [];
  let warnings = 0;
  const unknown = [];
  const done = run.scans.filter((scan) => scan.scanId && ['completed', 'completed_degraded'].includes(scan.state));
  for (const scan of [...done].reverse()) {
    const ev = await evaluation(inst, project, scan.scanId, { pollMs });
    if (ev.status === 'NOT_STARTED') continue; // no policy for this project
    if (ev.status !== 'COMPLETED') {
      unknown.push({ scanner: scan.scanner, status: ev.status });
      break;
    }
    const comp = await call(inst, 'GET', `/projects/${project}/scans/${scan.scanId}/compliance`);
    if (comp.status !== 200) {
      unknown.push({ scanner: scan.scanner, status: `HTTP ${comp.status}` });
      break;
    }
    // The Community Edition answers { status, result: { compliant, blockingViolationsCount, warningViolationsCount, ... } }.
    const result = comp.data?.result ?? comp.data ?? {};
    warnings = Number(result.warningViolationsCount ?? result.warningCount ?? 0);
    const blockingCount = Number(result.blockingViolationsCount ?? (result.compliant === false ? NaN : 0));
    const vio = blockingCount === 0 ? { data: {} } : await call(inst, 'GET', `/projects/${project}/scans/${scan.scanId}/violations`);
    const list = Array.isArray(vio.data?.violations) ? vio.data.violations : [];
    for (const v of list.filter((x) => x.actionTaken === 'BLOCK')) {
      const rule = v.rule?.name ?? v.rule?.id ?? 'a blocking rule';
      // The group is the rule: its findings come from every scanner, each with its own type.
      const entry = byRule.get(rule) ?? { rule, findings: new Map() };
      for (const f of v.affectedVulnerabilities ?? []) {
        entry.findings.set(f.id, { id: f.id, name: f.name, severity: f.severity, type: f.vulnerabilityType, file: f.filePath ?? f.path, line: f.startLine ?? f.vulnerableStartLine });
      }
      byRule.set(rule, entry);
    }
    // Blocking, but no BLOCK violation listed: keep the reason the evaluation gives.
    if (blockingCount !== 0 && !byRule.size) {
      const reasons = result.blockingReasons ?? comp.data?.blockingReasons ?? [];
      for (const reason of reasons) fallback.push({ scanner: scan.scanner, type: scan.type, rule: reason.ruleName, message: reason.message, findings: [] });
      if (!reasons.length) fallback.push({ scanner: scan.scanner, type: scan.type, rule: 'a blocking rule', message: `${Number.isNaN(blockingCount) ? 'some' : blockingCount} blocking violation(s)`, findings: [] });
    }
    break; // the last evaluation of the run decides
  }
  const blocking = byRule.size ? [...byRule.values()].map((b) => ({ ...b, findings: [...b.findings.values()] })) : fallback.slice(0, 1);
  const notDone = run.scans.filter((s) => !['completed', 'completed_degraded', 'skipped'].includes(s.state));
  // A core scanner or the audit that did not go through leaves a blind spot
  // the policies cannot see: no SHIP. A deep tool that failed is said, and
  // does not block: the core scanners still covered its ground.
  const failed = notDone.filter((s) => s.tier !== 'deep');
  const incomplete = notDone.filter((s) => s.tier === 'deep');
  const ship = blocking.length === 0 && failed.length === 0 && unknown.length === 0;
  return { verdict: ship ? 'SHIP' : 'BLOCK', blocking, warnings, failedScans: failed, incomplete, unknown };
}

// ─── instance-scan: the instance runs its own scanners ──────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A ZIP archive (stored, no compression) of the given files: [{ name, data }]. */
export function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** The working tree as git sees it: tracked and new files, without the ignored ones or .cybedefend/out. */
export function workingTreeFiles(root) {
  const out = runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  return out
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((p) => !p.startsWith('.cybedefend/out/'))
    .filter((p) => {
      try {
        // lstat: a symbolic link is skipped, it can point anywhere on the machine (a key in the user's home).
        return lstatSync(join(root, p)).isFile() && insideRoot(root, p) !== null;
      } catch {
        return false; // deleted in the working tree
      }
    });
}

/**
 * The repository as the archive the dashboard scans: each file read from its
 * real path, which stays in the repository (workingTreeFiles).
 */
export function repositoryArchive(root, { withList = false } = {}) {
  const files = workingTreeFiles(root).flatMap((p) => {
    const real = insideRoot(root, p);
    return real ? [{ name: p.split(sep).join('/'), data: readFileSync(real) }] : [];
  });
  const archive = zipStore(files);
  return withList ? { archive, files } : archive;
}

export async function instanceScan(inst, { root, project, branch, pollMs }) {
  const caps = await call(inst, 'GET', '/instance/capabilities');
  if (caps.status === 200 && caps.data?.clusterScans !== true) {
    throw new Exit(3, 'This instance runs no scanner (no cluster): scan on this machine with scan.mjs, then send.');
  }
  const start = await call(inst, 'POST', `/project/${project}/scan/start`, { json: { branch } });
  if (![200, 201, 202].includes(start.status) || !start.data?.url || !start.data?.scanId) {
    throw new Exit(2, `The instance did not start the scan: HTTP ${start.status}${codeOf(start) ? ` ${codeOf(start)}` : ''}.`);
  }
  const { archive, files } = repositoryArchive(root, { withList: true });
  say(`Uploading ${files.length} files (${Math.round(archive.length / 1024)} KiB) for scan ${start.data.scanId}.`);
  let put;
  try {
    // The signed URL carries its own authorization: no token goes with it.
    put = await fetch(start.data.url, { method: 'PUT', headers: { 'content-type': 'application/zip' }, body: archive, signal: AbortSignal.timeout(300_000) });
  } catch {
    throw new Exit(3, 'The archive upload did not reach the instance storage (CYBEDEFEND_STORAGE_PUBLIC_URL).');
  }
  if (put.status !== 200) throw new Exit(2, `The archive upload answered HTTP ${put.status}.`);
  const scan = await waitScan(inst, project, start.data.scanId, { pollMs });
  const run = { projectId: project, branch, at: new Date().toISOString(), mode: 'instance', scans: [{ scanner: 'instance', type: 'all', scanId: start.data.scanId, state: scan.state, errorMessage: scan.errorMessage, errorCode: scan.errorCode }] };
  return run;
}

// ─── report ─────────────────────────────────────────────────────────────────

export async function report(inst, { project, branch, kind = 'owasp', format = 'pdf', pollMs = POLL_MS }) {
  if (!['owasp', 'cwe'].includes(kind)) throw new Exit(64, '--kind is owasp or cwe.');
  if (!['pdf', 'html', 'json'].includes(format)) throw new Exit(64, '--format is pdf, html or json.');
  const res = await call(inst, 'GET', `/project/${project}/${kind}-report/${format}?branch=${encodeURIComponent(branch)}`);
  if (res.status !== 200 || !res.data?.reportId) throw new Exit(2, `The report was not started: HTTP ${res.status}.`);
  const deadline = Date.now() + 180_000;
  for (;;) {
    const poll = await call(inst, 'GET', `/project/${project}/reports/${res.data.reportId}`);
    if (poll.data?.status === 'failed') throw new Exit(2, 'The instance could not generate the report.');
    if (poll.data?.status === 'ready' && poll.data?.downloadUrl) return { reportId: res.data.reportId, kind, format, downloadUrl: poll.data.downloadUrl };
    if (Date.now() > deadline) throw new Exit(2, 'The report is not ready after 3 minutes.');
    await sleep(pollMs);
  }
}

// ─── doctor ─────────────────────────────────────────────────────────────────

export async function doctor(inst, root) {
  const out = { url: inst.url, tokenSet: inst.token !== '', tokenLooksLikePat: inst.token.startsWith('cdp_') };
  try {
    out.projectId = projectId(root, inst);
  } catch (e) {
    out.projectId = null;
    out.projectProblem = e.message;
  }
  if (!out.tokenSet) return { ...out, ok: false, problem: 'CYBEDEFEND_TOKEN is not set.' };
  try {
    const me = await call(inst, 'GET', '/user/profile');
    out.tokenAccepted = me.status === 200;
    const caps = await call(inst, 'GET', '/instance/capabilities');
    out.clusterScans = caps.status === 200 ? caps.data?.clusterScans === true : null;
  } catch (e) {
    return { ...out, ok: false, problem: e.message };
  }
  return { ...out, ok: out.tokenAccepted === true };
}

// ─── links to the dashboard ─────────────────────────────────────────────────

export function links(inst, project, run) {
  return {
    project: `${inst.url}/project/${project}`,
    compliance: `${inst.url}/project/${project}/compliance`,
    scans: (run?.scans ?? []).filter((s) => s.scanId).map((s) => ({ scanner: s.scanner, url: `${inst.url}/project/${project}/scan/${s.scanId}` })),
  };
}

// ─── Opengrep rule ids ──────────────────────────────────────────────────────

/**
 * Opengrep prefixes each rule id with the dotted path of its --config
 * (/home/me/rules/x.yaml gives home.me.rules.python-eval). The CybeDefend
 * image strips it (cybedefend-scanners, internal/adapter/opengrep.go), and the
 * dashboard keys findings on the rule id: strip it the same way, so a local
 * run and an image run give the same ids, and no home path leaves the machine.
 */
export function stripRulePrefix(doc, configPath) {
  // A Windows path (C:\Users\me\rules) may come out with its drive as "C:", "C" or not at all: the longest that fits wins.
  const parts = String(configPath).split(/[\\/]+/).filter(Boolean);
  const drive = /^[A-Za-z]:$/.test(parts[0] ?? '');
  const prefixes = [...new Set([parts, ...(drive ? [[parts[0][0], ...parts.slice(1)], parts.slice(1)] : [])].map((p) => `${p.join('.')}.`))].sort((a, b) => b.length - a.length);
  const fix = (id) => {
    const prefix = typeof id === 'string' ? prefixes.find((p) => id.startsWith(p)) : null;
    return prefix ? id.slice(prefix.length) : id;
  };
  let n = 0;
  const scrub = (text) => (typeof text === 'string' ? prefixes.reduce((t, p) => t.split(p).join(''), text) : text);
  for (const run of doc.runs ?? []) {
    for (const rule of run.tool?.driver?.rules ?? []) {
      const to = fix(rule.id);
      if (to !== rule.id) (rule.id = to), (n += 1);
      rule.name = scrub(rule.name);
      for (const k of ['shortDescription', 'fullDescription', 'help']) if (rule[k]?.text) rule[k].text = scrub(rule[k].text);
    }
    for (const r of run.results ?? []) {
      const to = fix(r.ruleId);
      if (to !== r.ruleId) (r.ruleId = to), (n += 1);
      if (r.rule?.id) r.rule.id = fix(r.rule.id);
    }
  }
  return n;
}

// ─── Scanner rules a person can read ────────────────────────────────────────
//
// The dashboard shows, on a finding's page, its rule's name as the title, its
// full description under "why", its help under "how to prevent". The tools
// fill those fields each in its own way: Trivy names every configuration rule
// "Misconfiguration", Opengrep names a rule by its dotted path, gosec by its
// CWE, Gitleaks gives one long sentence and Bandit a name with underscores.
// So before the files are sent, each rule gets a title in words, a
// description and, where this skill knows one, what to do: from the tool's
// own texts, never invented. Ids, tags and results stay as the tool wrote them.

/** The words a tool uses for a whole family of results: never a title. */
const CLASS_WORDS = /^(misconfiguration|secret|license|vulnerability|languagespecificpackagevulnerability|ospackagevulnerability)$/i;
const ACRONYMS = new Set(['aws', 'gcp', 'api', 'sql', 'xss', 'csrf', 'ssrf', 'xxe', 'rce', 'jwt', 'http', 'https', 'tls', 'ssl', 'ssh', 'url', 'uri', 'xml', 'json', 'yaml', 'html', 'css', 'id', 'ip', 'dns', 'tcp', 'udp', 'rsa', 'dsa', 'aes', 'des', 'md5', 'sha1', 'sha256', 'iam', 'kms', 's3', 'ec2', 'eks', 'gke', 'aks', 'ldap', 'saml', 'totp', 'mfa', 'ci', 'cd', 'os', 'cve', 'cwe', 'npm', 'pat', 'sas', 'ecr', 'gcr', 'acl', 'rbac', 'cors', 'csp', 'hsts', 'pii', 'ui']);
const NAMES = { github: 'GitHub', gitlab: 'GitLab', oauth: 'OAuth', pypi: 'PyPI', openai: 'OpenAI', graphql: 'GraphQL', javascript: 'JavaScript', typescript: 'TypeScript', kubernetes: 'Kubernetes', docker: 'Docker', dockerfile: 'Dockerfile', terraform: 'Terraform', postgres: 'Postgres', mysql: 'MySQL', mongodb: 'MongoDB', redis: 'Redis', slack: 'Slack', stripe: 'Stripe', twilio: 'Twilio', azure: 'Azure', google: 'Google', heroku: 'Heroku', sendgrid: 'SendGrid', '1password': '1Password' };

/** A text that can stand as a finding's title: a few words on one line, not the rule's id, not a family word. */
export function readsAsTitle(text, id) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t.length < 6 || t.length > 100 || /\n/.test(t) || !/\s/.test(t)) return false;
  if (id && (t === id || t.endsWith(`: ${id}`))) return false;
  return !CLASS_WORDS.test(t);
}

/** A rule's name written as a path or with separators, in words: "tainted-sql-string" is "Tainted SQL string". */
export function wordsOf(slug) {
  const words = String(slug ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9']+/).filter(Boolean);
  if (words.length < 2 && !/[A-Za-z]{4,}/.test(words[0] ?? '')) return '';
  const said = words.map((w, i) => {
    const low = w.toLowerCase();
    if (NAMES[low]) return NAMES[low];
    if (ACRONYMS.has(low)) return low.toUpperCase();
    return i === 0 ? low[0].toUpperCase() + low.slice(1) : low;
  });
  return said.join(' ');
}

/** The CWE a rule names: in its tags, or apart as gosec writes it (a relationship to the CWE taxonomy). */
function cweOfRule(rule) {
  const inTags = /cwe[-_/ ]?(\d+)/i.exec(JSON.stringify([rule?.properties?.tags ?? [], rule?.properties?.cwe ?? '']));
  if (inTags) return Number(inTags[1]);
  const rel = (rule?.relationships ?? []).find((x) => /^cwe$/i.test(x?.target?.toolComponent?.name ?? '') && /^\d+$/.test(String(x?.target?.id ?? '')));
  return rel ? Number(rel.target.id) : null;
}

const SECRET_HELP = '**What to do first.** Revoke it and issue a new one at the service it belongs to: a key that was committed is exposed, and removing it from the code does not undo that.\n\n**Then.** Read the new one from the environment or a secret manager, never from a file in the repository. When the repository is shared, take the old one out of the git history too.';

/**
 * An advisory's title is the tool's own and stays as it is, with two
 * exceptions, both about the names it opens on ("launch-editor: vite:
 * launch-editor: ..."), since the dashboard shows the title as it comes.
 * A name written more than once is said once, where it stands last
 * ("body-parser: body-parser: ..." names the package once), and a short name
 * gives way to the same package under its scope ("grpc-js: @grpc/grpc-js:
 * ..." keeps the full one). The package the advisory is on, written in
 * another case ("Axios: ..."), is written as the package is: one package
 * reads the same down a list. A first word that is no name of the package
 * keeps its case. Returns how many rules changed.
 */
function packageOnce(doc) {
  const label = /^(@?[\w.-]+(?:\/[\w.-]+)*): /;
  let changed = 0;
  for (const run of doc?.runs ?? []) {
    // The packages each rule's results are on, as the tool writes them, under their lower-case form.
    const packages = new Map();
    for (const res of run.results ?? []) {
      const name = /Package: ([^\n]+)/.exec(res?.message?.text ?? '')?.[1]?.trim();
      if (!name || !res.ruleId) continue;
      if (!packages.has(res.ruleId)) packages.set(res.ruleId, new Map());
      packages.get(res.ruleId).set(name.toLowerCase(), name);
    }
    for (const rule of run.tool?.driver?.rules ?? []) {
      const short = rule?.shortDescription?.text;
      if (typeof short !== 'string') continue;
      // The names the title opens on, then its words.
      const labels = [];
      let words = short;
      for (let m = label.exec(words); m; m = label.exec(words)) {
        labels.push(m[1]);
        words = words.slice(m[0].length);
      }
      if (!labels.length) continue;
      const lower = labels.map((l) => l.toLowerCase());
      const own = packages.get(rule.id);
      const kept = labels
        .filter((_, i) => !lower.includes(lower[i], i + 1) && !lower.some((other) => other.endsWith(`/${lower[i]}`)))
        .map((l) => own?.get(l.toLowerCase()) ?? l);
      const title = `${kept.join(': ')}: ${words}`;
      if (title === short) continue;
      rule.shortDescription = { ...rule.shortDescription, text: title };
      changed += 1;
    }
  }
  return changed;
}

/**
 * Gives every rule of a scanner's file a title a person can read (`name`),
 * a description (`fullDescription`) and, where this skill knows the answer,
 * what to do (`help`). The title is, in this order: the tool's short
 * description when it reads as a title; for a secret, the name of the secret;
 * the rule's own name or the last part of its id, in words; the first
 * sentence of what the tool says. An advisory on a package keeps its words,
 * its package said once (packageOnce).
 * Returns how many rules changed.
 */
export function readableRules(doc, { type } = {}) {
  if (['sbom', 'context'].includes(type)) return 0;
  if (['sca', 'container'].includes(type)) return packageOnce(doc);
  let changed = 0;
  for (const run of doc?.runs ?? []) {
    // Once per file: a second pass would take the titles it wrote for the tool's own.
    if (run?.properties?.readableRules === true) continue;
    const firstMessage = new Map();
    for (const r of run.results ?? []) if (r?.ruleId && !firstMessage.has(r.ruleId) && typeof r.message?.text === 'string') firstMessage.set(r.ruleId, r.message.text);
    for (const rule of run.tool?.driver?.rules ?? []) {
      if (!rule || typeof rule.id !== 'string') continue;
      const tags = Array.isArray(rule.properties?.tags) ? rule.properties.tags : [];
      if (String(tags[0] ?? '').toLowerCase() === 'vulnerability') continue;
      const before = JSON.stringify(rule);
      const short = String(rule.shortDescription?.text ?? '').replace(/^(Opengrep|Semgrep) Finding: /, '').trim();
      const full = String(rule.fullDescription?.text ?? '').trim();
      const said = (firstMessage.get(rule.id) ?? '').split('\n')[0].trim();
      const lastOfId = rule.id.split(/[./]/).pop();
      const firstSentence = (full || said).split(/(?<=[.!?])\s/)[0].replace(/\.$/, '');
      const secret = type === 'secret' || String(tags[0] ?? '').toLowerCase() === 'secret';
      // The class the tool filed the rule under, when its name is one (gosec: the CWE's name).
      const className = readsAsTitle(rule.name, rule.id) && rule.name !== short ? rule.name : '';
      let title = '';
      if (secret && wordsOf(lastOfId)) title = `${wordsOf(lastOfId)} committed in the repository`;
      else if (readsAsTitle(short, rule.id)) title = short;
      else if (/[-_]/.test(lastOfId) && wordsOf(lastOfId)) title = wordsOf(lastOfId);
      else if (typeof rule.name === 'string' && /[-_]/.test(rule.name) && !/[./\s]/.test(rule.name) && wordsOf(rule.name)) title = wordsOf(rule.name);
      else if (readsAsTitle(rule.name, rule.id)) title = rule.name;
      else if (readsAsTitle(firstSentence, rule.id)) title = firstSentence;
      if (!title) continue;
      title = title.replace(/\.$/, '');
      const cwe = cweOfRule(rule);
      // Why: the tool's own description when it says more than the title, else what it said of the line; then its class.
      let why = full && full !== title ? full : '';
      if (!why && short && short !== title && short.length > 20) why = short;
      // A rule with no text of its own (Bandit): what the tool said of the line.
      if (!why && !full && !short && said && said !== title) why = withStop(said);
      if (!why) why = withStop(title);
      if (!rule.fullDescription?.text || rule.fullDescription.text.trim() === short || rule.fullDescription.text.trim() === title) {
        const more = [];
        if (className && className !== title) more.push(`**Class of flaw.** ${withStop(className)}${cwe ? ` [CWE-${cwe}](https://cwe.mitre.org/data/definitions/${cwe}.html).` : ''}`);
        else if (cwe) more.push(`**Class of flaw.** [CWE-${cwe}](https://cwe.mitre.org/data/definitions/${cwe}.html).`);
        rule.fullDescription = { ...(rule.fullDescription ?? {}), text: [withStop(why), ...more].join('\n\n') };
      }
      rule.name = title;
      // What to do: this skill's answer for the secret, the rule or the CWE when it has one, then the tool's own help when it says more than the title.
      const toolHelp = String(rule.help?.markdown ?? rule.help?.text ?? '').trim();
      if (!/^\*\*What to do( first)?\.\*\*/.test(toolHelp)) {
        const helpSaysMore = toolHelp.replace(/^(Severity|Confidence): .*$/gim, '').replace(/\s+/g, ' ').trim().length > short.length + 40;
        const answer = secret ? SECRET_HELP : FIX_BY_RULE.find(([re]) => re.test(lastOfId) || re.test(rule.id))?.[1] ?? (cwe ? FIX_BY_CWE[`CWE-${cwe}`] : null);
        const ours = answer ? (secret ? answer : `**What to do.** ${answer}`) : '';
        const markdown = [ours, helpSaysMore ? toolHelp : ''].filter(Boolean).join('\n\n');
        if (ours) rule.help = { text: plain(markdown), markdown };
      }
      if (cwe && !tags.some((t) => new RegExp(`^CWE-${cwe}$`, 'i').test(String(t)))) rule.properties = { ...(rule.properties ?? {}), tags: [...tags, `CWE-${cwe}`] };
      if (!rule.helpUri && cwe) rule.helpUri = `https://cwe.mitre.org/data/definitions/${cwe}.html`;
      if (JSON.stringify(rule) !== before) changed += 1;
    }
    run.properties = { ...(run.properties ?? {}), readableRules: true };
  }
  return changed;
}

/** The run's result files that go to the dashboard, each rule named in words (readableRules). Returns { files, rules }. */
export function readableOut({ out }) {
  const done = { files: 0, rules: 0 };
  const manifest = join(out, 'manifest.tsv');
  if (!existsSync(manifest)) return done;
  for (const e of readManifest(manifest)) {
    if (e.status !== 'ok' || !e.file || !/\.sarif$/.test(e.file) || ['sbom', 'context'].includes(e.type)) continue;
    try {
      const doc = JSON.parse(readFileSync(e.file, 'utf8'));
      const n = readableRules(doc, { type: e.type });
      if (!n) continue;
      writeFileSync(e.file, JSON.stringify(doc));
      done.files += 1;
      done.rules += n;
    } catch {
      /* a file that does not parse is sent as its tool wrote it */
    }
  }
  return done;
}

// ─── Secrets stay in their file ─────────────────────────────────────────────
//
// Gitleaks writes no secret in its SARIF (--redact), but other tools quote
// the code they flag: Bandit's "Possible hardcoded password: '<the key>'",
// a snippet around a line. Those files go to the dashboard, into the triage
// and on the agent's screen. So after the scan, every value Gitleaks located
// is read from the file itself, never printed, and masked in every result.

const MASK = 'REDACTED';
const TOKEN_CHAR = /[A-Za-z0-9_\-/+.~]/;
const looksRandom = (v) => (/[0-9]/.test(v) && /[A-Za-z]/.test(v)) || (/[a-z]/.test(v) && /[A-Z]/.test(v) && /[^A-Za-z]/.test(v));

/**
 * The strings that may be the secret, in the piece of source the secret
 * scanner pointed at. `narrow`: the piece is the match itself (a few
 * characters around it), so anything quoted or long in it counts; otherwise
 * it is a whole line or more, and only what looks random counts.
 */
export function secretTokens(span, narrow) {
  const found = new Set();
  for (const m of span.matchAll(/(["'`])((?:(?!\1)[^\n]){6,})\1/g)) if (narrow || looksRandom(m[2])) found.add(m[2]);
  for (const m of span.matchAll(/[A-Za-z0-9_\-/+.~]{8,}={0,2}/g)) {
    const v = m[0];
    if (narrow ? /[0-9]/.test(v) || v.length >= 20 : v.length >= 16 && looksRandom(v)) found.add(v);
  }
  return found;
}

/**
 * What Gitleaks found, from its SARIF in `out`: where each secret is (file,
 * line, kind: safe to show) and the values themselves, read from the files
 * under `root` (never to be shown, only to be masked).
 */
export function locatedSecrets(out, root) {
  const found = { places: [], values: [] };
  const file = join(out, 'gitleaks.sarif');
  if (!existsSync(file)) return found;
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return found;
  }
  const values = new Set();
  const sources = new Map();
  for (const run of doc.runs ?? []) {
    for (const r of run.results ?? []) {
      const loc = r.locations?.[0]?.physicalLocation;
      const uri = loc?.artifactLocation?.uri;
      const reg = loc?.region ?? {};
      const line = Number(reg.startLine);
      if (typeof uri !== 'string' || !(line >= 1)) continue;
      const endLine = Number(reg.endLine) >= line ? Number(reg.endLine) : line;
      found.places.push({ file: uri, line, endLine, kind: r.ruleId ?? 'secret' });
      const path = resolve(root, uri);
      if (!path.startsWith(resolve(root) + sep) || !existsSync(path)) continue;
      if (!sources.has(path)) {
        try {
          sources.set(path, statSync(path).size <= 5_000_000 ? readFileSync(path, 'utf8').split('\n') : []);
        } catch {
          sources.set(path, []);
        }
      }
      const lines = sources.get(path);
      const text = lines[line - 1];
      if (text === undefined) continue;
      const start = Number(reg.startColumn);
      const end = Number(reg.endColumn);
      if (endLine === line && start >= 1 && end >= start) {
        // The match, widened to the whole token on each side (Gitleaks'
        // columns are off by one for some rules) and to its quotes.
        let a = Math.max(0, start - 2);
        let b = Math.min(text.length, end + 1);
        while (a > 0 && TOKEN_CHAR.test(text[a - 1])) a -= 1;
        while (b < text.length && TOKEN_CHAR.test(text[b])) b += 1;
        if (a > 0 && /["'`]/.test(text[a - 1])) a -= 1;
        if (b < text.length && /["'`]/.test(text[b])) b += 1;
        const narrow = secretTokens(text.slice(a, b), true);
        for (const v of narrow.size ? narrow : secretTokens(text, false)) values.add(v);
      } else {
        for (const v of secretTokens(lines.slice(line - 1, endLine).join('\n'), false)) values.add(v);
      }
    }
  }
  // The longest first: a value that holds another is masked whole.
  found.values = [...values].sort((x, y) => y.length - x.length);
  return found;
}

/**
 * A sentence for the screen (a line of progress, a note of the live page), with no secret in it:
 * a value that follows a name like a key, and a token recognisable by its shape, are masked
 * wherever they sit in the sentence. maskNamedSecrets below reads whole lines of a file; this
 * one reads prose.
 */
export function maskInProse(text) {
  return String(text ?? '')
    // `name=value` is an assignment wherever it sits. After a colon a sentence often goes on
    // ("the reset token: never expires"), so only what looks like a value is masked there.
    .replace(/((?:secret|token|passwd|password|pwd|credential|private[_-]?key|api[_-]?key|access[_-]?key|signing[_-]?key|auth[_-]?key)[A-Za-z0-9_.-]*["']?\s*=\s*["']?)([^\s"',;]{4,})/gi, `$1${MASK}`)
    .replace(/((?:secret|token|passwd|password|pwd|credential|private[_-]?key|api[_-]?key|access[_-]?key|signing[_-]?key|auth[_-]?key)[A-Za-z0-9_.-]*["']?\s*:\s*["']?)((?=[^\s"',;]*\d)[^\s"',;]{8,}|[^\s"',;]{20,})/gi, `$1${MASK}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi, `$1${MASK}$3`)
    .replace(/\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|\bxox[baprs]-[A-Za-z0-9-]{10,}/g, MASK);
}

/**
 * Masks what a name gives away, whatever the secret scanner said: the value
 * of a setting named like a key, a token or a password (KEY=..., "password":
 * "...", secret: ...), and the password of a URL (scheme://user:password@host).
 * A scanner misses a short or plain secret (a signing key of digits, a
 * database password of one word): its name does not. Returns the text and
 * how many values were masked.
 */
export function maskNamedSecrets(text, { code = false } = {}) {
  let masked = 0;
  const name = '[A-Za-z0-9_.-]*(?:secret|token|passwd|password|pwd|credential|private[_-]?key|api[_-]?key|access[_-]?key|symmetric[_-]?key|signing[_-]?key|encryption[_-]?key|auth[_-]?key)[A-Za-z0-9_.-]*';
  const assign = new RegExp(`^(\\s*(?:export\\s+|-\\s+)?["']?(${name})["']?\\s*[:=]\\s*)(["']?)([^"'\\s#,;][^"'#\\n]*?)\\3(\\s*[,;]?\\s*(?:#.*)?)$`, 'i');
  // A setting about a secret is not the secret: how long a token lives, where a key file is, which header carries it.
  const about = /(duration|ttl|expir\w*|lifetime|timeout|url|uri|endpoint|issuer|audience|header|name|type|alg\w*|length|path|file|enabled|required|policy|prefix|field|param|cookie|rounds|cost)$/i;
  const lines = text.split('\n').map((l) => {
    let out = l.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]{3,})(@)/gi, (m, a, _b, c) => {
      masked += 1;
      return `${a}${MASK}${c}`;
    });
    const m = assign.exec(out);
    // A reference to another setting (${VAR}, os.environ[...], process.env.X) is not a value.
    // In a source file only a quoted literal is a value: `secret = read_secret(user)` is code, and a
    // reviewer needs that line. In a settings file (KEY=value) a bare word is the value.
    const literal = m && (m[3] !== '' || (!code && !/[()[\]{}]|\s/.test(m[4].trim())));
    if (m && literal && !about.test(m[2]) && m[4].trim() !== MASK && !/^(\$\{|\$[A-Z_]|os\.|process\.env|env\(|ENV\[|getenv|null|none|true|false|""|''|\{\{)/i.test(m[4].trim())) {
      masked += 1;
      out = `${m[1]}${m[3]}${MASK}${m[3]}${m[5]}`;
    }
    return out;
  });
  return { text: lines.join('\n'), masked };
}

/** Masks every value in every string of a document. Returns how many strings changed. */
export function maskValues(node, values) {
  let n = 0;
  const walk = (x) => {
    if (Array.isArray(x)) {
      for (let i = 0; i < x.length; i += 1) {
        if (typeof x[i] === 'string') {
          const to = maskString(x[i], values);
          if (to !== x[i]) (x[i] = to), (n += 1);
        } else walk(x[i]);
      }
    } else if (x && typeof x === 'object') {
      for (const k of Object.keys(x)) {
        if (typeof x[k] === 'string') {
          const to = maskString(x[k], values);
          if (to !== x[k]) (x[k] = to), (n += 1);
        } else walk(x[k]);
      }
    }
  };
  walk(node);
  return n;
}

function maskString(text, values) {
  let s = text;
  for (const v of values) if (s.includes(v)) s = s.split(v).join(MASK);
  return s;
}

/**
 * After the scan: masks the located secrets in every result file of `out`,
 * and the password Bandit quotes in its own message (B105, B106, B107), in
 * that result only. `src` is the copy of the repository that was scanned.
 */
export function redactOut({ out, src }) {
  const { places, values } = locatedSecrets(out, src);
  let replaced = 0;
  const files = [];
  for (const name of readdirSync(out)) {
    if (!name.endsWith('.sarif') || name === 'cybedefend-full.sarif') continue;
    const file = join(out, name);
    let doc;
    try {
      doc = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    let n = values.length ? maskValues(doc, values) : 0;
    for (const run of doc.runs ?? []) {
      for (const r of run.results ?? []) {
        if (!/^B10[567]$/.test(String(r.ruleId ?? ''))) continue;
        const m = /hardcoded password: '([\s\S]+)'\s*$/.exec(r.message?.text ?? '');
        if (m && m[1] !== MASK) n += maskValues(r, [m[1]]);
      }
    }
    if (n) {
      writeFileSync(file, JSON.stringify(doc));
      files.push(name);
      replaced += n;
    }
  }
  return { places, replaced, files };
}

// ─── The audit's map: every entry point, and what the review concluded ──────

/**
 * Reads the entry-point tables of .cybedefend/audit/map.md (every table with
 * a "Verdict" column): one row per entry point, its verdict one of ok,
 * finding, lead, not examined. A row without one is an entry point nobody
 * reviewed: the audit is not finished. Returns null when there is no map.
 */
export function readMap(file) {
  if (!existsSync(file)) return null;
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const lines = readFileSync(file, 'utf8').split('\n');
  const result = { rows: 0, ok: 0, finding: 0, lead: 0, notExamined: 0, carried: 0, problems: [], list: [] };
  let tables = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|') || !/verdict/i.test(lines[i])) continue;
    if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) continue;
    const col = cells(lines[i]).findIndex((c) => /^verdict/i.test(c));
    if (col < 0) continue;
    const width = cells(lines[i]).length;
    tables += 1;
    for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i += 1) {
      const row = cells(lines[i]);
      // A cell that holds a pipe (a template filter, a shell command) adds cells to its row: the verdict is then the last one.
      if (row.length > width && col === width - 1) row[col] = row[row.length - 1];
      const verdict = (row[col] ?? '').replace(/[*_`]/g, '').trim().toLowerCase();
      result.rows += 1;
      result.list.push({ entry: row[0] ?? '', verdict: row[col] ?? '' });
      // A run on a branch reviews what the branch changed: the other rows keep their verdict, and say so.
      if (/not reviewed (in )?this run/.test(verdict)) result.carried += 1;
      if (verdict.startsWith('ok')) result.ok += 1;
      else if (verdict.startsWith('finding')) result.finding += 1;
      else if (verdict.startsWith('lead')) result.lead += 1;
      else if (verdict.startsWith('not examined')) result.notExamined += 1;
      else result.problems.push(`map: the row "${(row[0] ?? '').slice(0, 60)}" has the verdict ${JSON.stringify((row[col] ?? '').slice(0, 40))}: it starts with ok, finding, lead or not examined${row.length > width ? ' (this row has more cells than the header: a | inside a cell is written \\|)' : ''}`);
    }
  }
  if (!tables) result.problems.push('map: no entry-point table with a "Verdict" column (audit.md, step 1)');
  return result;
}

// ─── pairing: which finding of the dashboard is which result ────────────────

/** A result's title as the dashboard shows it: the rule's name when it reads as a title (readableRules), else its short description, its help, its name, the message. */
export function titleOf(result, rule) {
  if (readsAsTitle(rule?.name, rule?.id)) return rule.name;
  return (rule?.shortDescription?.text ?? (/^[^\n]{8,100}$/.test(rule?.help?.text ?? '') ? rule.help.text : null) ?? rule?.name ?? result?.message?.text ?? result?.ruleId ?? '').replace(/^Opengrep Finding: /, '').slice(0, 140);
}

/** The run's result files of the given import types, from the scan's manifest. */
export function codeFiles(out, types) {
  const entries = existsSync(join(out, 'manifest.tsv')) ? readManifest(join(out, 'manifest.tsv')) : [];
  return entries.filter((e) => e.status === 'ok' && e.file && types.includes(e.type)).map((e) => ({ name: e.name, type: e.type, file: e.file }));
}

/** Every result with a file and a line in a set of SARIF files: { type, tool, ruleId, uri, line, title, cwes, result }. */
export function placedResults(files) {
  const list = [];
  for (const f of files) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(f.file, 'utf8'));
    } catch {
      continue;
    }
    for (const run of doc.runs ?? []) {
      const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
      for (const r of run.results ?? []) {
        const rule = rules.get(r.ruleId);
        const loc = r.locations?.[0]?.physicalLocation;
        const uri = loc?.artifactLocation?.uri;
        const line = Number(loc?.region?.startLine);
        if (!uri || !(line >= 1)) continue;
        const cwes = [...new Set([...(rule?.properties?.tags ?? []).filter((t) => /^CWE-\d+$/.test(String(t))), cweOf(r, rule, f.type)].filter(Boolean))];
        list.push({ type: f.type, tool: f.name, ruleId: r.ruleId, uri, line, title: titleOf(r, rule), cwes, message: r.message?.text ?? '', result: r });
      }
    }
  }
  return list;
}

/** A message as it is compared: its first 160 characters, spaces evened out. */
const sameText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);

/**
 * Says which finding of the dashboard each result is. The dashboard keeps, of
 * a finding, its file, its line, and its rule's title and CWE as it first saw
 * them on this machine (one catalogue for every project): never the result's
 * own message, and for the rule id only its own code (CD-SAST-90153). So a
 * result is told from its neighbours on a line by what can be told, in this
 * order: the code already learned for its rule, the result's message when the
 * finding's detail was read (tellApart), the title, the CWE, then
 * elimination. A code learned on a line that holds one result settles the
 * lines that hold several.
 * `sent`: [{ type, uri, line, ruleId, title, cwes, message }]; `dashboard`:
 * [{ id, type, path, line, title, short, cwe, code, message }]. Returns, for
 * each result, its finding or undefined. Results of one rule on one line
 * share one finding: the dashboard merges them.
 */
export function pairWithDashboard(sent, dashboard) {
  const placeOf = (type, uri, line) => `${type}|${uri}|${line}`;
  const groups = new Map();
  for (const s of sent) {
    const place = placeOf(s.type, s.uri, s.line);
    const key = `${place}|${s.ruleId}`;
    if (!groups.has(key)) groups.set(key, { place, ruleId: s.ruleId, title: s.title, cwes: s.cwes ?? [], messages: [], hit: undefined });
    if (s.message) groups.get(key).messages.push(sameText(s.message));
  }
  const at = new Map();
  for (const d of dashboard) {
    if (!d.path || !(d.line >= 1)) continue;
    const place = placeOf(d.type, d.path, d.line);
    at.set(place, [...(at.get(place) ?? []), d]);
  }
  const codeOf = new Map();
  const ruleOf = new Map();
  const taken = new Set();
  const assign = (g, d) => {
    g.hit = d;
    taken.add(d.id);
    if (d.code && !codeOf.has(g.ruleId) && !ruleOf.has(d.code)) {
      codeOf.set(g.ruleId, d.code);
      ruleOf.set(d.code, g.ruleId);
    }
  };
  const all = [...groups.values()];
  for (let moved = true, pass = 0; moved && pass < 50; pass += 1) {
    moved = false;
    for (const g of all) {
      if (g.hit) continue;
      const free = (at.get(g.place) ?? []).filter((d) => !taken.has(d.id));
      if (!free.length) continue;
      const code = codeOf.get(g.ruleId);
      let d;
      if (code) d = free.find((x) => x.code === code);
      else {
        // Never a finding whose code another rule already holds.
        const open = free.filter((x) => !x.code || !ruleOf.has(x.code));
        const byMessage = open.filter((x) => x.message && g.messages.includes(sameText(x.message)));
        const byTitle = open.filter((x) => g.title && (x.title === g.title || x.short === g.title));
        const byCwe = (byTitle.length ? byTitle : open).filter((x) => (x.cwe ?? []).some((c) => g.cwes.includes(c)));
        // Elimination: the one result still waiting on this line, and the one finding left for it.
        const waiting = all.filter((x) => !x.hit && x.place === g.place && !codeOf.has(x.ruleId));
        d = byMessage.length === 1 ? byMessage[0] : byTitle.length === 1 ? byTitle[0] : byCwe.length === 1 ? byCwe[0] : open.length === 1 && waiting.length === 1 ? open[0] : undefined;
      }
      if (d) {
        assign(g, d);
        moved = true;
      }
    }
  }
  return sent.map((s) => groups.get(`${placeOf(s.type, s.uri, s.line)}|${s.ruleId}`).hit);
}

/**
 * The pairing, with its last resort: where findings on a line still cannot
 * be told apart, the detail of each says what the list does not, the
 * result's own message. One request per finding asked, forty at most, and
 * never for a secret. The messages stay on the `dashboard` items, so a later
 * pairing on the same list uses them.
 */
export async function tellApart(inst, { project, sent, dashboard }) {
  const pairs = pairWithDashboard(sent, dashboard);
  const taken = new Set(pairs.filter(Boolean).map((d) => d.id));
  const undecided = new Set(sent.filter((s, i) => !pairs[i] && s.type !== 'secret').map((s) => `${s.type}|${s.uri}|${s.line}`));
  const ask = dashboard.filter((d) => !taken.has(d.id) && d.message === undefined && undecided.has(`${d.type}|${d.path}|${d.line}`)).slice(0, 40);
  for (const d of ask) {
    const res = await call(inst, 'GET', `/mcp/project/${project}/results/${d.type}/${d.id}`);
    d.message = res.status === 200 ? String(res.data?.contextualExplanation ?? '') : '';
  }
  return ask.length ? pairWithDashboard(sent, dashboard) : pairs;
}

// ─── prove: the audit's proven findings, marked in the dashboard ────────────

/**
 * For each proven result of the audit file, finds the finding the import made
 * (pairWithDashboard) and sets its exploitability to proven, with the failing
 * test as the reason: what set_exploitability does over MCP, through the same
 * gateway route, so the first run needs no MCP session.
 */
export async function markProven(inst, { project, file, branch, out }) {
  const done = [];
  const audit = placedResults([{ name: AUDIT_TOOL, type: 'sast', file }]);
  if (!audit.length) return done;
  // Read once for the whole file: one list per finding would be hundreds of
  // requests on a large audit, and the dashboard counts them. Open findings
  // only: an earlier audit's finding at the same place may be resolved, and
  // marking it would leave the new one unproven.
  const open = [];
  for (const status of ['to_verify', 'confirmed']) {
    for (let page = 1; page <= 100; page += 1) {
      const list = await call(inst, 'GET', `/mcp/project/${project}/results/sast?pageSize=100&page=${page}&status=${status}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`);
      if (list.status !== 200) throw new Exit(3, `The dashboard did not give its findings (HTTP ${list.status}). Nothing is lost: run the same command again.`);
      for (const v of Array.isArray(list.data?.vulnerabilities) ? list.data.vulnerabilities : []) {
        if (['resolved', 'ignored'].includes(v.state)) continue;
        open.push({ id: v.id, type: 'sast', path: v.path, line: Number(v.startLine), title: v.title, short: v.shortDescription, cwe: v.cwe ?? [], code: v.ruleCode, verdict: v.exploitabilityVerdict });
      }
      if (page >= Number(list.data?.totalPages ?? 1)) break;
    }
  }
  // The scanners' code results of this run take part in the pairing: a
  // scanner's finding on the same line is not the audit's to mark.
  const sent = [...(out ? placedResults(codeFiles(out, ['sast'])) : []), ...audit];
  const pairs = await tellApart(inst, { project, sent, dashboard: open });
  // Two proofs of one rule on one line are one finding in the dashboard: one request, both tests in its reason.
  const byFinding = new Map();
  sent.forEach((s, i) => {
    if (s.tool !== AUDIT_TOOL || s.result.properties?.proven !== true) return;
    const hit = pairs[i];
    if (!hit) {
      const there = open.filter((v) => v.path === s.uri && v.line === s.line).length;
      done.push({ ruleId: s.ruleId, uri: s.uri, line: s.line, marked: false, why: there ? `${there} finding(s) on that line in the dashboard, and nothing tells which one this is` : 'not in the dashboard yet' });
      return;
    }
    const entry = byFinding.get(hit.id) ?? { hit, members: [] };
    entry.members.push(s);
    byFinding.set(hit.id, entry);
  });
  for (const { hit, members } of byFinding.values()) {
    const tests = [...new Set(members.map((s) => testNameOf(s.result.properties.proofTest)))];
    // What a person reads on the finding: what was found, the test that shows it, the fix. And how urgent it is, from the audit's score.
    const p = members[0].result.properties ?? {};
    const { comment, reason } = proofWords({ title: p.title ?? members[0].title, message: members[0].result.message?.text ?? '', impact: p.impact, fix: p.fix, tests });
    let state = { marked: true, already: true };
    if (hit.verdict !== 'proven') {
      const score = Math.max(...members.map((s) => Number(s.result.properties?.score ?? 0)));
      const res = await patchFinding(inst, project, hit.id, { exploitabilityVerdict: 'proven', exploitabilitySource: 'manual', exploitabilityReason: reason }, { comment, ...(score > 0 ? { priority: priorityOf(score) } : {}) });
      state = { marked: res.ok, http: res.status, annotated: res.annotated, why: res.ok ? undefined : `the dashboard answered HTTP ${res.status}` };
    }
    for (const s of members) done.push({ ruleId: s.ruleId, uri: s.uri, line: s.line, id: hit.id, ...state });
  }
  // A lead keeps its place (a note that cannot block) and says why it is one on its own page: once per finding,
  // and never over the verdict a live replay gave it.
  const written = commentedLog(out);
  for (const [i, s] of sent.entries()) {
    const hit = pairs[i];
    if (s.tool !== AUDIT_TOOL || s.result.properties?.proven === true || !hit || byFinding.has(hit.id) || written.applied(`lead:${hit.id}`) || written.applied(`live:${hit.id}`)) continue;
    const res = await call(inst, 'PATCH', `/project/${project}/results/${hit.id}`, { json: { exploitabilityVerdict: 'theoretical', exploitabilitySource: 'manual', exploitabilityReason: leadWords(s.result.message?.text) } });
    if (res.status >= 200 && res.status < 300) written.setApplied(`lead:${hit.id}`, 'theoretical');
  }
  written.save();
  return done;
}

// ─── delivery: what the dashboard holds of what was sent ────────────────────

/**
 * For each import of the run: the results the file held, the scan's state and
 * what the dashboard counted for it; then the findings open in the dashboard
 * per type. The proof that every result reached the platform.
 */
export async function deliveryCheck(inst, { project, run, branch }) {
  const tools = (run.scans ?? [])
    .filter((x) => x.scanId)
    .map((x) => ({
      scanner: x.scanner,
      type: x.type,
      sent: Number(x.results ?? 0),
      state: x.state,
      counted: x.detected === undefined ? undefined : Number(x.detected),
      ok: ['completed', 'completed_degraded'].includes(x.state),
    }))
    .map((x) => ({ ...x, note: x.counted !== undefined && x.counted < x.sent ? 'the dashboard merges results of the same rule at the same place' : undefined }));
  const open = {};
  for (const type of [...new Set(tools.map((x) => x.type))]) {
    // Open: to verify or confirmed. Resolved findings stay in the list as history.
    let total = 0;
    for (const status of ['to_verify', 'confirmed']) {
      const res = await call(inst, 'GET', `/mcp/project/${project}/results/${type}?pageSize=1&status=${status}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`);
      if (res.status !== 200) {
        total = `HTTP ${res.status}`;
        break;
      }
      total += Number(res.data?.total ?? 0);
    }
    open[type] = total;
  }
  return { tools, open };
}

// ─── merge: one SARIF of the whole audit, and its triage ────────────────────

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];

/** One scale for every tool: security-severity first, then the tool's own word, then the SARIF level. */
export function severityOf(result, rule) {
  const s = Number(rule?.properties?.['security-severity'] ?? result?.properties?.['security-severity']);
  if (s >= 9) return 'critical';
  if (s >= 7) return 'high';
  if (s >= 4) return 'medium';
  if (s > 0) return 'low';
  const word = String(result?.properties?.issue_severity ?? '').toLowerCase();
  if (['high', 'medium', 'low'].includes(word)) return word;
  return { error: 'high', warning: 'medium', note: 'low', none: 'info' }[result?.level ?? 'warning'] ?? 'medium';
}

export function cweOf(result, rule, type) {
  const text = JSON.stringify([rule?.properties?.tags ?? [], rule?.properties?.cwe ?? '', result?.properties?.tags ?? []]);
  const m = /cwe[-_/ ]?(\d+)/i.exec(text);
  if (m) return `CWE-${m[1]}`;
  return type === 'secret' ? 'CWE-798' : null;
}

/** What to do, for scanner findings: by CWE, short, the user's code first. */
const FIX_BY_CWE = {
  'CWE-89': 'Use parameterized queries (placeholders), never string formatting, for every SQL statement.',
  'CWE-78': 'Pass a list of arguments and no shell; never build a command from input.',
  'CWE-94': 'Turn the debugger off outside development: read the setting from the environment.',
  'CWE-489': 'Turn the debugger off outside development: read the setting from the environment.',
  'CWE-798': 'Remove the secret from the code, rotate it, and read it from the environment or a secret manager.',
  'CWE-259': 'Remove the password from the code and read it from the environment or a secret manager.',
  'CWE-377': 'Use tempfile (a private file or folder), never a fixed name in /tmp.',
  'CWE-400': 'Give every outgoing HTTP call a timeout.',
  'CWE-330': 'Use the secrets module for anything security related, never random.',
  'CWE-703': 'Handle or log the error; never swallow it silently.',
  'CWE-1104': 'Upgrade the package to a fixed version.',
};

/**
 * The open findings of the dashboard (to verify, confirmed) with the severity
 * it gives them: its own scoring (CVSS 4.0 with the project's context), the
 * severity the policies judge, which may differ from the tool's.
 */
export async function openFindings(inst, { project, types, branch, statuses = ['to_verify', 'confirmed'] }) {
  const all = [];
  // This branch's findings only: without the filter the list holds every
  // branch of the project, and a feature branch would show main's twice.
  const onBranch = branch ? `&branch=${encodeURIComponent(branch)}` : '';
  for (const type of types) {
    for (const status of statuses) {
      for (let page = 1; page <= 100; page += 1) {
        const r = await call(inst, 'GET', `/mcp/project/${project}/results/${type}?pageSize=100&page=${page}&status=${status}${onBranch}`);
        // A refusal is not "no finding": a partial list would read as findings the dashboard closed.
        if (r.status !== 200) throw new Exit(3, `The dashboard did not give its ${type} findings (HTTP ${r.status}). Nothing is lost: run the same command again.`);
        const items = Array.isArray(r.data?.vulnerabilities) ? r.data.vulnerabilities : [];
        // A dependency finding has no file and line: its package, version and advisory place it.
        all.push(...items.map((v) => ({ id: v.id, type, path: v.path, line: Number(v.startLine), title: v.title, short: v.shortDescription, cwe: v.cwe ?? [], code: v.ruleCode, severity: String(v.severity ?? '').toLowerCase(), pkg: v.packageName, version: v.packageVersion, advisory: v.cve })));
        if (page >= Number(r.data?.totalPages ?? 1)) break;
      }
    }
  }
  return all;
}

/**
 * The results this run sent (scanners and audit, the types with a file and a
 * line) that the dashboard does not hold open. The Community Edition closes a
 * finding whose line moved in the import that sees it at its new line: sent
 * again, it opens again.
 */
export function closedButReported({ out, dashboard, setAside = [] }) {
  const entries = existsSync(join(out, 'manifest.tsv')) ? readManifest(join(out, 'manifest.tsv')) : [];
  const files = entries.filter((e) => e.status === 'ok' && e.file && ['sast', 'iac', 'secret', 'cicd'].includes(e.type)).map((e) => ({ tool: e.name, type: e.type, file: e.file }));
  if (existsSync(join(out, 'audit.sarif'))) files.push({ tool: AUDIT_TOOL, type: 'sast', file: join(out, 'audit.sarif') });
  // What the triage set aside is ignored on purpose: the scan still reports it, and it is not lost.
  const open = new Set([...dashboard, ...setAside].map((d) => `${d.type}|${d.path}|${d.line}`));
  const lost = [];
  for (const f of files) {
    if (!existsSync(f.file)) continue;
    const doc = JSON.parse(readFileSync(f.file, 'utf8'));
    for (const run of doc.runs ?? []) {
      const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
      for (const r of run.results ?? []) {
        if (Array.isArray(r.suppressions) && r.suppressions.length) continue;
        const loc = r.locations?.[0]?.physicalLocation;
        const uri = loc?.artifactLocation?.uri;
        const line = Number(loc?.region?.startLine);
        if (!uri || !(line >= 1)) continue;
        if (!open.has(`${f.type}|${uri}|${line}`)) lost.push({ tool: f.tool, type: f.type, ruleId: r.ruleId, where: `${uri}:${line}`, severity: severityOf(r, rules.get(r.ruleId)) });
      }
    }
  }
  return lost;
}

/** What to do, for a scanner's rule the CWE does not name: by rule id. */
const FIX_BY_RULE = [
  [/unpinned-uses/, 'Pin the action to a full commit SHA, with the version as a comment.'],
  [/template-injection/, 'Move the ${{ ... }} expression into an env: variable and read it from the shell.'],
  [/excessive-permissions/, 'Set permissions to the least the job needs, at the job level.'],
  [/dangerous-triggers/, 'Do not check out or run the pull request\'s code under pull_request_target or workflow_run.'],
  [/artipacked/, 'Add persist-credentials: false to the checkout step.'],
  [/^(DS-?0*2|CKV_DOCKER_3|CKV_DOCKER_8)$/, 'Run the container as a non-root user: add a USER line.'],
  [/^(DS-?0*26|CKV_DOCKER_2)$/, 'Add a HEALTHCHECK to the image.'],
  [/^G404$/, 'Use crypto/rand for anything security related, never math/rand.'],
  [/^G104$/, 'Handle the returned error.'],
];

/** Compares two versions number by number; anything else falls back to text. */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.\-+]/);
  const pb = String(b).replace(/^v/, '').split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The fixed version to move to: the nearest one above the installed version, in the same major when there is one. */
export function upgradeTarget(installed, fixed) {
  // A plain release when there is one: a Go pseudo-version or a pre-release is not a version to recommend.
  const plain = fixed.filter((v) => /^v?\d+(\.\d+)*(\+[\w.]+)?$/.test(v));
  const above = (plain.length ? plain : fixed).filter((v) => compareVersions(v, installed) > 0).sort(compareVersions);
  if (!above.length) return fixed[0] ?? null;
  const major = String(installed).replace(/^v/, '').split('.')[0];
  return above.find((v) => String(v).replace(/^v/, '').split('.')[0] === major) ?? above[0];
}

/** How many packages the dependency scan read (its SBOM), or null when it wrote none. */
export function packagesRead(out) {
  const file = join(out, 'trivy-fs-sbom.cdx.json');
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    return (doc.components ?? []).filter((c) => c.type === 'library').length;
  } catch {
    return null;
  }
}

/** Trivy's message for a vulnerable package: its name, the version installed, the versions that fix it. */
function packageOf(text) {
  const name = /Package: ([^\n]+)/.exec(text)?.[1]?.trim();
  const installed = /Installed Version: ([^\n]+)/.exec(text)?.[1]?.trim();
  if (!name || !installed) return null;
  const fixed = (/Fixed Version: ([^\n]*)/.exec(text)?.[1] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  return { name, installed, fixed };
}

export function mergeAudit({ out, root, dashboard = [], withAudit = true, write = true }) {
  const entries = existsSync(join(out, 'manifest.tsv')) ? readManifest(join(out, 'manifest.tsv')) : [];
  const files = entries.filter((e) => e.status === 'ok' && e.file && !['sbom', 'context'].includes(e.type)).map((e) => ({ name: e.name, type: e.type, file: e.file }));
  const auditFile = join(out, 'audit.sarif');
  if (withAudit && existsSync(auditFile)) files.push({ name: AUDIT_TOOL, type: 'sast', file: auditFile });
  if (!files.length) throw new Exit(64, `Nothing to merge in ${out}: run scan.mjs (and the audit) first.`);

  const runs = [];
  const findings = [];
  const raw = [];
  for (const f of files) {
    const doc = JSON.parse(readFileSync(f.file, 'utf8'));
    const ai = f.name === AUDIT_TOOL;
    for (const run of doc.runs ?? []) {
      const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
      const tool = run.tool?.driver?.name ?? f.name;
      for (const r of run.results ?? []) {
        const rule = rules.get(r.ruleId);
        const loc = r.locations?.[0]?.physicalLocation;
        const uri = loc?.artifactLocation?.uri ?? '';
        const line = Number(loc?.region?.startLine ?? 0);
        findings.push({
          source: ai ? 'ai-scanner' : 'scanner',
          layer: ai ? 'AI scanner (your coding agent)' : 'AppSec scanners',
          tool: ai ? AUDIT_TOOL : f.name,
          toolName: tool,
          type: f.type,
          ruleId: r.ruleId,
          title: titleOf(r, rule),
          // The AI scanner's message is the agent's own, and a lead ends on what would settle it: kept whole. A tool's message is cut at a sentence.
          message: fit(r.message?.text ?? '', ai ? 1200 : 400),
          severity: severityOf(r, rule),
          cwe: cweOf(r, rule, f.type),
          uri,
          line,
          proven: ai ? r.properties?.proven === true : null,
          score: ai && Number(r.properties?.score) > 0 ? Number(r.properties.score) : null,
          proofTest: r.properties?.proofTest ?? null,
          challenge: ai && r.properties?.challenge === 'holds' ? 'holds' : null,
          fix: r.properties?.fix ?? r.properties?.fixProposal ?? null,
          guarantee: ai ? r.properties?.guarantee ?? null : null,
          entryPoint: ai ? r.properties?.entryPoint ?? null : null,
          attack: ai ? r.properties?.attack ?? null : null,
          impact: ai ? r.properties?.impact ?? null : null,
          package: ['sca', 'container'].includes(f.type) ? packageOf(r.message?.text ?? '') : null,
        });
        raw.push({ r, rule });
      }
      run.properties = { ...(run.properties ?? {}), cybedefend: { source: ai ? 'ai-scanner' : 'scanner', importType: f.type, file: basename(f.file) } };
      runs.push(run);
    }
  }
  // The dashboard's severity when it holds the finding: one scale with the
  // verdict. A package is placed by its name, version and advisory; a result
  // in a file, by the pairing (several results can share a line).
  const placed = findings.map((f, i) => i).filter((i) => !findings[i].package);
  const pairs = pairWithDashboard(
    placed.map((i) => ({ type: findings[i].type, uri: findings[i].uri, line: findings[i].line, ruleId: findings[i].ruleId, title: findings[i].title, message: raw[i].r.message?.text ?? '', cwes: [...new Set([...(raw[i].rule?.properties?.tags ?? []).filter((t) => /^CWE-\d+$/.test(String(t))), findings[i].cwe].filter(Boolean))] })),
    dashboard,
  );
  const paired = new Map(placed.map((i, k) => [i, pairs[k]]));
  // Dependencies. The dashboard holds one finding per package, version and
  // advisory, whatever the lockfile, and names the advisory only when it is a
  // CVE (some advisories have none). So: by the advisory's id; then, for
  // an advisory without a CVE, by its title; then what is left of a package,
  // in order, when as many are left on each side.
  const ofPackage = (f) => dashboard.filter((d) => d.type === f.type && d.pkg === f.package.name && d.version === f.package.installed);
  const head = (text) => sameText(text).slice(0, 80);
  const used = new Set();
  const take = (i, hit) => {
    if (!hit) return;
    paired.set(i, hit);
    used.add(hit.id);
  };
  const packaged = findings.map((f, i) => i).filter((i) => findings[i].package);
  for (const i of packaged) {
    const f = findings[i];
    const here = ofPackage(f).filter((d) => d.advisory && d.advisory === f.ruleId);
    take(i, here.length <= 1 ? here[0] : here.find((d) => d.title === f.title || d.short === f.title) ?? here.find((d) => f.cwe && d.cwe.includes(f.cwe)) ?? here[0]);
  }
  for (const i of packaged) {
    if (paired.has(i)) continue;
    const f = findings[i];
    take(i, ofPackage(f).find((d) => !d.advisory && (head(d.title) === head(f.title) || head(d.short) === head(f.title))));
  }
  const leftByPackage = new Map();
  for (const i of packaged) {
    if (paired.has(i)) continue;
    const f = findings[i];
    const key = `${f.type}|${f.package.name}@${f.package.installed}`;
    leftByPackage.set(key, [...(leftByPackage.get(key) ?? []), i]);
  }
  for (const list of leftByPackage.values()) {
    const free = ofPackage(findings[list[0]]).filter((d) => !used.has(d.id));
    // The same advisory in two lockfiles is one finding in the dashboard: count each advisory once.
    const advisories = [...new Set(list.map((i) => findings[i].ruleId))];
    if (free.length !== advisories.length) continue;
    for (const i of list) take(i, free[advisories.indexOf(findings[i].ruleId)]);
  }
  findings.forEach((finding, i) => {
    const hit = paired.get(i);
    if (hit && SEVERITIES.includes(hit.severity)) Object.assign(finding, { toolSeverity: finding.severity, severity: hit.severity });
    finding.dashboardIds = hit?.id ? [hit.id] : [];
    raw[i].r.properties = { ...(raw[i].r.properties ?? {}), cybedefend: { source: finding.source, layer: finding.layer, tool: finding.tool, severity: finding.severity, toolSeverity: finding.toolSeverity, cwe: finding.cwe } };
  });

  // The same flaw seen by several tools (Bandit B608 and Opengrep on one SQL
  // line) is one group: same file, same line, same CWE (or same rule).
  const groups = new Map();
  let own = 0;
  for (const f of findings) {
    // A lead nobody proved stays apart: merged with a scanner's finding on the same line it would
    // lend that finding its words, and read as a lead that blocks.
    let key = f.proven === false ? `${f.uri}:${f.line}:lead:${f.ruleId}` : `${f.uri}:${f.line}:${f.cwe ?? f.ruleId}`;
    // Each proven finding of the AI scanner has its own test: it joins what the scanners saw at
    // that place, never another finding of its own.
    if (f.proven === true && groups.get(key)?.foundBy.includes(AUDIT_TOOL)) key = `${key}:${(own += 1)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...f, foundBy: [f.tool], count: 1 });
      continue;
    }
    g.count += 1;
    g.dashboardIds = [...new Set([...(g.dashboardIds ?? []), ...(f.dashboardIds ?? [])])];
    if (!g.foundBy.includes(f.tool)) g.foundBy.push(f.tool);
    if (SEVERITIES.indexOf(f.severity) < SEVERITIES.indexOf(g.severity)) g.severity = f.severity;
    if (f.source === 'ai-scanner') Object.assign(g, { source: f.source, layer: f.layer, title: f.title, message: f.message, proven: f.proven, proofTest: f.proofTest, challenge: f.challenge, toolSeverity: f.toolSeverity, fix: f.fix ?? g.fix, attack: f.attack, impact: f.impact, guarantee: f.guarantee, entryPoint: f.entryPoint });
  }
  const fixFor = (g) => g.fix ?? FIX_BY_CWE[g.cwe] ?? FIX_BY_RULE.find(([re]) => re.test(String(g.ruleId ?? '').replace(/^.*\//, '')) || re.test(String(g.ruleId ?? '')))?.[1] ?? null;
  const triage = [...groups.values()]
    .map((g) => ({ ...g, fix: fixFor(g), byAiScanner: g.foundBy.includes(AUDIT_TOOL), byScanners: g.foundBy.filter((t) => t !== AUDIT_TOOL), alsoFoundBy: g.foundBy.slice(1) }))
    // The most severe first; then what a test proves, the AI scanner's highest score first.
    .sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (b.proven === true) - (a.proven === true) || (b.score ?? 0) - (a.score ?? 0) || b.foundBy.length - a.foundBy.length || a.uri.localeCompare(b.uri) || a.line - b.line);

  // Vulnerable dependencies, one line per package to upgrade: a package with
  // nine advisories is one thing to do, not nine findings to read.
  const byPackage = new Map();
  for (const g of triage) {
    if (!g.package) continue;
    const key = `${g.uri}|${g.package.name}@${g.package.installed}`;
    const p = byPackage.get(key) ?? { package: g.package.name, installed: g.package.installed, lockfile: g.uri, severity: g.severity, advisories: 0, withoutFix: 0, upgradeTo: null };
    p.advisories += 1;
    if (SEVERITIES.indexOf(g.severity) < SEVERITIES.indexOf(p.severity)) p.severity = g.severity;
    const target = upgradeTarget(g.package.installed, g.package.fixed);
    if (!target) p.withoutFix += 1;
    else if (!p.upgradeTo || compareVersions(target, p.upgradeTo) > 0) p.upgradeTo = target;
    byPackage.set(key, p);
  }
  const packages = [...byPackage.values()].sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.advisories - a.advisories || a.package.localeCompare(b.package));
  const code = triage.filter((g) => !g.package);

  const full = { version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json', runs };
  if (write) writeFileSync(join(out, 'cybedefend-full.sarif'), `${JSON.stringify(full, null, 2)}\n`);
  const count = (pred) => triage.filter(pred).length;
  const summary = {
    findings: findings.length,
    afterGrouping: triage.length,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, count((g) => g.severity === s)])),
    // "dashboard": the severities are the dashboard's, the ones its policies judge; "tools": each tool's own.
    severityFrom: findings.some((f) => f.toolSeverity) ? 'dashboard' : 'tools',
    // A flaw both layers saw counts in both, and once in "both".
    bySource: { scanners: count((g) => g.byScanners.length > 0), aiScanner: count((g) => g.byAiScanner), both: count((g) => g.byAiScanner && g.byScanners.length > 0), aiScannerProven: count((g) => g.proven === true), aiScannerLeads: count((g) => g.proven === false) },
    inTheCode: code.length,
    // packagesRead 0: the dependency scan had no lockfile to read, which is not a clean result.
    dependencies: { advisories: triage.length - code.length, packages: packages.length, packagesRead: packagesRead(out) },
    // What no scanner saw: proven by the AI scanner alone, the most severe first.
    onlyAiScanner: triage
      .filter((g) => g.proven === true && g.byScanners.length === 0)
      .map((g) => ({ severity: g.severity, title: g.title, where: `${g.uri}:${g.line}`, proofTest: g.proofTest })),
    tools: files.map((f) => f.name),
    files: { sarif: join(out, 'cybedefend-full.sarif'), triage: join(out, 'triage.json'), report: join(out, 'triage.md') },
  };
  const merged = { summary, top: code.slice(0, 12), triage, packages };
  if (write) writeTriage({ out, root, merged });
  return merged;
}

/** triage.json and triage.md, from the merged audit. */
export function writeTriage({ out, root, merged }) {
  const { summary, triage, packages, broughtInBy = [] } = merged;
  writeFileSync(join(out, 'triage.json'), `${JSON.stringify({ summary, triage, packages, broughtInBy }, null, 2)}\n`);
  writeFileSync(join(out, 'triage.md'), triageMarkdown(summary, triage.filter((g) => !g.package && !g.setAside), packages.filter((p) => !p.setAside), root, broughtInBy));
}

/**
 * Marks, in the merged audit, what the policies block: each finding of the
 * verdict is found again in the triage (who found it, its proof, its fix),
 * and a vulnerable package gets the dependency that brings it in, from the
 * path the dashboard gives ("package-lock.json→express@4→qs@6.5"). Returns
 * what blocks in a form short enough to read: the code findings one by one,
 * the dependencies per package.
 */
export function markBlocking({ merged, blocking, dashboard = [] }) {
  const { triage, packages } = merged;
  for (const p of packages) p.blocking = 0;
  const code = [];
  // One line per flaw: a line that Opengrep, Bandit and the AI scanner all report is three findings in the dashboard and one thing to fix.
  const byGroup = new Map();
  let findings = 0;
  let advisories = 0;
  let unplaced = 0;
  // The policies judge every open finding of the project, the ones of other
  // branches too (seen on a two-branch project): what this branch's
  // run did not report is counted apart, never shown as a second finding.
  const here = new Set(dashboard.map((d) => d.id));
  let elsewhere = 0;
  for (const b of blocking) {
    for (const f of b.findings ?? []) {
      if (here.size && f.id && !here.has(f.id)) {
        elsewhere += 1;
        continue;
      }
      const file = String(f.file ?? '');
      if (['sca', 'container'].includes(f.type) || file.includes('→')) {
        advisories += 1;
        // The dashboard's own id places it; the path it gives, when it gives
        // one ("package-lock.json→express@4→qs@6.5"), says what brings it in.
        const parts = file.split('→').map((x) => x.trim());
        const byId = triage.find((x) => x.package && (x.dashboardIds ?? []).includes(f.id));
        const p = byId
          ? packages.find((x) => x.lockfile === byId.uri && x.package === byId.package.name && x.installed === byId.package.installed)
          : packages.find((x) => parts.length > 1 && x.lockfile === parts[0] && `${x.package}@${x.installed}` === parts[parts.length - 1]);
        if (!p) {
          unplaced += 1;
          continue;
        }
        p.blocking += 1;
        if (parts.length > 2) p.via = parts[1];
        else if (!p.via) p.via = parts.length === 2 ? 'a direct dependency' : undefined;
        continue;
      }
      const placed = triage.filter((g) => !g.package && (f.type === undefined || g.type === f.type) && g.uri === file && (f.line === undefined || g.line === Number(f.line)));
      const g = triage.find((x) => !x.package && (x.dashboardIds ?? []).includes(f.id)) ?? (placed.length === 1 ? placed[0] : placed.find((x) => x.title === f.name) ?? placed[0]);
      if (g) g.blocks = true;
      // Two proofs of one rule on one line are one finding in the dashboard: both block with it.
      if (f.id) for (const x of triage) if (!x.package && (x.dashboardIds ?? []).includes(f.id)) x.blocks = true;
      findings += 1;
      const known = g ? byGroup.get(g) : undefined;
      if (known) {
        known.findings += 1;
        if (f.id) known.ids.push(f.id);
        const sev = String(f.severity ?? '').toLowerCase();
        if (SEVERITIES.includes(sev) && SEVERITIES.indexOf(sev) < SEVERITIES.indexOf(known.severity)) known.severity = sev;
        continue;
      }
      const entry = {
        severity: String(f.severity ?? g?.severity ?? '').toLowerCase(),
        what: g?.title ?? f.name,
        where: `${file}${f.line ? `:${f.line}` : ''}`,
        foundBy: g ? (g.byAiScanner ? (g.byScanners.length ? `AI scanner, and ${g.byScanners.join(', ')}` : 'AI scanner alone') : g.byScanners.join(', ')) : f.type,
        proofTest: g?.proofTest ?? undefined,
        message: g?.byAiScanner ? g.message : undefined,
        fix: g?.fix ?? undefined,
        assessment: g?.assessment ? `${g.assessment.verdict}: ${g.assessment.reason}` : undefined,
        rule: b.rule,
        id: f.id,
        ids: f.id ? [f.id] : [],
        findings: 1,
      };
      if (g) byGroup.set(g, entry);
      code.push(entry);
    }
  }
  // The most severe first; at the same severity, what a test proves before what a tool reports, and what the agent judged out of reach last.
  const out = (f) => (String(f.assessment ?? '').startsWith('not_exploitable') ? 1 : 0);
  code.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || (b.proofTest ? 1 : 0) - (a.proofTest ? 1 : 0) || out(a) - out(b));
  const deps = packages.filter((p) => p.blocking > 0).map((p) => ({ package: p.package, installed: p.installed, upgradeTo: p.upgradeTo, advisories: p.blocking, severity: p.severity, broughtInBy: p.via, lockfile: p.lockfile, assessment: p.assessment ? `${p.assessment.verdict}: ${p.assessment.reason}` : undefined }));
  // Which dependency of the project brings them in: one upgrade there often clears many lines of the list.
  const bringers = new Map();
  for (const d of deps) {
    if (!d.broughtInBy) continue;
    const b = bringers.get(d.broughtInBy) ?? { dependency: d.broughtInBy, packages: 0, advisories: 0 };
    b.packages += 1;
    b.advisories += d.advisories;
    bringers.set(d.broughtInBy, b);
  }
  const broughtInBy = [...bringers.values()].sort((a, b) => b.advisories - a.advisories);
  merged.broughtInBy = broughtInBy;
  return { code, findings, elsewhere, dependencies: { advisories, packages: deps.length, unplaced, broughtInBy: broughtInBy.slice(0, 8), upgrades: deps } };
}

function triageMarkdown(summary, code, packages, root, broughtInBy = []) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const who = (g) => (g.byAiScanner ? (g.byScanners.length ? `AI scanner, and ${g.byScanners.join(', ')}` : 'AI scanner alone') : g.byScanners.join(', '));
  const assessed = (a) => (a ? `${a.verdict.replace('_', ' ')}: ${cell(a.reason)}` : '');
  const proof = (g) => (g.proven === true ? `test \`${cell(g.proofTest?.split(' > ').pop())}\`` : g.proven === false ? 'lead, not proven' : assessed(g.assessment));
  const dep = summary.dependencies;
  const lines = [
    `# CybeDefend audit: ${basename(root)}`,
    '',
    `${summary.findings} results from ${summary.tools.length} tools, ${summary.afterGrouping} after grouping the same flaw seen by several tools: ${summary.inTheCode} in the code and its configuration, ${dep.advisories} advisories on ${dep.packages} vulnerable package${dep.packages === 1 ? '' : 's'}.`,
    `Critical ${summary.bySeverity.critical}, high ${summary.bySeverity.high}, medium ${summary.bySeverity.medium}, low ${summary.bySeverity.low}${summary.severityFrom === 'dashboard' ? ', as the dashboard rates them (its own scoring, with the project\'s context): the severity its policies judge' : ', as each tool rates them'}.`,
    `The AI scanner found ${summary.bySource.aiScanner}: ${summary.bySource.aiScannerProven} proven by a failing test (${summary.onlyAiScanner.length} of them seen by no scanner), ${summary.bySource.aiScannerLeads} lead${summary.bySource.aiScannerLeads === 1 ? '' : 's'} not proven. The AppSec scanners found ${summary.bySource.scanners}.`,
    ...(summary.triage?.scannerFindings ? [`The triage judged ${summary.triage.judged} of the ${summary.triage.scannerFindings} findings of the scanners against this code: ${summary.triage.kept - summary.triage.notJudged} kept as true positives (${summary.triage.proven} proven, ${summary.triage.reachable} reachable), ${summary.triage.setAside} set aside because this code cannot reach them. The tables below hold what was kept.`] : []),
    '',
    `## In the code and its configuration (${code.length})`,
    '',
    '| Severity | Blocks | Found by | Flaw | Where | Proof, or the agent\'s assessment | What to do |',
    '|---|---|---|---|---|---|---|',
    ...code.map((g) => `| ${g.severity} | ${g.blocks ? 'yes' : ''} | ${cell(who(g))} | ${cell(g.title)} | \`${cell(g.uri)}:${g.line}\` | ${proof(g)} | ${cell(g.fix ?? '')} |`),
    '',
  ];
  if (packages.length) {
    lines.push(
      `## Vulnerable dependencies (${dep.advisories} advisories, ${packages.length} package${packages.length === 1 ? '' : 's'} to upgrade)`,
      '',
      ...(broughtInBy.filter((b) => b.dependency && b.dependency !== 'a direct dependency').length
        ? [`What blocks comes in through: ${broughtInBy.filter((b) => b.dependency && b.dependency !== 'a direct dependency').slice(0, 5).map((b) => `\`${cell(b.dependency)}\` (${b.advisories} advisories on ${b.packages} package${b.packages === 1 ? '' : 's'})`).join(', ')}. Upgrading or replacing that dependency clears them together.`, '']
        : []),
      '| Severity | Package | Installed | Upgrade to | Advisories | Blocks | Brought in by | The agent\'s assessment | Lockfile |',
      '|---|---|---|---|---|---|---|---|---|',
      ...packages.map((p) => `| ${p.severity} | ${cell(p.package)} | ${cell(p.installed)} | ${cell(shownUpgrade(p.upgradeTo))}${p.upgradeTo && p.withoutFix ? ` (${p.withoutFix} without a fix yet)` : ''} | ${p.advisories} | ${p.blocking ? `yes (${p.blocking})` : p.blocking === 0 ? 'no' : ''} | ${cell(p.via ?? '')} | ${assessed(p.assessment)} | \`${cell(p.lockfile)}\` |`),
      '',
    );
  }
  const t = summary.triage;
  if (t?.setAside) {
    lines.push(
      `## Set aside by the triage (${t.setAside} findings of the scanners)`,
      '',
      'Judged against this code and found out of reach. Each is in the dashboard under the status "ignored", with the reason below: the policies do not count it, and anyone can open it again there.',
      '',
      '| Findings | Why | For example |',
      '|---|---|---|',
      ...t.setAsideReasons.map((r) => `| ${r.findings} | ${cell(r.reason)} | ${cell(r.examples.join(', '))} |`),
      '',
    );
  }
  if (t?.notJudged) lines.push(`## Not judged (${t.notJudged})`, '', `These findings of the scanners got no verdict: they stay open as their tool reported them. ${cell(t.notJudgedFirst.join(', '))}${t.notJudged > t.notJudgedFirst.length ? ', and more' : ''}.`, '');
  return lines.join('\n');
}

// ─── Triage: every finding of the scanners, judged against this code ────────
//
// A scanner reports a pattern; whether this code can be reached through it is
// a judgment. The agent writes one verdict for every finding of the scanners
// in .cybedefend/out/assessments.json, and finish applies it in the dashboard
// before the policies give their verdict: what this code cannot reach is set
// aside (status "ignored", with the agent's reason in the audit trail: what
// the dashboard counts as a false positive, and what its policies skip); what
// is kept carries its exploitability, which sets its priority. A secret is
// never set aside, nor a finding the AI scanner proved.

export const ASSESSMENT_VERDICTS = ['not_exploitable', 'theoretical', 'proven'];
/** The dashboard's priorities, the most urgent first (gateway, update-vuln-body.dto.ts). */
export const PRIORITIES = ['critical_urgent', 'urgent', 'normal', 'low', 'very_low'];
/** A proven flaw's priority, from the score the audit gave it. */
export const priorityOf = (score) => (score >= 9 ? 'critical_urgent' : score >= 7 ? 'urgent' : score >= 4 ? 'normal' : 'low');

/**
 * The analysis the agent leaves on a finding goes to the dashboard as a
 * comment, once: this file remembers which finding got which, so a second
 * finish adds no second comment. { "<finding id>": "<verdict>" }
 */
function commentedLog(out) {
  const file = out ? join(out, 'commented.json') : null;
  let seen = {};
  try {
    if (file) seen = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* nothing commented yet */
  }
  return {
    has: (id, verdict) => seen[id] === verdict,
    add: (id, verdict) => {
      seen[id] = verdict;
    },
    // What a run already wrote on a finding (its verdict and its priority): the next finish, of this scan or of a
    // later one, writes it again nowhere, so the finding's history holds each change once and a change a person
    // made on the dashboard since stands.
    applied: (id) => seen['#applied']?.ids?.[id],
    setApplied: (id, state) => {
      if (!seen['#applied']?.ids) seen['#applied'] = { ids: {} };
      seen['#applied'].ids[id] = state;
    },
    save: () => {
      try {
        if (file) writeFileSync(file, `${JSON.stringify(seen)}\n`);
      } catch {
        /* the comments are in the dashboard either way */
      }
    },
  };
}

/**
 * What the triage leaves on a finding in the dashboard: for one it keeps, the
 * comment a person reads in its history (512 characters) and the reason next
 * to its exploitability (1,000); for one it sets aside, the reason of the
 * dismissal (512). Whole sentences, signed once.
 */
export function triageWords({ verdict, reason, live, proofTest }) {
  const why = withStop(String(reason ?? '').replace(/\s+/g, ' ').trim());
  if (verdict === 'not_exploitable') return { dismissal: fit(`Set aside after the coding agent's review (/cybedefend): ${why}`, 512) };
  const shown = verdict === 'proven';
  const head = shown ? (live ? `Seen live on the application started on this machine (probe ${live}).` : `Proven by the test "${testNameOf(proofTest)}".`) : 'This code can be reached.';
  return {
    comment: fit(`Reviewed by the coding agent (/cybedefend) and kept: ${shown ? 'a test shows it' : 'this code can be reached'}. ${why}`, 512),
    reason: fit(`${head} ${why}`, 1000),
  };
}

/**
 * A PATCH that carries a comment or a priority: when the dashboard refuses them, the verdict still goes.
 * The priority goes in a request of its own, after the verdict: the dashboard derives a priority from a
 * verdict in the same request, and one request with both writes the same change twice in the finding's
 * history. Sent alone, it is written only when it differs from the one the dashboard derived.
 * Returns { ok, status, annotated (the comment went), prioritized (the priority went) }.
 */
export async function patchFinding(inst, project, id, core, extra = {}) {
  const { priority, ...rest } = extra;
  const good = (r) => r.status >= 200 && r.status < 300;
  const withExtra = Object.keys(rest).length > 0;
  let res = await call(inst, 'PATCH', `/project/${project}/results/${id}`, { json: { ...core, ...rest } });
  let annotated = withExtra && good(res);
  if (withExtra && res.status >= 400 && res.status < 500 && res.status !== 404 && res.status !== 429) {
    res = await call(inst, 'PATCH', `/project/${project}/results/${id}`, { json: core });
    annotated = false;
  }
  let prioritized = false;
  if (priority && good(res)) prioritized = good(await call(inst, 'PATCH', `/project/${project}/results/${id}`, { json: { priority } }));
  return { ok: good(res), status: res.status, annotated, prioritized };
}

/**
 * What sets a finding aside in the dashboard: the reason of the dismissal, which its export keeps, and the same
 * sentence as a comment, which is what a person reads in the finding's history next to "ignored".
 */
export function asideItem(id, assessment) {
  const reason = triageWords(assessment).dismissal;
  return { vulnerabilityId: id, status: 'ignored', dismissalReason: reason, comment: reason };
}

// What is not the application's code: the audit's files, the proof tests, the skill, the documentation.
const NOT_CODE = /(^|\/)\.cybedefend\/|(^|\/)skills\/cybedefend\/|(^|\/)skills-lock\.json$|(^|\/)tests?\/security\/|(^|\/)test_security_[^/]*$|\.security\.test\.[^/]*$|_security_test\.go$|security_spec\.rb$|\.(md|txt|rst|adoc)$/;

/**
 * When the repository's own code last changed since its last commit, in
 * milliseconds: the newest of the files whose content differs from that
 * commit (edited, added, not yet in git), without the audit's files, the
 * proof tests, the skill and the documentation. A file written again as it
 * was (a checkout, a lock file a tool rewrites while the application starts)
 * is no change. 0 when nothing differs, or when it cannot be told (no git).
 */
export function lastCodeChange(root) {
  let fields;
  try {
    fields = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0');
  } catch {
    return 0;
  }
  let newest = 0;
  for (let i = 0; i < fields.length; i += 1) {
    const entry = fields[i];
    if (entry.length < 4) continue;
    // A renamed or copied file is followed by the name it had.
    if (/[RC]/.test(entry.slice(0, 2))) i += 1;
    const name = entry.slice(3);
    if (NOT_CODE.test(name)) continue;
    // A file that is gone: the folder it was in says when.
    let at = join(root, name);
    while (at.length > root.length && !existsSync(at)) at = dirname(at);
    try {
      const t = statSync(at).mtimeMs;
      if (t > newest) newest = t;
    } catch {
      /* gone since git listed it */
    }
  }
  return newest;
}

/** True when a commit made after `head` changed the application's code (or when git no longer knows `head`). */
function codeCommittedSince(root, head) {
  if (!head) return false;
  try {
    const git = (args) => runGit(args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (git(['rev-parse', 'HEAD']).trim() === head) return false;
    return git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', head, 'HEAD']).split('\0').filter(Boolean).some((name) => !NOT_CODE.test(name));
  } catch {
    return true;
  }
}

/**
 * The probes of the live step (live.mjs), from .cybedefend/out/live.json;
 * none when it did not run. With `root`, each probe says whether the code
 * changed after it (`stale`): a replay made before a fix shows what the
 * application answered then, not what it answers now. The code changed when
 * a commit made since the probe touched it (the probe keeps the commit it
 * ran on), or when a file that differs from the last commit is newer than
 * the probe.
 */
export function liveProbes(out, root) {
  let probes;
  try {
    const doc = JSON.parse(readFileSync(join(out, 'live.json'), 'utf8'));
    // live.mjs numbers each probe and keeps the HTTP status it got: an entry with anything else there was not written by it.
    probes = (Array.isArray(doc.probes) ? doc.probes : []).filter((p) => Number.isSafeInteger(p?.id) && Number.isSafeInteger(p?.response?.status) && p?.request && typeof p.request === 'object');
  } catch {
    return [];
  }
  if (!root || !probes.length) return probes;
  // A replay made again put the earlier one aside (live.mjs begin): its requests keep their numbers in the file and are not shown.
  probes = probes.filter((p) => !p.replaced);
  if (!probes.length) return probes;
  const changed = lastCodeChange(root);
  const committed = new Map();
  const since = (head) => {
    if (!committed.has(head)) committed.set(head, codeCommittedSince(root, head));
    return committed.get(head);
  };
  return probes.map((p) => ({ ...p, stale: since(p.head ?? null) || (changed > 0 && Date.parse(p.at ?? '') < changed) }));
}

/**
 * Opens a page in the user's browser and waits until the opener has handed
 * it over, three seconds at most: the next page then comes after this one,
 * however busy the machine is. Never throws; false when there is no opener.
 */
function openInOrder(target, ms = 3000) {
  return new Promise((done) => {
    const [cmd, args] = openCommand(target);
    let child;
    try {
      child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    } catch {
      done(false);
      return;
    }
    const timer = setTimeout(() => {
      child.unref();
      done(true);
    }, ms);
    child.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
    // A moment after the opener is done, for the browser to place the tab.
    child.on('exit', () => {
      clearTimeout(timer);
      setTimeout(() => done(true), 150);
    });
  });
}

/** What the live step left in live.json besides its probes: the application it ran and its last cleanup check; null when it did not run. */
export function liveStep(out) {
  try {
    const doc = JSON.parse(readFileSync(join(out, 'live.json'), 'utf8'));
    return { app: doc.app ?? null, last: doc.last ?? null, left: doc.left ?? null, begun: Boolean(doc.before) };
  } catch {
    return null;
  }
}

/**
 * The lines of the block `finish` prints after a replay, for the agent to
 * copy as they are: the line LIVE (what the audit page holds), the
 * application that ran, and what the step left on the machine, each said
 * from what live.mjs wrote down and never from memory.
 */
export function liveBlock(step, liveLine) {
  const lines = [liveLine];
  const names = (list) => list.slice(0, 4).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
  if (step.app) lines.push(`The application: still running on http://localhost:${step.app.port}. Run "live.mjs stop" before you answer.`);
  else if (step.last) lines.push(`The application: started here by this step (${step.last.command}) on http://localhost:${step.last.port}, ${step.last.stopped === false ? 'and something still answers on that port' : 'stopped since'}.`);
  const left = step.left;
  if (!left) lines.push(`Cleanup: not checked. Run "live.mjs left" before you say the machine is as it was.`);
  else if (left.clean) lines.push('Cleanup: nothing of this step is left, the repository and Docker hold what they held before it.');
  else {
    const still = [...(left.containers ?? []).map((c) => `container ${c}`), ...(left.volumes ?? []).map((v) => `volume ${v}`), ...(left.env ?? []), ...(left.files ?? []).map((f) => f.trim().replace(/^\S+\s+/, ''))];
    lines.push(`Cleanup: not done, still there: ${names(still)}. Remove them, then run "live.mjs left".`);
  }
  if (left?.built?.length) lines.push(`Built by this step, ignored by git, kept for the next start: ${names(left.built)}.`);
  if (left?.images?.length) lines.push(`Pulled by this step, stays on the machine: the image ${names(left.images)}.`);
  return lines;
}

// ─── lines: a finding kept from the last audit follows its line ─────────────

const hashOf = (text) => createHash('sha1').update(text).digest('hex').slice(0, 16);

/** The hash of a line's text, and of that line with its two neighbours; null when the line is not there. */
function lineMarks(lines, n) {
  if (!(n >= 1) || n > lines.length) return null;
  const at = (k) => (lines[k - 1] ?? '').trim();
  return { line: hashOf(at(n)), context: hashOf(`${at(n - 1)}\n${at(n)}\n${at(n + 1)}`) };
}

/** The lines of a file of the repository, or null (missing, outside the repository, too large). */
function sourceLines(root, uri, cache) {
  if (!cache.has(uri)) {
    let lines = null;
    try {
      const path = insideRoot(root, resolve(root, uri));
      if (path && statSync(path).size <= 5_000_000) lines = readFileSync(path, 'utf8').split('\n');
    } catch {
      /* not there */
    }
    cache.set(uri, lines);
  }
  return cache.get(uri);
}

/**
 * Stamps each result of an audit file with the marks of the line it points
 * at (properties.lineHash, contextHash): hashes, never the text. The next
 * run follows a kept finding to its new line with them.
 */
export function stampLines(doc, root) {
  const cache = new Map();
  for (const r of doc.runs?.[0]?.results ?? []) {
    const loc = r.locations?.[0]?.physicalLocation;
    const lines = sourceLines(root, loc?.artifactLocation?.uri ?? '', cache);
    const marks = lines ? lineMarks(lines, Number(loc?.region?.startLine)) : null;
    if (marks) r.properties = { ...(r.properties ?? {}), lineHash: marks.line, contextHash: marks.context };
  }
  return doc;
}

/**
 * Moves a result kept from the last audit to where its line is now. Returns
 * 'same'; 'moved'; 'unsure' (moved to the nearest of several lines that read
 * the same); 'changed' (no line reads like it anymore: its line is to
 * check); 'gone' (no such file); 'unknown' (an audit file without marks).
 */
export function followLine(result, root, cache = new Map()) {
  const loc = result.locations?.[0]?.physicalLocation;
  const uri = loc?.artifactLocation?.uri;
  const old = Number(loc?.region?.startLine);
  const { lineHash, contextHash } = result.properties ?? {};
  if (!uri || !(old >= 1) || !lineHash) return 'unknown';
  const lines = sourceLines(root, uri, cache);
  if (!lines) return 'gone';
  const now = lineMarks(lines, old);
  if (now && now.line === lineHash && (!contextHash || now.context === contextHash)) return 'same';
  const marks = lines.map((_, k) => lineMarks(lines, k + 1));
  const numbers = (pred) => marks.flatMap((m, k) => (pred(m) ? [k + 1] : []));
  const nearest = (list) => list.reduce((best, n) => (Math.abs(n - old) < Math.abs(best - old) ? n : best));
  const byContext = contextHash ? numbers((m) => m.context === contextHash) : [];
  const byLine = numbers((m) => m.line === lineHash);
  let to;
  let sure = true;
  if (byContext.length) to = nearest(byContext);
  // Its neighbours changed and the line itself did not move.
  else if (now && now.line === lineHash) return 'same';
  else if (byLine.length === 1) [to] = byLine;
  else if (byLine.length > 1) {
    to = nearest(byLine);
    sure = false;
  } else return 'changed';
  if (to === old) return 'same';
  if (Number(loc.region.endLine) >= old) loc.region.endLine = Number(loc.region.endLine) + (to - old);
  loc.region.startLine = to;
  return sure ? 'moved' : 'unsure';
}

/**
 * The triage files: `assessments.json`, and one `assessments-<part>.json` for
 * each sub-agent when the triage was split. They are read together.
 */
export function assessmentFiles(out) {
  if (!existsSync(out)) return [];
  const names = readdirSync(out).filter((f) => /^assessments(-[A-Za-z0-9._]+(?:-[A-Za-z0-9._]+)*)?\.json$/.test(f));
  return names.sort((a, b) => (a === 'assessments.json' ? -1 : b === 'assessments.json' ? 1 : a.localeCompare(b)));
}

/**
 * Reads and checks the triage files (assessmentFiles). Returns { list,
 * problems, files }; no file is an empty list. An entry names what it judges:
 *   "where": "file:line" (and "rule")      one finding in the code
 *   "under": "folder/" (and "rule")        every code finding under that path
 *   "rule": "<rule>" alone                 every finding of that rule
 *   "package": "name@version"              every advisory on that package
 *   "packages": ["a@1", "b@2"]             the same judgment for several packages
 *   "lockfile": "app/package-lock.json"    every package of that lockfile
 * The most precise entry wins for a finding: one finding or one package, then
 * a list of packages or a rule, then what comes in through a dependency, then
 * a folder or a lockfile.
 */
export function readAssessments(out, { root = null, accept = undefined } = {}) {
  const files = [];
  const problems = [];
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  // Verdicts nobody gave on this machine: listed with a digest of what they are, and applied only when the user
  // gives that digest back (--accept-verdicts <digest>), at the lowest precision, and never on everything.
  const fromFiles = { applied: 0, refused: 0, held: [], digest: null, accepted: false, files: [] };
  const last = root ? lastTriage(root) : null;
  // Each triage file, read once: what is read is what is judged, and what the digest names.
  const docs = assessmentFiles(out).map((name) => {
    let content = null;
    try {
      content = readFileSync(join(out, name), 'utf8');
    } catch {
      /* gone since it was listed */
    }
    // The agent's triage reaches the skill through `assess --save`, which remembers it: any other content came from elsewhere.
    return { name, content, ours: !root || (content !== null && remembered(root, `out/${name}`, content)) };
  });
  const parse = (d) => {
    try {
      const doc = JSON.parse(d.content);
      return Array.isArray(doc) ? doc : doc?.assessments;
    } catch {
      return null;
    }
  };
  const label = (a) => text(a?.where) || text(a?.package) || (Array.isArray(a?.packages) ? a.packages.join(', ') : '') || text(a?.through) || text(a?.lockfile) || (typeof a?.under === 'string' ? `under "${a.under}"` : '') || text(a?.rule) || '(nothing named)';
  if (last?.held) fromFiles.held.push(last.held);
  for (const d of docs.filter((x) => !x.ours && x.content !== null)) {
    const raw = parse(d);
    fromFiles.held.push(heldFile(`.cybedefend/out/${d.name}`, (Array.isArray(raw) ? raw : []).map((a) => ({ what: label(a), verdict: String(a?.verdict ?? '') })), sha256(d.content)));
  }
  if (fromFiles.held.length) fromFiles.digest = sha256(JSON.stringify(fromFiles.held.map((h) => [h.file, h.sha256]).sort())).slice(0, 16);
  if (accept !== undefined && accept !== false && fromFiles.held.length) {
    if (accept === true || typeof accept !== 'string') problems.push(`--accept-verdicts takes the digest printed with the list of verdicts it applies (--accept-verdicts ${fromFiles.digest}): nothing of them is applied without it`);
    else if (accept !== fromFiles.digest) problems.push(`--accept-verdicts ${accept}: the verdicts found in files this machine did not write changed since that digest was printed (it is ${fromFiles.digest} now): nothing of them is applied. Show the user the new list before they accept it.`);
    else fromFiles.accepted = true;
  }
  const list = [];
  // The verdicts of the last run that still stand come first: at the same precision, an entry of this run wins.
  if (last && !last.held) list.push(...last.list);
  // Then what the user accepted from files this machine did not write: below every entry of this run, whatever their shape.
  const foreignList = [];
  if (fromFiles.accepted) {
    fromFiles.files = fromFiles.held.map((h) => h.file);
    fromFiles.held = [];
    if (last?.held) {
      const accepted = lastTriage(root, { accept: true });
      foreignList.push(...accepted.list.map((a) => ({ ...a, rank: FOREIGN_RANK })));
      fromFiles.applied += accepted.stand;
    }
  }
  const ownList = [];
  let entry = 0;
  for (const d of docs) {
    if (!d.ours && !fromFiles.accepted) continue;
    if (d.content === null) continue;
    files.push(d.name);
    const raw = parse(d);
    if (!Array.isArray(raw)) {
      let json = true;
      try {
        JSON.parse(d.content);
      } catch {
        json = false;
      }
      problems.push(json ? `${d.name} holds { "assessments": [ ... ] }` : `${d.name} is not JSON`);
      continue;
    }
    const into = d.ours ? ownList : foreignList;
    raw.forEach((a, i) => {
      entry += 1;
      const at = docs.length > 1 ? `${d.name}, assessment ${i + 1}` : `assessment ${i + 1}`;
      const rule = text(a?.rule) || undefined;
      let targets = null;
      if (text(a?.package)) targets = [{ package: text(a.package), rank: 3 }];
      else if (Array.isArray(a?.packages) && a.packages.length && a.packages.every((x) => text(x))) targets = a.packages.map((x) => ({ package: text(x), rank: 2 }));
      else if (text(a?.through)) targets = [{ through: text(a.through), rank: 1.5 }];
      else if (text(a?.lockfile)) targets = [{ lockfile: text(a.lockfile).replace(/^\.\//, ''), rank: 1 }];
      else if (text(a?.where)) targets = [{ where: text(a.where), rule, rank: 3 }];
      else if (typeof a?.under === 'string') targets = [{ under: a.under.trim().replace(/^\.\//, ''), rule, rank: rule ? 2 : 1 }];
      else if (rule) targets = [{ under: '', rule, rank: 2 }];
      if (!targets) return problems.push(`${at}: it names what it judges: "where" (file:line, with "rule" when several are on that line), "under" (a folder, with or without "rule"), "rule" alone, "package" (name@version), "packages" (a list of them), "through" (a dependency and what it brings in) or "lockfile"`);
      for (const t of targets) {
        if (t.where && !/:\d+$/.test(t.where)) return problems.push(`${at}: "where" is file:line`);
      }
      // From a file this machine did not write, an entry on the whole repository (a rule everywhere, every finding) is never applied.
      if (!d.ours && targets.some((t) => t.under !== undefined && ['', '.', '/'].includes(t.under.replace(/\/+$/, '') || ''))) {
        fromFiles.refused += 1;
        return undefined;
      }
      if (!ASSESSMENT_VERDICTS.includes(a.verdict)) return problems.push(`${at}: "verdict" is one of ${ASSESSMENT_VERDICTS.join(', ')}`);
      const reason = text(a.reason);
      if (reason.length < 30) return problems.push(`${at}: "reason" says what you checked and what you found (the search you ran, the file and line that protects it), in a sentence or two`);
      // What is kept stays in front of the team: its reason is the comment they read on the finding.
      if (a.verdict !== 'not_exploitable' && reason.length < 80) return problems.push(`${at}: "reason", for a finding you keep, is the comment the team reads on it: what it means in this code (the function and the data, never the rule's name), how an input gets there, and what to change, in two or three sentences`);
      const live = Number.isInteger(a.live) && a.live > 0 ? a.live : null;
      const priority = text(a.priority) || undefined;
      if (priority && !PRIORITIES.includes(priority)) return problems.push(`${at}: "priority" is one of ${PRIORITIES.join(', ')}, or left out`);
      const one = targets.length === 1 && (targets[0].where || (targets[0].package && targets[0].package.slice(1).includes('@')));
      if (a.verdict === 'proven' && !one) return problems.push(`${at}: proven is for one finding ("where") or one package ("package"): a test or a live request shows one thing`);
      if (a.verdict === 'proven' && !live && !text(a.proofTest)) return problems.push(`${at}: proven, so "proofTest" names the test that shows it, or "live" gives the number of the probe that showed it`);
      if (live && !liveProbes(out).some((x) => x.id === live)) return problems.push(`${at}: no probe ${live} in .cybedefend/out/live.json`);
      if (!d.ours) fromFiles.applied += 1;
      for (const t of targets) into.push({ ...t, ...(d.ours ? {} : { rank: FOREIGN_RANK }), verdict: a.verdict, reason: reason.slice(0, 1000), proofTest: a.proofTest, live, priority, entry, file: d.name });
      return undefined;
    });
  }
  list.push(...foreignList, ...ownList);
  return { list, problems, files, last, fromFiles };
}

/** The precision given to a verdict from a file this machine did not write: below every entry of this run. */
const FOREIGN_RANK = 0.5;

/**
 * Saves the agent's triage: the file it wrote, outside .cybedefend, becomes
 * .cybedefend/out/assessments.json (or assessments-<part>.json), and this
 * machine remembers its content. Only a triage saved this way is applied
 * without asking. Returns the name written.
 */
export function saveAssessments({ root, out, from, part }) {
  const source = resolve(from);
  const tree = join(root, '.cybedefend');
  if (within(realOr(tree), realOr(source)) || within(resolve(tree), source)) throw new Exit(64, `assess --save reads the triage you wrote outside .cybedefend (a file of your own, in the system's temporary folder for example): ${from} is under .cybedefend, where anything can come from the repository.`);
  if (part !== undefined && !/^[A-Za-z0-9._]+(?:-[A-Za-z0-9._]+)*$/.test(String(part))) throw new Exit(64, '--part is a short name: letters, digits, dots, dashes');
  let content;
  try {
    content = readFileSync(source, 'utf8');
  } catch {
    throw new Exit(64, `assess --save: no file ${from}`);
  }
  let doc;
  try {
    doc = JSON.parse(content);
  } catch {
    throw new Exit(64, `assess --save: ${from} is not JSON`);
  }
  if (!Array.isArray(Array.isArray(doc) ? doc : doc?.assessments)) throw new Exit(64, `assess --save: ${from} holds { "assessments": [ ... ] }`);
  const name = part === undefined ? 'assessments.json' : `assessments-${part}.json`;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), content);
  remember(root, `out/${name}`, content);
  return name;
}

/** What a file of verdicts the skill did not write holds: how many, which verdicts, on what, and a hash of it. */
function heldFile(file, items, hash) {
  const byVerdict = {};
  for (const x of items) byVerdict[x.verdict] = (byVerdict[x.verdict] ?? 0) + 1;
  return { file, sha256: hash, verdicts: items.length, byVerdict, findings: items.map((x) => `${x.what}: ${x.verdict}`) };
}

/** The lines that tell the user about verdicts found in files the skill did not write. */
export function sayFromFiles({ applied = 0, refused = 0, held = [], digest = null } = {}) {
  for (const h of held) {
    say(`  ! ${counted(h.verdicts, 'verdict')} in ${h.file} ${h.verdicts === 1 ? 'was' : 'were'} not written by this skill on this machine (it came with the repository, a branch, or was written there without assess --save): not applied, the findings they judge are judged again`);
    say(`     ${Object.entries(h.byVerdict).map(([v, n]) => `${v} ${n}`).join(', ')}`);
    for (const f of h.findings.slice(0, 12)) say(`     ${f}`);
    if (h.findings.length > 12) say(`     … ${h.findings.length - 12} more, in the file`);
  }
  if (held.length) say(`     Show them to the user. Only when the user confirms them as their own, run the same command again with --accept-verdicts ${digest}: it applies exactly what is listed here, and nothing if the files change meanwhile.`);
  if (applied) say(`  ! ${counted(applied, 'verdict')} applied from files this machine did not write, as asked (--accept-verdicts), each below every entry of this run`);
  if (refused) say(`  ! ${counted(refused, 'entry', 'entries')} of those files judged the whole repository (every finding, or a rule everywhere): never applied from a file this machine did not write`);
}

/** The sentence of the final answer when verdicts came from a file the skill did not write (report.mjs, where the page says it too). */
export { fromFilesNote };

// ─── The triage, from one run to the next ───────────────────────────────────
//
// A verdict is a judgment on the code as it was. It is kept with the place of
// that code in git, so the next run gives the same answer on the same code,
// and judges again what a changed file holds.

const lastTriageFile = (root) => join(root, '.cybedefend', 'audit', 'triage.json');

/** One finding of the scanners, named the same way from one scan to the next. */
export const findingKey = (g) => (g.package ? `${g.uri}|${g.package.name}@${g.package.installed}|${g.ruleId}` : `${g.uri}:${g.line}|${g.ruleId}`);

const sha1OfFile = (file) => {
  try {
    return statSync(file).isFile() ? createHash('sha1').update(readFileSync(file)).digest('hex') : null;
  } catch {
    return null; // not there
  }
};

/** The paths a git command lists, NUL-separated; null when git refuses (a commit this clone does not have). */
function gitPaths(root, args) {
  try {
    return runGit(args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

/** Of what the scanners read: the files that differ from a commit, and the new ones git does not hold yet. */
function awayFrom(root, commit) {
  const tracked = commit ? gitPaths(root, ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', commit, ...SCANNED]) : gitPaths(root, ['ls-files', '-z', '--cached', ...SCANNED]);
  const fresh = gitPaths(root, ['ls-files', '-z', '--others', '--exclude-standard', ...SCANNED]);
  return tracked && fresh ? [...new Set([...tracked, ...fresh])] : null;
}

/**
 * Where the code is, for a later run to tell what changed: the commit, and a
 * hash of each file the scanners read that differs from it (changed, new, or
 * gone: null). A repository with no commit yet holds every file there.
 */
export function codeMark(root) {
  let commit = null;
  try {
    commit = git(['rev-parse', '-q', '--verify', 'HEAD'], root) || null;
  } catch {
    /* no commit yet */
  }
  const changed = {};
  for (const p of (awayFrom(root, commit) ?? []).sort()) changed[p] = sha1OfFile(join(root, p));
  return { commit, changed };
}

/**
 * The files the scanners read that are not as they were at a mark (codeMark),
 * sorted. A file that was changed and not committed then, and holds the same
 * content now, committed or not, has not changed. Null when it cannot be
 * told: the mark's commit is not in this clone.
 */
export function changedSince(root, mark) {
  const then = mark?.changed ?? {};
  const away = awayFrom(root, mark?.commit ?? null);
  if (!away) return null;
  return [...new Set([...away, ...Object.keys(then)])].filter((p) => then[p] !== sha1OfFile(join(root, p))).sort();
}

/**
 * Keeps the verdict of every scanner finding the triage judged, for the next
 * run: .cybedefend/audit/triage.json, next to the map and the last audit.
 * `merged` is the merged audit after placeAssessments. Returns { file, verdicts }.
 */
export function keepTriage({ root, merged, accept = false }) {
  const verdicts = merged.triage
    .filter((g) => g.judgedBy && g.byScanners.length > 0 && g.type !== 'secret' && !g.judgedBy.live)
    .map((g) => {
      const a = g.judgedBy;
      return {
        finding: findingKey(g),
        what: g.package ? `${g.package.name}@${g.package.installed}, ${g.ruleId} (${g.uri})` : `${g.uri}:${g.line}, ${g.title}`,
        on: g.package ? 'package' : 'code',
        file: g.uri,
        verdict: a.verdict,
        reason: a.reason,
        ...(a.priority ? { priority: a.priority } : {}),
        ...(a.proofTest ? { proofTest: a.proofTest } : {}),
        rank: a.rank,
      };
    });
  // A verdict that still stands, in a file this run reports nothing for (its tool stayed out of the run), is
  // kept for the run that reports the finding again. Where the file still has findings and this one is not
  // among them, it is gone: fixed, or a package upgraded.
  const reported = new Set(merged.triage.map((g) => g.uri));
  for (const v of lastTriage(root, { accept })?.standing ?? []) if (!reported.has(v.file)) verdicts.push(v);
  verdicts.sort((x, y) => x.finding.localeCompare(y.finding));
  const file = lastTriageFile(root);
  mkdirSync(dirname(file), { recursive: true });
  const content = `${JSON.stringify({ about: 'The verdicts of the last triage of /cybedefend. The next run keeps each one while its file has not changed (assess.md).', at: new Date().toISOString(), code: codeMark(root), verdicts }, null, 2)}\n`;
  writeFileSync(file, content);
  // Remembered outside the repository: the next run applies this content, and nothing a commit puts in its place.
  remember(root, 'triage.json', content);
  return { file, verdicts: verdicts.length };
}

/**
 * Right after a new scan: removes the triage files the last finish already
 * kept (written before triage.json was). Every verdict they gave is in
 * triage.json; left in place, a wide entry of theirs (a lockfile, a folder)
 * would judge the findings of this scan before anyone looked. A file
 * written since (a finding noted as not reproduced before this scan) stays:
 * the next finish applies it. Returns the names removed.
 */
export function putAwayKeptTriage({ root, out }) {
  let keptAt;
  try {
    keptAt = statSync(lastTriageFile(root)).mtimeMs;
  } catch {
    return []; // nothing was kept: the files are all there is
  }
  const away = [];
  for (const name of assessmentFiles(out)) {
    try {
      if (statSync(join(out, name)).mtimeMs > keptAt) continue;
      rmSync(join(out, name));
      away.push(name);
    } catch {
      /* left where it is */
    }
  }
  return away;
}

/**
 * The verdicts of the last triage that still stand. A verdict on a finding
 * in the code stands while its file is as it was. A verdict on a package is
 * a verdict on that version of it in that lockfile: it stands while the scan
 * reports the same one, whatever else the lockfile changed. Returns { list,
 * standing, total, stand, changed }: the list as entries placeAssessments
 * reads, `standing` as they are kept in the file, `changed` the files the
 * scanners read that changed since; null when no triage was kept. When what
 * changed cannot be told, none stands.
 */
export function lastTriage(root, { accept = false } = {}) {
  let doc;
  let content;
  try {
    content = readFileSync(lastTriageFile(root), 'utf8');
    doc = JSON.parse(content);
  } catch {
    return null;
  }
  const all = (Array.isArray(doc?.verdicts) ? doc.verdicts : []).filter((v) => typeof v?.finding === 'string' && ASSESSMENT_VERDICTS.includes(v.verdict) && typeof v.reason === 'string');
  // The file is in the repository, so a clone, a pull or a checkout can bring one nobody on this machine wrote:
  // its verdicts would dismiss findings in the user's name. Only the content this machine wrote is applied unasked.
  const ours = remembered(root, 'triage.json', content);
  if (!ours && !accept) {
    const held = all.length ? heldFile('.cybedefend/audit/triage.json', all.map((v) => ({ what: v.finding, verdict: v.verdict })), sha256(content)) : null;
    return { list: [], standing: [], total: 0, stand: 0, changed: null, held };
  }
  const changed = changedSince(root, doc.code);
  const gone = changed ? new Set(changed) : null;
  const standing = all.filter((v) => gone && (v.on === 'package' || !gone.has(v.file)));
  // The precision a verdict was given at is this machine's own record: from a file from elsewhere it ranks lowest, so any entry of this run wins.
  const list = standing
    .map((v) => ({ finding: v.finding, rank: ours ? Number(v.rank) || 1 : 1, verdict: v.verdict, reason: v.reason, proofTest: v.proofTest, live: null, priority: PRIORITIES.includes(v.priority) ? v.priority : undefined, entry: 0, file: 'the last triage', kept: true }));
  return { list, standing, total: all.length, stand: list.length, changed: changed ?? null, fromRepository: !ours };
}

/** A count with its noun: "1 finding", "9 findings". */
export const counted = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/** The last line of finish, so an output cut short still says the verdict. */
export const verdictLine = (verdict, blocking) => `VERDICT: ${verdict === 'SHIP' ? 'SHIP (exit 0)' : `NOT YET, ${counted(blocking, 'finding blocks', 'findings block')} (exit 1)`}`;

/**
 * The verdict the user reads: three outcomes (Nov 24, 2026). NOT YET when the
 * AI scanner proved a flaw at high or critical severity with an exploit test.
 * Otherwise SHIP, and « SHIP, N to fix » when something is left to fix: what
 * the policies block (flaws in the code and its configuration, packages to
 * upgrade, critical or high results the dashboard keeps closed), the secrets
 * the scan located, and the flaws proven below high. A secret is to fix, not
 * NOT YET by itself: on large applications most secrets a scan finds are test
 * fixtures and examples (91 of 103 on Odoo).
 *
 * The three verdicts change what is shown, not the exit code: finish exits 1
 * whenever the team's policies block, as before, so a CI gate keeps failing
 * on a blocking finding; NOT YET exits 1 too. `policy` mode (--policy, or
 * CYBEDEFEND_VERDICT=policy) also shows the policies' own words.
 */
export function publicVerdict({ policy, triage = [], blocks, secrets = 0, unseen = 0, mode = 'proof' }) {
  const live = (g) => g.byAiScanner && g.proven && !g.setAside;
  const provenHigh = triage.filter((g) => live(g) && ['critical', 'high'].includes(g.severity)).length;
  // A proven flaw that a policy blocks is already one line of blocks.code: counted once.
  const provenBelow = triage.filter((g) => live(g) && !g.blocks && !['critical', 'high'].includes(g.severity)).length;
  // A secret is a place (file, line): one already in what blocks is not counted twice.
  const blocked = new Set((blocks?.code ?? []).map((c) => c.where));
  const secretsToFix = Array.isArray(secrets) ? secrets.filter((x) => !blocked.has(`${x.file}:${x.line}`)).length : Number(secrets) || 0;
  // The critical or high results the dashboard keeps closed (unseen) are pushed into the
  // policies' blocking list before markBlocking, so they are already in blocks: not added again.
  const toFix = (blocks?.code?.length ?? 0) + (blocks?.dependencies?.packages ?? 0) + provenBelow + secretsToFix;
  const policyBlocks = policy !== 'SHIP';
  const base = { toFix, provenHigh, secrets: Array.isArray(secrets) ? secrets.length : Number(secrets) || 0, unseen, mode, policyBlocks };
  if (mode === 'policy') return { ...base, verdict: policyBlocks ? 'NOT YET' : 'SHIP', ship: !policyBlocks, exit: policyBlocks ? 1 : 0 };
  const notYet = provenHigh > 0;
  return { ...base, verdict: notYet ? 'NOT YET' : toFix ? 'SHIP, TO FIX' : 'SHIP', ship: !notYet, exit: notYet || policyBlocks ? 1 : 0 };
}

/** proof (the three verdicts) or policy (the policies' words), from --policy or CYBEDEFEND_VERDICT. */
export const verdictMode = (flags = {}, env = process.env) => (flags.policy === true || env.CYBEDEFEND_VERDICT === 'policy' ? 'policy' : 'proof');

/** The last line of finish under the three verdicts; the exit code is the one finish returns. */
export const publicVerdictLine = (pv, blocking) => {
  if (pv.mode === 'policy') return verdictLine(pv.ship ? 'SHIP' : 'BLOCK', blocking);
  if (pv.verdict === 'NOT YET') return `VERDICT: NOT YET, ${counted(pv.provenHigh, 'flaw')} proven by an exploit test (exit 1)`;
  const things = pv.verdict === 'SHIP, TO FIX' ? `, ${counted(pv.toFix, 'thing', 'things')} to fix` : '';
  const gate = pv.exit ? `; the policies block ${counted(blocking, 'finding', 'findings')}` : '';
  return `VERDICT: SHIP${things}${gate} (exit ${pv.exit})`;
};

/** What blocks, by where it is: in the code and its configuration, then the packages to upgrade. */
export const blocksWords = (blocks) => `${blocks.findings ?? blocks.code.length} in the code and its configuration${(blocks.findings ?? 0) > blocks.code.length ? ` (${counted(blocks.code.length, 'flaw')}: several tools report the same one)` : ''}, ${counted(blocks.dependencies.advisories, 'advisory', 'advisories')} on ${counted(blocks.dependencies.packages, 'package')} to upgrade`;

/** What an assessment names, in a few words. */
const assessmentLabel = (a) => (a.kept ? a.finding : null) ?? a.package ?? (a.through ? `what comes in through ${a.through}` : null) ?? (a.lockfile ? `every package of ${a.lockfile}` : a.where ? `${a.where}${a.rule ? ` ${a.rule}` : ''}` : `${a.rule ? `rule ${a.rule}` : 'every code finding'}${a.under ? ` under ${a.under}` : ''}`);

const ruleMatches = (ruleId, rule) => !rule || ruleId === rule || String(ruleId).endsWith(`/${rule}`) || String(ruleId).endsWith(`.${rule}`);

/**
 * Places each assessment on the findings of the merged audit: the most
 * precise entry that names a finding is its verdict. Only what a scanner
 * reported, or a lead of the AI scanner that a live replay settled: never a
 * secret (it is exposed whatever the code does), never a finding the AI
 * scanner proved (its test is its proof). Marks each group (assessment, and
 * setAside when the code cannot reach it) and each package, and returns what
 * was judged and what was not.
 */
export function placeAssessments(merged, list, root) {
  const judgeable = merged.triage.filter((g) => g.type !== 'secret' && g.proven !== true && (g.byScanners.length > 0 || g.proven === false));
  const hits = new Map(list.map((a) => [a, []]));
  // What brings a package in, read from its lockfile when an entry judges by that.
  const contexts = new Map();
  const broughtBy = (g) => {
    if (!root || !list.some((a) => a.through)) return null;
    if (!contexts.has(g.uri)) contexts.set(g.uri, npmContext(root, g.uri));
    return contexts.get(g.uri)?.(g.package.name, g.package.installed) ?? null;
  };
  for (const g of judgeable) {
    let best = null;
    const way = g.package ? broughtBy(g) : null;
    for (const a of list) {
      let match;
      // A package by name@version, or by its name alone for every version of it; a dependency and what comes in through it; a lockfile.
      // "through" covers a package only when that dependency is its one way in: brought in by two, it is judged on its own.
      if (a.finding !== undefined) match = a.finding === findingKey(g);
      else if (g.package) match = a.package ? `${g.package.name}@${g.package.installed}` === a.package || g.package.name === a.package : a.through ? g.package.name === a.through || ((way?.via?.length ?? 0) <= 1 && (way?.direct === a.through || way?.under === a.through)) : a.lockfile ? g.uri === a.lockfile : false;
      else if (a.where) match = `${g.uri}:${g.line}` === a.where && ruleMatches(g.ruleId, a.rule);
      else if (a.under !== undefined) match = (a.under === '' || g.uri === a.under || g.uri.startsWith(a.under.endsWith('/') ? a.under : `${a.under}/`)) && ruleMatches(g.ruleId, a.rule);
      else match = false;
      // A lead is settled one by one, never by a rule or a folder.
      if (match && g.proven === false && !a.where) match = false;
      if (match && (!best || a.rank >= best.rank)) best = a;
    }
    if (!best) continue;
    hits.get(best).push(g);
    g.assessment = { verdict: best.verdict, reason: best.reason };
    g.judgedBy = best;
    g.setAside = best.verdict === 'not_exploitable';
  }
  for (const p of merged.packages) {
    const of = merged.triage.filter((g) => g.package && g.uri === p.lockfile && g.package.name === p.package && g.package.installed === p.installed);
    const first = of.find((g) => g.assessment)?.assessment;
    if (first) p.assessment = first;
    p.setAside = of.length > 0 && of.every((g) => g.setAside);
  }
  // What the scanners reported, without the leads: the list the triage answers for.
  const scanners = judgeable.filter((g) => g.byScanners.length > 0);
  const notJudged = scanners.filter((g) => !g.assessment);
  const count = (v) => scanners.filter((g) => g.assessment?.verdict === v).length;
  // The reasons that set findings aside, the largest first: what the report says.
  const reasons = new Map();
  for (const g of scanners.filter((x) => x.setAside)) {
    const r = reasons.get(g.assessment.reason) ?? { reason: g.assessment.reason, findings: 0, examples: [] };
    r.findings += 1;
    const name = g.package ? `${g.package.name}@${g.package.installed}` : `${g.uri}:${g.line}`;
    if (r.examples.length < 4 && !r.examples.includes(name)) r.examples.push(name);
    reasons.set(g.assessment.reason, r);
  }
  const packagesOf = (pred) => new Set(scanners.filter((g) => g.package && pred(g)).map((g) => `${g.uri}|${g.package.name}@${g.package.installed}`)).size;
  return {
    hits,
    totals: {
      scannerFindings: scanners.length,
      judged: scanners.length - notJudged.length,
      setAside: count('not_exploitable'),
      kept: scanners.length - count('not_exploitable'),
      proven: count('proven'),
      reachable: count('theoretical'),
      notJudged: notJudged.length,
      notJudgedFirst: [...new Set(notJudged.map((g) => (g.package ? `${g.package.name}@${g.package.installed}` : `${g.uri}:${g.line} ${String(g.ruleId).replace(/^.*[/.]/, '')}`)))].slice(0, 12),
      packagesSetAside: packagesOf((g) => g.setAside),
      packagesKept: packagesOf((g) => !g.setAside),
      setAsideReasons: [...reasons.values()].sort((x, y) => y.findings - x.findings),
    },
  };
}

/** With the triage's set-aside turned off: every judgment is an exploitability, nothing leaves the verdict. */
function keepAll(merged, totals) {
  for (const g of merged.triage) if (g.setAside) g.setAside = false;
  for (const p of merged.packages) p.setAside = false;
  Object.assign(totals, { kept: totals.scannerFindings, notExploitableKept: totals.setAside, setAside: 0, packagesKept: totals.packagesKept + totals.packagesSetAside, packagesSetAside: 0, setAsideReasons: [] });
}

/**
 * The triage checked against this scan's findings, on this machine: nothing
 * is sent, so it runs while the AI scanner works. Complete when every entry
 * is valid and every finding of the scanners has a verdict; it then stamps
 * .cybedefend/out/triage.done. With `wait` (seconds), it first waits for a
 * stamp newer than this scan: the triage a background sub-agent is writing
 * (SKILL.md, step 1). Returns { code, doc }: 0 complete, 2 findings without a
 * verdict (or still being written), 64 entries to correct.
 */
export async function checkTriage({ root, out, wait, accept }) {
  const manifestFile = join(out, 'manifest.tsv');
  if (!existsSync(manifestFile)) throw new Exit(64, 'No scan in this repository yet: start.mjs first.');
  const stamp = join(out, 'triage.done');
  const scannedAt = statSync(manifestFile).mtimeMs;
  const fresh = () => existsSync(stamp) && statSync(stamp).mtimeMs >= scannedAt;
  const seconds = wait === undefined || wait === false ? 0 : wait === true || !Number.isFinite(Number(wait)) ? 90 : Math.max(0, Number(wait));
  let waited = 0;
  if (seconds && !fresh()) {
    say(`  … waiting for the triage of this scan, written by its sub-agent (up to ${seconds} s)`);
    const t0 = Date.now();
    while (!fresh() && Date.now() - t0 < seconds * 1000) await sleep(Math.min(POLL_MS, 1000));
    waited = Math.max(1, Math.round((Date.now() - t0) / 1000));
  }
  const stillWriting = seconds > 0 && !fresh();
  const { list: read, problems, files, last: before, fromFiles } = readAssessments(out, { root, accept });
  sayFromFiles(fromFiles);
  const fromFilesDoc = fromFiles.applied || fromFiles.held.length ? { fromFiles } : {};
  // An entry to correct stops this run's entries only: the verdicts of the last run still stand.
  const list = problems.length ? read.filter((a) => a.kept) : read;
  if (problems.length && !stillWriting) {
    for (const problem of problems) say(`  ✗ ${problem}`);
    say(`TRIAGE: ${problems.length} entr${problems.length === 1 ? 'y' : 'ies'} to correct, then assess --check again (exit 64)`);
    return { code: 64, doc: { ok: false, complete: false, files, problems, ...fromFilesDoc } };
  }
  let merged;
  try {
    // The scanners' results only: the AI scanner may be writing its own file right now, and its findings are never triaged.
    merged = mergeAudit({ out, root, withAudit: false, write: false });
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
    merged = { triage: [], packages: [] };
  }
  const { hits, totals: t } = placeAssessments(merged, list, root);
  const label = (g) => (g.package ? `${g.package.name}@${g.package.installed} (${g.uri})` : `${g.uri}:${g.line} ${String(g.ruleId).replace(/^.*[/.]/, '')} (${g.tool})`);
  const open = merged.triage.filter((g) => g.type !== 'secret' && g.proven !== true && g.byScanners.length > 0 && !g.assessment);
  const notJudged = [...new Set(open.map(label))];
  // A verdict of the last run whose finding is gone (fixed, upgraded) has nothing left to judge: no entry to correct.
  const notPlaced = problems.length ? [] : list.filter((a) => !a.kept && !hits.get(a).length).map((a) => {
    const name = a.package && a.package.slice(1).includes('@') ? a.package.slice(0, a.package.lastIndexOf('@')) : null;
    const nowAt = name ? merged.packages.find((p) => p.package === name)?.installed : undefined;
    return { file: a.file, target: assessmentLabel(a), ...(nowAt ? { nowAt } : {}) };
  });
  const older = files.filter((f) => statSync(join(out, f)).mtimeMs < scannedAt);
  const kept = t.kept - t.notJudged;
  if (before?.total && t.scannerFindings) {
    const n = before.changed?.length ?? 0;
    if (!before.changed) say(`  ! the ${counted(before.total, 'verdict')} of the last triage cannot be carried: this clone does not have the commit they were given on (a shallow clone, or a history rewritten since), so this triage judges everything`);
    else if (!n) say(`  ✓ ${counted(before.stand, 'verdict')} of the last triage stand${before.stand === 1 ? 's' : ''}: nothing the scanners read has changed since`);
    else say(`  ✓ ${before.stand} of the ${counted(before.total, 'verdict')} of the last triage stand. ${counted(n, 'file')} changed since (${before.changed.slice(0, 8).join(', ')}${n > 8 ? `, and ${n - 8} more` : ''}): what the scanners found in the code there is judged again, and a verdict that stands is overturned by an entry of this run when one of these files changes what it rests on`);
  }
  if (!t.scannerFindings) say('  - the scanners reported nothing to judge');
  else say(`  ${t.notJudged ? '!' : '✓'} ${files.length ? `${files.map((f) => f).join(', ')}: ` : ''}${t.judged} of ${t.scannerFindings} findings of the scanners judged, ${t.setAside} set aside, ${kept} kept`);
  for (const x of notPlaced.slice(0, 12)) say(x.nowAt ? `  ! ${x.target} judges nothing of this scan: the package is now at ${x.nowAt}` : `  ! ${x.target} judges nothing of this scan (check its name, version or path against the digest)`);
  if (notJudged.length) {
    say(`  ✗ ${notJudged.length} without a verdict:`);
    for (const n of notJudged.slice(0, 40)) say(`     ${n}`);
    if (notJudged.length > 40) say(`     … ${notJudged.length - 40} more, every one in the JSON on stdout`);
  }
  for (const f of older) say(`  ! ${f} is from an earlier scan: delete it unless this triage uses it`);
  const complete = !problems.length && t.notJudged === 0;
  if (complete) writeFileSync(stamp, `${JSON.stringify({ at: new Date().toISOString(), files, scannerFindings: t.scannerFindings, judged: t.judged, setAside: t.setAside, kept }, null, 2)}\n`);
  let last;
  if (complete) last = `TRIAGE: complete, ${t.judged} of ${t.scannerFindings} judged, ${t.setAside} set aside, ${kept} kept${waited ? ` (waited ${waited} s)` : ''}`;
  else if (stillWriting) last = `TRIAGE: not finished after ${seconds} s (${files.length ? `${t.notJudged} without a verdict so far` : 'no triage file yet'}, exit 2): run it once more, or judge what is left yourself`;
  else last = `TRIAGE: ${t.notJudged} without a verdict (exit 2): add their entries, then assess --check again`;
  say(last);
  return {
    code: complete ? 0 : 2,
    doc: { ok: !problems.length, complete, stillWriting, files, triage: { scannerFindings: t.scannerFindings, judged: t.judged, setAside: t.setAside, kept, notJudged: t.notJudged }, ...(before?.total ? { lastTriage: { verdicts: before.total, stand: before.stand, changed: before.changed } } : {}), notJudged, notPlaced, olderThanScan: older, ...fromFilesDoc, ...(problems.length ? { problems } : {}) },
  };
}

/** Waits for a batch update of the dashboard to end. True when every item went through. */
async function waitBatch(inst, taskId, { timeoutMs = 90_000, pollMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await call(inst, 'GET', '/me/async-tasks');
    if (res.status !== 200) return false;
    const task = (res.data?.tasks ?? []).find((t) => t.taskId === taskId);
    if (task && ['completed', 'failed', 'cancelled'].includes(task.status)) {
      const ok = task.status === 'completed' && Number(task.failed ?? 0) === 0;
      // Done: taken off the user's task tracker in the dashboard, where it would sit as a finished job of theirs.
      if (ok) await call(inst, 'DELETE', `/me/async-tasks/${taskId}`).catch(() => {});
      return ok;
    }
    await sleep(pollMs);
  }
  return false;
}

/**
 * Applies the triage in the dashboard. What the code cannot reach is set
 * aside (status "ignored" with the reason: the dashboard's policies skip it),
 * a hundred findings a request; what is kept gets its exploitability, which
 * sets its priority, and a finding a test proves is confirmed. With
 * setAside false nothing changes status: the judgments go as exploitability
 * only. Returns { done, totals }.
 */
export async function applyAssessments(inst, { project, merged, list, setAside = true, root, out }) {
  const { hits, totals } = placeAssessments(merged, list, root);
  const commented = commentedLog(out);
  let comments = 0;
  let priorities = 0;
  let already = 0;
  // One finding of the dashboard can stand for several results (the same advisory in two lockfiles):
  // it is set aside only when every one of them is, and kept as soon as one is kept.
  const keptIds = new Set(merged.triage.filter((g) => !g.setAside).flatMap((g) => g.dashboardIds ?? []));
  const idsOf = (groups) => [...new Set(groups.flatMap((g) => g.dashboardIds ?? []))];
  const done = [];
  const aside = [];
  for (const a of list) {
    const groups = hits.get(a);
    const ids = idsOf(groups);
    let applied = 0;
    if (a.verdict === 'not_exploitable' && setAside) {
      for (const id of ids) if (!keptIds.has(id) && !aside.some((x) => x.id === id)) aside.push({ id, a });
    } else {
      // What a person reads on the finding in the dashboard: the agent's analysis as a comment, written once, and the priority when its reading of the code sets one.
      const { comment, reason } = triageWords(a);
      for (const id of ids) {
        const written = `${a.verdict}|${a.priority ?? ''}`;
        if (commented.applied(id) === written) {
          applied += 1;
          already += 1;
          continue;
        }
        const extra = { ...(commented.has(id, a.verdict) ? {} : { comment }), ...(a.priority ? { priority: a.priority } : {}) };
        const res = await patchFinding(inst, project, id, { exploitabilityVerdict: a.verdict, exploitabilitySource: 'manual', exploitabilityReason: reason, ...(a.verdict === 'proven' ? { status: 'confirmed' } : {}) }, extra);
        if (res.ok) {
          applied += 1;
          commented.setApplied(id, written);
        }
        if (res.annotated && extra.comment) {
          comments += 1;
          commented.add(id, a.verdict);
        }
        if (res.prioritized) priorities += 1;
      }
    }
    // An upgraded package that still has advisories is at another version now: the assessment is the agent's to carry over.
    const name = a.package && a.package.slice(1).includes('@') ? a.package.slice(0, a.package.lastIndexOf('@')) : null;
    const nowAt = name && !groups.length ? merged.packages.find((p) => p.package === name)?.installed : undefined;
    // A verdict of the last run whose finding is gone has nothing to answer for.
    if (a.kept && !groups.length) continue;
    done.push({ target: assessmentLabel(a), verdict: a.verdict, findings: groups.length, open: ids.length, applied, placed: groups.length > 0, nowAt, entry: a.entry });
  }
  // Set aside, a hundred a request. When the batch route is not there, one by one.
  let asideDone = 0;
  const bump = (a) => {
    const d = done.find((x) => x.entry === a.entry && x.target === assessmentLabel(a));
    if (d) d.applied += 1;
  };
  for (let i = 0; i < aside.length; i += 100) {
    const part = aside.slice(i, i + 100);
    const res = await call(inst, 'PATCH', `/project/${project}/results/batch`, { json: { items: part.map(({ id, a }) => asideItem(id, a)) } });
    let ok = res.status === 202 && res.data?.taskId ? await waitBatch(inst, res.data.taskId) : false;
    if (!ok) {
      ok = true;
      for (const { id, a } of part) {
        const { vulnerabilityId, ...change } = asideItem(id, a);
        const one = await call(inst, 'PATCH', `/project/${project}/results/${vulnerabilityId}`, { json: change });
        if (one.status < 200 || one.status >= 300) continue;
        asideDone += 1;
        bump(a);
      }
      continue;
    }
    asideDone += part.length;
    for (const { a } of part) bump(a);
  }
  if (!setAside) keepAll(merged, totals);
  commented.save();
  return { done, totals: { ...totals, setAsideInDashboard: asideDone, commentsInDashboard: comments, prioritiesInDashboard: priorities, alreadyInDashboard: already } };
}

// ─── What the repository says of a vulnerable package ───────────────────────

/**
 * For the packages of an npm lockfile: whether each is development tooling
 * only, a direct dependency, which direct dependency brings it in, and how
 * many source files import it. Read from the lockfile and the tracked source
 * files, with no tool: the evidence the triage needs for every package at
 * once. Returns a function (name, version) -> { hint, kind } or null when the
 * lockfile is not one it reads.
 */
export function npmContext(root, lockfile) {
  if (!/(^|\/)package-lock\.json$/.test(lockfile)) return null;
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(root, lockfile), 'utf8'));
  } catch {
    return null;
  }
  const packages = lock.packages ?? {};
  const top = packages[''] ?? {};
  const direct = new Set([...Object.keys(top.dependencies ?? {}), ...Object.keys(top.devDependencies ?? {}), ...Object.keys(top.optionalDependencies ?? {})]);
  // Who depends on whom, copy by copy: each dependency resolved the way npm resolves it (the
  // nearest node_modules folder up the requiring package's path), so a version comes in
  // through what really requires that version, and a copy marked dev never stands for one in production.
  const nameOf = (key) => (key.includes('node_modules/') ? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length) : packages[key]?.name ?? basename(key));
  const resolveDep = (fromKey, dep) => {
    let base = fromKey;
    for (let i = 0; i < 64; i += 1) {
      const candidate = base ? `${base}/node_modules/${dep}` : `node_modules/${dep}`;
      const hit = packages[candidate];
      // A linked folder (a workspace, a generated SDK) stands for the folder it points to.
      if (hit) return hit.link && typeof hit.resolved === 'string' && packages[hit.resolved] ? hit.resolved : candidate;
      if (!base) return null;
      const at = base.lastIndexOf('node_modules/');
      base = at <= 0 ? '' : base.slice(0, at - 1);
    }
    return null;
  };
  const dependents = new Map();
  for (const [key, v] of Object.entries(packages)) {
    if (v.link) continue;
    const deps = key === '' ? [...direct] : [...Object.keys(v.dependencies ?? {}), ...Object.keys(v.optionalDependencies ?? {})];
    for (const dep of deps) {
      const to = resolveDep(key, dep);
      if (!to) continue;
      if (!dependents.has(to)) dependents.set(to, new Set());
      dependents.get(to).add(key);
    }
  }
  // The shortest way up from the copies of a package to a direct dependency of the project: the direct
  // dependency, and the package just under it on that way ("wasp", then "vitest" for tinypool).
  // For a package installed in production, only the ways that are installed in production too.
  const broughtBy = (keys, prodOnly) => {
    const from = new Map(keys.map((k) => [k, null]));
    const found = [];
    let layer = [...keys];
    for (let depth = 0; depth < 16 && layer.length && found.length < 2; depth += 1) {
      const next = [];
      for (const k of layer) {
        for (const d of dependents.get(k) ?? []) {
          if (d === '') {
            // k is a direct dependency of the project; the package just under it is the one this way came from.
            const child = from.get(k);
            if (!found.some((f) => f.direct === nameOf(k))) found.push({ direct: nameOf(k), under: child === null || child === undefined || keys.includes(child) ? null : nameOf(child) });
            continue;
          }
          if (from.has(d) || (prodOnly && packages[d]?.dev === true)) continue;
          from.set(d, k);
          next.push(d);
        }
      }
      layer = next;
    }
    return found.slice(0, 2);
  };
  // The modules the source files import, counted once per file. Tests and the tools' own folders do not count.
  const dir = dirname(lockfile) === '.' ? '' : `${dirname(lockfile)}/`;
  const importedBy = new Map();
  try {
    const files = runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      .split('\0')
      .filter((f) => f.startsWith(dir) && /\.(m?[jt]sx?|cjs|vue|svelte)$/.test(f) && !/(^|\/)(node_modules|tests?|__tests__|e2e[^/]*|\.cybedefend|\.claude)\/|\.(test|spec)\.|\.config\.[^/]+$/.test(f))
      .slice(0, 4000);
    for (const f of files) {
      let text;
      try {
        const real = insideRoot(root, f);
        if (!real || statSync(real).size > 500_000) continue;
        text = readFileSync(real, 'utf8');
      } catch {
        continue;
      }
      const here = new Set();
      for (const m of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*|import\s+)['"]([^'"./][^'"]*)['"]/g)) {
        const parts = m[1].split('/');
        here.add(m[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
      }
      for (const name of here) {
        const known = importedBy.get(name) ?? { n: 0, files: [] };
        known.n += 1;
        if (known.files.length < 2) known.files.push(f);
        importedBy.set(name, known);
      }
    }
  } catch {
    /* no git: the lockfile's own flags still say something */
  }
  const importers = (name) => importedBy.get(name) ?? { n: 0, files: [] };
  const filesSaid = (who) => (who.n ? `${who.n === 1 ? who.files[0] : `${who.n} source files, for example ${who.files[0]}`}` : null);
  return (name, version) => {
    const entries = Object.entries(packages).filter(([k, v]) => (k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`)) && String(v.version) === String(version).replace(/^v/, ''));
    if (!entries.length) return null;
    const own = importers(name);
    // The lockfile's own word: installed in production unless every copy is marked dev (or optional, or a peer nobody has to install).
    const flag = entries.every(([, v]) => v.dev === true) ? 'dev' : entries.every(([, v]) => v.optional === true) ? 'optional' : entries.every(([, v]) => v.peer === true) ? 'peer' : 'prod';
    const result = (o) => ({ ...o, flag });
    return result(describe());
    function describe() {
    if (entries.every(([, v]) => v.dev === true)) return { kind: 'dev', group: 'development tooling only (dev in the lockfile): not installed in production', hint: 'development tooling only (dev in the lockfile), not shipped' };
    if (own.n) return { kind: 'imported', group: 'imported by the code', files: filesSaid(own), hint: `imported by ${own.n} source file${own.n === 1 ? '' : 's'}${direct.has(name) ? ', a direct dependency' : ''}` };
    // Installed in production (some copy not marked dev): only the copies and the ways installed there.
    const prodKeys = entries.filter(([, v]) => v.dev !== true).map(([k]) => k);
    const ways = direct.has(name) ? [] : broughtBy(prodKeys.length ? prodKeys : entries.map(([k]) => k), prodKeys.length > 0);
    const via = ways.map((w) => w.direct);
    if (ways.length) {
      const bringer = importers(ways[0].direct);
      // Under a large dependency (a framework), the package just under it says what the group is for: a test runner, a web server.
      const under = ways[0].under ? `, under its ${ways[0].under}` : '';
      // Two dependencies bring it in: a group of its own, so a judgment on one of them never covers it.
      const group = via.length > 1 ? `through ${via.join(' and ')}` : `through ${ways[0].direct}${under}`;
      return { kind: 'transitive', via, direct: ways[0].direct, under: ways[0].under, note: `${ways[0].direct} is ${bringer.n ? `imported by ${filesSaid(bringer)}` : 'imported by no source file'}`, group, hint: `no source file imports it: it comes in through ${via.join(' and ')}` };
    }
    return { kind: 'transitive', via, group: direct.has(name) ? 'direct dependencies no source file imports (a tool of the build, or unused)' : 'no source file imports them, and the lockfile does not say what brings them in', hint: `no source file imports it${direct.has(name) ? ', though it is a direct dependency' : ''}` };
    }
  };
}

// ─── digest: what the scanners found, short enough for the agent to read ────

/**
 * The scanners' results of this run in a few dozen lines: what the AI scanner
 * reads before it reviews, in place of the SARIF files (a dependency scan
 * alone can be hundreds of results). Severities are each tool's own: the
 * dashboard's come with the verdict.
 */
export function digest({ out, root }) {
  const entries = existsSync(join(out, 'manifest.tsv')) ? readManifest(join(out, 'manifest.tsv')) : [];
  const lines = [];
  const counts = [];
  const code = [];
  const packages = new Map();
  let advisories = 0;
  for (const e of entries) {
    if (e.status !== 'ok') {
      if (e.status === 'failed') counts.push(`${toolLabel(e.name)} did not finish`);
      continue;
    }
    if (['sbom', 'context'].includes(e.type) || !e.file || !existsSync(e.file)) continue;
    let doc;
    try {
      doc = JSON.parse(readFileSync(e.file, 'utf8'));
    } catch {
      continue;
    }
    let n = 0;
    for (const run of doc.runs ?? []) {
      const rules = new Map((run.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
      for (const r of run.results ?? []) {
        n += 1;
        const rule = rules.get(r.ruleId);
        const severity = severityOf(r, rule);
        const loc = r.locations?.[0]?.physicalLocation;
        const uri = loc?.artifactLocation?.uri ?? '';
        const pkg = ['sca', 'container'].includes(e.type) ? packageOf(r.message?.text ?? '') : null;
        if (pkg) {
          advisories += 1;
          const key = `${pkg.name}@${pkg.installed}|${uri}`;
          const p = packages.get(key) ?? { name: `${pkg.name}@${pkg.installed}`, lockfile: uri, n: 0, severity, titles: [], parts: new Map() };
          p.n += 1;
          if (SEVERITIES.indexOf(severity) < SEVERITIES.indexOf(p.severity)) p.severity = severity;
          const title = (rule?.shortDescription?.text ?? '').replace(/\s+/g, ' ').slice(0, 90);
          if (title && p.titles.length < 2 && !p.titles.includes(title)) p.titles.push(title);
          // The part of the package an advisory names, before its first colon ("golang.org/x/crypto/ssh: ...").
          const part = /^([\w@./-]{3,60}):\s/.exec(rule?.shortDescription?.text ?? '')?.[1];
          if (part) p.parts.set(part, (p.parts.get(part) ?? 0) + 1);
          packages.set(key, p);
        } else if (e.type === 'secret') {
          // Said by the secrets line below: never a message, never a snippet.
        } else {
          const title = (rule?.shortDescription?.text ?? (/^[^\n]{8,100}$/.test(rule?.help?.text ?? '') ? rule.help.text : null) ?? r.message?.text ?? '').replace(/^Opengrep Finding: /, '').replace(/\s+/g, ' ').slice(0, 110);
          code.push({ severity, tool: e.name, rule: String(r.ruleId ?? '').replace(/^.*[/.]/, '').slice(0, 40), where: `${uri}:${Number(loc?.region?.startLine ?? 0)}`, title });
        }
      }
    }
    counts.push(`${e.name} ${n}`);
  }
  const skipped = entries.filter((e) => e.status === 'skipped').map((e) => e.name);
  lines.push(`SCANNERS: ${counts.join(', ') || 'none ran'}${skipped.length ? `  (nothing to read for: ${skipped.join(', ')})` : ''}`);
  const order = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);
  code.sort((a, b) => order(a, b) || a.where.localeCompare(b.where));
  lines.push('', `CODE AND CONFIGURATION: ${counted(code.length, 'finding')}, each tool's own severity`);
  // A medium or low rule that fires many times is one line: its count and its first places. High and critical ones stay one by one, to be assessed.
  const perRule = new Map();
  for (const c of code) perRule.set(`${c.tool}|${c.rule}`, [...(perRule.get(`${c.tool}|${c.rule}`) ?? []), c]);
  const shown = [];
  const folded = new Set();
  for (const c of code) {
    const key = `${c.tool}|${c.rule}`;
    const all = perRule.get(key);
    if (all.length <= 3 || ['critical', 'high'].includes(c.severity)) shown.push(`  ${c.severity.padEnd(8)} ${c.tool.padEnd(12)} ${c.rule.padEnd(26)} ${c.where}  ${c.title}`);
    else if (!folded.has(key)) {
      folded.add(key);
      const same = all.filter((x) => !['critical', 'high'].includes(x.severity));
      shown.push(`  ${c.severity.padEnd(8)} ${c.tool.padEnd(12)} ${c.rule.padEnd(26)} ${same.length} places: ${same.slice(0, 4).map((x) => x.where).join(', ')}${same.length > 4 ? `, and ${same.length - 4} more` : ''}  ${c.title}`);
    }
  }
  for (const l of shown.slice(0, 40)) lines.push(l);
  if (shown.length > 40) lines.push(`  … ${shown.length - 40} more lines, in the tools' files in .cybedefend/out/`);
  const pk = [...packages.values()].sort((a, b) => order(a, b) || b.n - a.n);
  const read = packagesRead(out);
  // A dependency scan that read nothing says "0 advisories" too: say which it is.
  lines.push('', read === 0 ? 'DEPENDENCIES: NOT CHECKED. Trivy found no lockfile or pinned versions to read (0 packages): say so in the report, it is not a clean result.' : `DEPENDENCIES: ${counted(advisories, 'advisory', 'advisories')} on ${counted(pk.length, 'package')}${read ? `, of ${read} packages read` : ''}`);
  // What the repository itself says of each package: the evidence for the triage, for every package at once.
  const contexts = new Map();
  for (const p of pk) {
    if (!contexts.has(p.lockfile)) contexts.set(p.lockfile, npmContext(root, p.lockfile));
    const at = p.name.lastIndexOf('@');
    p.context = contexts.get(p.lockfile)?.(p.name.slice(0, at), p.name.slice(at + 1)) ?? null;
  }
  // The worklist of the triage: every package, by lockfile, then by how it comes in. One judgment often holds for a whole group.
  if (pk.length) lines.push('  Every package below gets a verdict in the triage (assess.md): one entry can name a package, a list of packages or a whole lockfile.', '  This list is what the lockfiles and the source say, read for you: after each package, how the lockfile installs it (prod, dev, optional, peer); each group says what brings its packages in and which file imports that.');
  const byLock = new Map();
  for (const p of pk) byLock.set(p.lockfile, [...(byLock.get(p.lockfile) ?? []), p]);
  for (const [lockfile, list] of byLock) {
    lines.push(`  ${lockfile}: ${counted(list.reduce((n, p) => n + p.n, 0), 'advisory', 'advisories')} on ${counted(list.length, 'package')}`);
    const groups = new Map();
    for (const p of list) {
      const key = p.context?.group ?? 'not told by the lockfile';
      groups.set(key, [...(groups.get(key) ?? []), p]);
    }
    // The groups of one direct dependency together, and what imports it said once.
    const directOf = (members) => members[0].context?.direct ?? '';
    const ordered = [...groups.entries()].sort((x, y) => (directOf(x[1]) ? 1 : 0) - (directOf(y[1]) ? 1 : 0) || directOf(x[1]).localeCompare(directOf(y[1])) || y[1].reduce((n, p) => n + p.n, 0) - x[1].reduce((n, p) => n + p.n, 0));
    const said = new Set();
    for (const [key, members] of ordered) {
      const direct = directOf(members);
      const note = direct && !said.has(direct) ? `  [${members[0].context.note}]` : '';
      said.add(direct);
      lines.push(`    ${key}  (${members.length} package${members.length === 1 ? '' : 's'}, ${members.reduce((n, p) => n + p.n, 0)} advisories)${note}`);
      for (const p of members.slice(0, 25)) lines.push(`      ${p.severity.padEnd(8)} ${p.name} (${p.n})${p.context?.flag ? ` ${p.context.flag}` : ''}${p.context?.kind === 'imported' && p.context.files ? `  [${p.context.files}]` : ''}  ${(p.titles[0] ?? '').slice(0, 76)}`);
      if (members.length > 25) lines.push(`      and ${members.length - 25} more: ${members.slice(25).map((p) => `${p.name} (${p.severity})`).join(', ')}`);
    }
  }
  const secrets = locatedSecrets(out, root).places;
  lines.push('', `SECRETS: ${secrets.length}${secrets.length ? ` (values masked; read these files only with "cybedefend.mjs show <file>"): ${secrets.slice(0, 12).map((x) => `${x.file}:${x.line} ${x.kind}`).join(', ')}` : ''}`);
  const noir = join(out, 'noir.json');
  if (existsSync(noir)) {
    try {
      const d = JSON.parse(readFileSync(noir, 'utf8'));
      const eps = Array.isArray(d) ? d : d.endpoints ?? [];
      lines.push('', `ENTRY POINTS OWASP NOIR SAW: ${eps.length}, each method of a route and each script counted apart (a second list: list them from the code yourself, Noir can miss the routes the code registers)`);
      // Noir's hints for a reviewer: a parameter named like an object id or a
      // URL, a state change with no guard in sight, a sink it reached. Name
      // and shape only: where to look first, never a finding.
      const hintsOf = (ep) => {
        const ctx = ep.ai_context ?? {};
        const hints = [];
        for (const sg of ctx.signals ?? []) {
          if (['route_definition', 'technology', 'path_param', 'state_change'].includes(sg.kind)) continue;
          const name = String(sg.name ?? '').replace(/^(path|query|form|json|header|cookie)\./, '');
          hints.push(String(sg.source ?? '').startsWith('param_tagger') ? `${sg.kind}(${name})` : sg.kind);
        }
        for (const sk of ctx.sinks ?? []) hints.push(`sink ${sk.kind ?? sk.name}`);
        return [...new Set(hints)].slice(0, 5);
      };
      for (const ep of eps.slice(0, 50)) {
        const at = ep.details?.code_paths?.[0];
        const hints = hintsOf(ep);
        lines.push(`  ${String(ep.method ?? '').padEnd(6)} ${ep.url ?? ep.path ?? ''}${at?.path ? `  ${String(at.path).replace(/^\.\//, '')}${at.line ? `:${at.line}` : ''}` : ''}${hints.length ? `  hints: ${hints.join(', ')}` : ''}`);
      }
      if (eps.length > 50) lines.push(`  … ${eps.length - 50} more in .cybedefend/out/noir.json`);
      if (eps.some((ep) => hintsOf(ep).length)) lines.push('  (hints come from names and shapes: places to look first, never findings)');
    } catch {
      /* a context file that cannot be read is no reason to stop */
    }
  }
  return lines.join('\n');
}

// ─── board: the scan, tool by tool ──────────────────────────────────────────

const unitOf = (n, type, name) => (name === 'noir' ? (n === 1 ? 'entry point seen' : 'entry points seen') : type === 'sca' || type === 'container' ? (n === 1 ? 'advisory' : 'advisories') : type === 'secret' ? (n === 1 ? 'secret' : 'secrets') : n === 1 ? 'finding' : 'findings');

/**
 * What each tool of the registry did in this scan, from the manifest and the
 * tools' own files: the ones that ran with what they found and how long they
 * took, the ones that stayed out with the reason. Returns { rows, files,
 * seconds, text, said }: the text is the board, `said` the same scan as one
 * line for the agent to say.
 */
export function scanBoard({ out }) {
  const file = join(out, 'manifest.tsv');
  const entries = existsSync(file) ? readManifest(file) : [];
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(out, 'scan.json'), 'utf8'));
  } catch {
    /* a scan from before the board: no file count */
  }
  const rows = [];
  for (const e of entries) {
    if (e.type === 'sbom') continue; // Trivy's second pass, counted with Trivy
    const row = { name: e.name, label: toolLabel(e.name), area: toolArea(e.name, e.type), type: e.type, state: e.status === 'ok' ? 'done' : e.status === 'failed' ? 'fail' : 'skip', results: null, unit: '', seconds: e.seconds !== undefined && e.seconds !== '' && Number.isFinite(Number(e.seconds)) ? Number(e.seconds) : null, note: '' };
    if (row.state === 'done') {
      try {
        const doc = e.file && existsSync(e.file) ? JSON.parse(readFileSync(e.file, 'utf8')) : null;
        if (e.name === 'noir') row.results = doc ? (Array.isArray(doc) ? doc : doc.endpoints ?? []).length : null;
        else if (doc?.runs) row.results = doc.runs.reduce((n, r) => n + (r.results ?? []).length, 0);
      } catch {
        /* a file that cannot be read keeps its line, without a count */
      }
      if (row.results !== null) row.unit = unitOf(row.results, e.type, e.name);
      if (e.type === 'sca') {
        const read = packagesRead(out);
        if (read !== null) row.note = `${read} packages read`;
      }
    } else row.note = row.state === 'skip' ? whyNot(e.name, e.detail) : String(e.detail ?? '').replace(/\s+/g, ' ').trim();
    rows.push(row);
  }
  const rank = { done: 0, fail: 1, skip: 2 };
  rows.sort((a, b) => rank[a.state] - rank[b.state]);
  const ran = rows.filter((r) => r.state === 'done').length;
  // Counted over the tools this repository calls for: a tool with nothing to read here is not a tool that failed to run.
  const called = rows.filter((r) => r.state !== 'skip').length;
  const others = rows.length - called;
  const lines = [
    `THE SCAN, TOOL BY TOOL: ${ran === called ? `${ran} tool${ran === 1 ? '' : 's'} ran` : `${ran} of ${called} tools ran`}${meta.files ? ` on ${meta.files} files` : ''}${meta.seconds !== undefined ? ` in ${meta.seconds} s` : ''}.${others ? ` ${others} other${others === 1 ? ' has' : 's have'} nothing to read in this repository.` : ''}`,
  ];
  for (const r of rows) {
    if (r.state === 'done') lines.push(`  ● ${r.label.padEnd(13)} ${r.area.padEnd(15)} ${r.results === null ? ''.padEnd(22) : `${String(r.results).padStart(4)} ${r.unit.padEnd(17)}`} ${r.seconds === null ? '' : `${String(r.seconds).padStart(3)} s`}${r.note ? `  (${r.note})` : ''}`.trimEnd());
    else if (r.state === 'fail') {
      // What stopped it and what that changes, as scan.mjs read it in the tool's log: the cause on the tool's line, the rest under it.
      const [cause, ...rest] = r.note.split(/(?<=[^.]\.) (?=[A-Z])/);
      lines.push(`  ! ${r.label.padEnd(13)} ${r.area.padEnd(15)} ${cause.replace(/\.$/, '')}`);
      if (rest.length) lines.push(`    ${''.padEnd(13)} ${''.padEnd(15)} ${rest.join(' ')}`);
    }
    else lines.push(`  ○ ${r.label.padEnd(13)} ${r.note}`);
  }
  // The same scan as one line an agent says to the user: what each tool found, the ones that found nothing together,
  // a tool that did not finish with its cause, the ones with nothing to read here by name.
  const and = (names) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
  const done = rows.filter((r) => r.state === 'done');
  const found = done.filter((r) => r.results !== 0).map((r) => (r.results === null ? `${r.label} ran` : `${r.label} ${r.results} ${r.unit}${r.note ? ` (${r.note})` : ''}`));
  const nothing = done.filter((r) => r.results === 0).map((r) => r.label);
  const head = lines[0].slice('THE SCAN, TOOL BY TOOL: '.length).replace(/\.( \d+ others? ha(?:s|ve) nothing to read in this repository\.)?$/, '');
  const stopped = rows.filter((r) => r.state === 'fail').map((r) => withStop(`${r.label} ${r.note.replace(/\.$/, '')}`));
  const out_ = rows.filter((r) => r.state === 'skip').map((r) => r.label);
  const said = [
    `${head}: ${[...found, ...(nothing.length ? [`nothing from ${and(nothing)}`] : [])].join(', ') || 'no tool gave a result'}.`,
    ...stopped,
    ...(out_.length ? [`${out_.length} other${out_.length === 1 ? ' has' : 's have'} nothing to read in this repository: ${and(out_)}.`] : []),
  ].join(' ');
  return { rows, files: meta.files ?? null, seconds: meta.seconds ?? null, text: lines.join('\n'), said };
}

// ─── Main ───────────────────────────────────────────────────────────────────

/** The commands, as the head of this file lists them. */
const usage = () => `${readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 26).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')}\n`;

async function main(argv) {
  const [command, ...rest] = argv;
  // Asking for help never runs the command it follows.
  if (argv.some((a) => a === '--help' || a === '-h') || command === 'help') {
    process.stderr.write(usage());
    return 0;
  }
  const { positional, flags } = parseArgs(rest);
  const inst = instance();
  const print = (doc) => process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);

  switch (command) {
    case 'check': {
      const file = positional[0];
      if (!file) throw new Exit(64, 'Usage: check <file.sarif> [--type <type>]');
      const result = checkSarif(readFileSync(file), { fileName: basename(file), type: flags.type, audit: flags.audit === true });
      if (typeof flags.map === 'string') {
        // The audit is finished when every entry point of the map has a verdict.
        const map = readMap(resolve(flags.map));
        if (!map) result.problems.push(`no map at ${flags.map}: the audit starts with it (audit.md, step 1)`);
        else {
          result.problems.push(...map.problems);
          result.map = { entryPoints: map.rows, ok: map.ok, finding: map.finding, lead: map.lead, notExamined: map.notExamined };
        }
        result.ok = result.problems.length === 0;
      }
      print(result);
      return result.ok ? 0 : 64;
    }
    case 'finish': {
      // After the scan and the AI scanner: everything that goes to the
      // dashboard, the verdict, and the dashboard opened in the browser.
      const root = repoRoot();
      const project = projectId(root, inst);
      const branch = currentBranch(root, flags.branch);
      const out = join(root, '.cybedefend', 'out');
      const auditFile = join(out, 'audit.sarif');
      const t0 = Date.now();
      const stepSay = (n, title) => say(`\n▸ [${n}/7] ${title}`);
      let marked = [];
      const coverage = readMap(join(root, '.cybedefend', 'audit', 'map.md'));
      // Checked before anything is sent: a wrong audit file would close the
      // findings of the last one, and a bad assessment would say what nobody checked.
      const before = [];
      if (existsSync(auditFile)) {
        before.push(...checkSarif(readFileSync(auditFile), { fileName: 'audit.sarif', type: 'sast', audit: true }).problems);
        if (!coverage) before.push('no .cybedefend/audit/map.md: the audit starts with the map of the entry points (audit.md, step 1)');
        else before.push(...coverage.problems);
      }
      const assessments = readAssessments(out, { root, accept: flags['accept-verdicts'] });
      const acceptVerdicts = assessments.fromFiles.accepted;
      before.push(...assessments.problems);
      if (before.length) {
        for (const problem of before) say(`  ✗ ${problem}`);
        say(`FINISH: nothing was sent. Correct the ${before.length} point(s) above, then run finish again (exit 64)`);
        print({ ok: false, sent: false, problems: before });
        return 64;
      }
      const runFile = join(out, 'run.json');
      updateWatch(out, (w) => {
        setStep(w, 2, { state: 'done' });
        setStep(w, 3, { state: 'done' });
        setStep(w, 4, { state: 'run' });
        w.verdict = null;
        w.endedAt = null;
      });
      const typesOf = (r) => [...new Set((r.scans ?? []).map((x) => x.type).filter((t) => IMPORT_TYPES.includes(t)))];
      const brief = (text, n) => (text === undefined || text === null ? undefined : String(text).replace(/\s+/g, ' ').slice(0, n));
      // The triage first: the policies judge when an import ends, so what the
      // code cannot reach is set aside before the AI scanner's findings go in.
      stepSay(1, "The scanners' findings, triaged against this code");
      sayFromFiles(assessments.fromFiles);
      const setAsideOn = flags['set-aside'] !== false;
      let assessed = [];
      let triaged = null;
      if (existsSync(runFile) && existsSync(join(out, 'manifest.tsv'))) {
        const earlier = JSON.parse(readFileSync(runFile, 'utf8'));
        const first = mergeAudit({ out, root, dashboard: await openFindings(inst, { project, types: typesOf(earlier), branch }) });
        const applied = await applyAssessments(inst, { project, merged: first, list: assessments.list, setAside: setAsideOn, root, out });
        assessed = applied.done;
        triaged = applied.totals;
        const t = triaged;
        if (!t.scannerFindings) say('  - the scanners reported nothing to judge');
        else if (!assessments.list.length) say(`  ! ${t.scannerFindings} findings of the scanners and no triage (.cybedefend/out/assessments.json): each stays as its tool reported it. The triage is assess.md.`);
        else {
          say(`  ✓ ${t.judged} of ${t.scannerFindings} findings of the scanners judged: ${t.setAside} set aside (this code cannot reach them), ${t.kept - t.notJudged} kept as true positives (${t.proven} proven, ${t.reachable} reachable${t.notExploitableKept ? `, ${t.notExploitableKept} judged out of reach and left open` : ''})`);
          const fromLast = first.triage.filter((g) => g.judgedBy?.kept).length;
          if (fromLast) say(`     ${fromLast === t.judged ? `every one of these verdicts is` : `${fromLast} of these verdicts are`} the last triage's: the file each one judges has not changed since`);
          for (const r of t.setAsideReasons.slice(0, 6)) say(`     set aside, ${String(r.findings).padStart(3)}: ${brief(r.reason, 130)}  (${r.examples.slice(0, 3).join(', ')}${r.findings > r.examples.length ? ', …' : ''})`);
          if (t.setAsideReasons.length > 6) say(`     … ${t.setAsideReasons.length - 6} more reasons in triage.md`);
          if (t.setAside && t.setAsideInDashboard < t.setAside) say(`     (${t.setAsideInDashboard} set aside in the dashboard in this run: the others already were)`);
          if (t.commentsInDashboard || t.prioritiesInDashboard) say(`  ✓ written on the findings in the dashboard: ${counted(t.commentsInDashboard, 'analysis comment')} on what was kept${t.prioritiesInDashboard ? `, ${t.prioritiesInDashboard} priorit${t.prioritiesInDashboard === 1 ? 'y' : 'ies'} set from the reading of the code` : ''}, a reason on each one set aside`);
          else if (t.alreadyInDashboard) say(`  ✓ nothing written again on the ${counted(t.alreadyInDashboard, 'finding')} kept: the dashboard holds ${t.alreadyInDashboard === 1 ? 'its' : 'their'} verdict, ${t.alreadyInDashboard === 1 ? 'its' : 'their'} comment and ${t.alreadyInDashboard === 1 ? 'its' : 'their'} priority since an earlier run`);
          if (t.notJudged) say(`  ! ${t.notJudged} not judged: they stay open and count (${t.notJudgedFirst.slice(0, 6).join(', ')}${t.notJudged > 6 ? ', …' : ''})`);
        }
        // An entry that judges nothing of this scan is left out, and that is all: the agent that removes it and runs finish a second time loses a minute and sends everything twice.
        const leftOut = assessed.filter((d) => !d.placed);
        for (const x of leftOut.filter((d) => d.nowAt)) say(`  ! ${x.target} is now at ${x.nowAt}: that judgment was not applied. If your reason still holds for the advisories left, change the version in assessments.json: the next finish applies it.`);
        const plain = leftOut.filter((d) => !d.nowAt);
        if (plain.length) say(`  - ${plain.length} entr${plain.length === 1 ? 'y' : 'ies'} of the triage judge${plain.length === 1 ? 's' : ''} nothing of this scan and ${plain.length === 1 ? 'is' : 'are'} left out (${plain.slice(0, 4).map((d) => d.target).join(', ')}${plain.length > 4 ? ', …' : ''}). Nothing to correct: every finding has its verdict, do not run finish again for ${plain.length === 1 ? 'it' : 'them'}.`);
      } else say('  - no scan was sent in this run: nothing to triage');
      stepSay(2, "The AI scanner's findings, to the dashboard");
      let evaluated = false;
      if (existsSync(auditFile)) {
        // Each result carries the marks of its line, so the next run follows it when the file changes.
        const stamped = stampLines(JSON.parse(readFileSync(auditFile, 'utf8')), root);
        if (stamped.runs?.[0]?.properties) delete stamped.runs[0].properties.keptFromLastAudit;
        writeFileSync(auditFile, `${JSON.stringify(stamped, null, 2)}\n`);
        const r = await importFile(inst, { root, project, file: auditFile, type: 'sast', branch });
        evaluated = true;
        const run = existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : { projectId: project, branch, at: new Date().toISOString(), scans: [] };
        run.scans = [...run.scans.filter((x) => x.scanner !== 'audit'), { scanner: 'audit', tier: 'audit', ...r }];
        writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
        say(`  ✓ ${r.detected ?? r.results} findings imported as cybedefend-audit (${r.state})`);
        // The next review starts from this file (audit.md, step 5): kept where git sees it.
        mkdirSync(join(root, '.cybedefend', 'audit'), { recursive: true });
        copyFileSync(auditFile, join(root, '.cybedefend', 'audit', 'last.sarif'));
        if (coverage?.rows) say(`  ✓ ${coverage.rows} entry points in the map${coverage.carried ? `, ${coverage.rows - coverage.carried} reviewed in this run (the others keep the verdict of the last audit)` : ', each reviewed'}: ${coverage.ok} sound, ${coverage.finding} with a finding, ${coverage.lead} with a lead${coverage.notExamined ? `, ${coverage.notExamined} not examined (named in the map)` : ''}`);
        else if (!coverage) say('  ! no .cybedefend/audit/map.md: the review has no map of the entry points (audit.md, step 1)');
        for (const problem of coverage?.problems ?? []) say(`  ! ${problem}`);
        stepSay(3, 'Proven findings marked in the dashboard');
        marked = await markProven(inst, { project, file: auditFile, branch, out });
        say(`  ✓ ${marked.filter((m) => m.marked).length} of ${marked.length} marked proven, with their failing test as the reason${marked.some((m) => m.annotated) ? ', the fix as a comment and a priority from the score' : ''}`);
        for (const m of marked.filter((x) => !x.marked).slice(0, 5)) say(`  ! not marked: ${m.uri}:${m.line} (${m.why ?? 'no reason given'})`);
      } else {
        say('  ! no .cybedefend/out/audit.sarif: the AI scanner did not run');
        stepSay(3, 'Proven findings marked in the dashboard');
        say('  - nothing to mark');
      }
      stepSay(4, 'Everything in the dashboard, checked');
      if (!existsSync(runFile)) throw new Exit(64, 'No run yet: scan.mjs then send first.');
      let sentRun = JSON.parse(readFileSync(runFile, 'utf8'));
      if (!evaluated && triaged?.setAsideInDashboard) {
        // No import since the triage: the policies have not judged it yet. The smallest file of the run, sent once more, makes them.
        const all = readManifest(join(out, 'manifest.tsv'));
        const entries = all.filter((e) => e.status === 'ok' && e.file && existsSync(e.file) && IMPORT_TYPES.includes(e.type) && e.type !== 'container');
        const smallest = entries.sort((x, y) => statSync(x.file).size - statSync(y.file).size)[0];
        if (smallest) {
          const sbom = smallest.type === 'sca' ? all.find((e) => e.type === 'sbom' && e.status === 'ok' && e.file && existsSync(e.file)) : null;
          const r = await importFile(inst, { root, project, file: smallest.file, type: smallest.type, sbom: sbom?.file, branch });
          sentRun.scans = [...sentRun.scans.filter((x) => x.scanner !== smallest.name), { scanner: smallest.name, tier: smallest.tier ?? 'core', ...r }];
          writeFileSync(runFile, `${JSON.stringify(sentRun, null, 2)}\n`);
          say(`  ✓ ${smallest.name} sent once more, so the policies judge after the triage`);
        }
      }
      // What the triage set aside, in this run or an earlier one: ignored on purpose, never read as lost.
      const ignored = await openFindings(inst, { project, types: typesOf(sentRun).filter((t) => ['sast', 'iac', 'secret', 'cicd'].includes(t)), branch, statuses: ['ignored'] });
      let dashboard = await openFindings(inst, { project, types: typesOf(sentRun), branch });
      let closedByDashboard = closedButReported({ out, dashboard, setAside: ignored });
      if (closedByDashboard.length) {
        // The dashboard closed results the scan still reports (their line
        // moved): sent once more, they open again.
        say(`  ! ${closedByDashboard.length} result(s) the scan still reports were closed by the dashboard (their line moved): sending them once more`);
        const again = await sendRun(inst, { root, project, out, branch });
        if (existsSync(auditFile)) {
          const r = await importFile(inst, { root, project, file: auditFile, type: 'sast', branch });
          again.scans = [...again.scans.filter((x) => x.scanner !== 'audit'), { scanner: 'audit', tier: 'audit', ...r }];
          writeFileSync(runFile, `${JSON.stringify(again, null, 2)}\n`);
          marked = await markProven(inst, { project, file: auditFile, branch, out });
          say(`  ✓ ${marked.filter((m) => m.marked).length} of ${marked.length} marked proven again`);
        }
        sentRun = JSON.parse(readFileSync(runFile, 'utf8'));
        dashboard = await openFindings(inst, { project, types: typesOf(sentRun), branch });
        closedByDashboard = closedButReported({ out, dashboard, setAside: ignored });
        say(closedByDashboard.length ? `  ✗ still closed: ${closedByDashboard.map((x) => `${x.tool} ${x.where}`).slice(0, 5).join(', ')}` : '  ✓ all open again');
      }
      const delivery = await deliveryCheck(inst, { project, run: sentRun, branch });
      for (const d of delivery.tools) say(`  ${d.ok ? '✓' : '!'} ${d.scanner.padEnd(13)} ${String(d.sent).padStart(3)} sent as ${d.type.padEnd(6)} → ${d.state}${d.counted === undefined ? '' : `, ${d.counted} counted by the dashboard`}${d.note ? ` (${d.note})` : ''}`);
      say(`  ✓ open in the dashboard now: ${Object.entries(delivery.open).map(([t, n]) => `${t} ${n}`).join(', ')}${triaged?.setAside ? ` (what the triage set aside is under the status "ignored", each with its reason)` : ''}`);
      stepSay(5, 'One SARIF for the whole audit');
      // Findings that share a line are told apart before the merge places each result on its finding.
      await tellApart(inst, { project, sent: placedResults([...codeFiles(out, ['sast', 'iac', 'cicd']), ...(existsSync(auditFile) ? [{ name: AUDIT_TOOL, type: 'sast', file: auditFile }] : [])]), dashboard });
      const merged = mergeAudit({ out, root, dashboard });
      // The triage, placed on the audit as it is now: what was set aside leaves the counts, and says why.
      const placed = placeAssessments(merged, assessments.list, root);
      // Kept for the next run: the same code gets the same verdicts.
      try {
        keepTriage({ root, merged, accept: acceptVerdicts });
      } catch {
        /* a triage that cannot be kept is judged again next time */
      }
      if (!setAsideOn) keepAll(merged, placed.totals);
      // A lead of the AI scanner that a live replay settled: it is in the dashboard only now.
      const settled = commentedLog(out);
      for (const [a, groups] of placed.hits) {
        for (const g of groups.filter((x) => x.proven === false && x.byScanners.length === 0)) {
          for (const id of g.dashboardIds ?? []) {
            if (settled.applied(`live:${id}`) === a.verdict) continue;
            const res = await call(inst, 'PATCH', `/project/${project}/results/${id}`, { json: { exploitabilityVerdict: a.verdict, exploitabilitySource: 'manual', exploitabilityReason: triageWords(a).reason ?? fit(`The coding agent's review of this code rules it out. ${a.reason}`, 1000) } });
            if (res.status >= 200 && res.status < 300) settled.setApplied(`live:${id}`, a.verdict);
          }
        }
      }
      settled.save();
      const kept = merged.triage.filter((g) => !g.setAside);
      merged.summary.setAside = merged.triage.length - kept.length;
      merged.summary.bySeverity = Object.fromEntries(SEVERITIES.map((sev) => [sev, kept.filter((g) => g.severity === sev).length]));
      merged.summary.triage = { ...(triaged ?? placed.totals), ...placed.totals, setAsideInDashboard: triaged?.setAsideInDashboard ?? 0 };
      const s = merged.summary;
      say(`  ✓ ${s.findings} results from ${s.tools.length} tools${s.setAside ? `, ${s.setAside} set aside by the triage, ${kept.length} kept` : `, ${s.afterGrouping} after grouping`}: critical ${s.bySeverity.critical}, high ${s.bySeverity.high}, medium ${s.bySeverity.medium}, low ${s.bySeverity.low}${s.severityFrom === 'dashboard' ? ' (as the dashboard rates them)' : ''}`);
      say(`  ✓ ${s.inTheCode} in the code and its configuration, ${counted(s.dependencies.advisories, 'advisory', 'advisories')} on ${counted(s.dependencies.packages, 'vulnerable package')}${s.triage.packagesSetAside ? `, ${s.triage.packagesKept} of them kept after the triage` : ''}`);
      if (s.dependencies.packagesRead === 0) say('  ! dependencies NOT CHECKED: no lockfile or pinned versions for Trivy to read. Say so in the report: it is not a clean result.');
      say(`  ✓ AppSec scanners ${s.bySource.scanners}, AI scanner ${s.bySource.aiScanner} (${s.bySource.aiScannerProven} proven by a test, ${counted(s.bySource.aiScannerLeads, 'lead')})`);
      if (s.onlyAiScanner.length) {
        say(`  ★ found by the AI scanner alone, no scanner saw them:`);
        for (const f of s.onlyAiScanner.slice(0, 8)) say(`     ${f.severity.padEnd(8)} ${f.title}  (${f.where})`);
      }
      stepSay(6, "The verdict of the team's policies");
      const v = await verdict(inst, { project, run: JSON.parse(readFileSync(runFile, 'utf8')) });
      // A critical or high result the dashboard keeps closed is one its policies cannot see: no SHIP.
      const unseen = closedByDashboard.filter((x) => ['critical', 'high'].includes(x.severity));
      if (unseen.length) {
        v.verdict = 'BLOCK';
        v.blocking.push({ scanner: 'cybedefend', type: 'all', rule: 'Critical or high results the dashboard closed while the scan still reports them', findings: unseen.map((x) => ({ name: x.ruleId, severity: x.severity.toUpperCase(), type: x.type, file: x.where.replace(/:\d+$/, ''), line: Number(x.where.split(':').pop()) })) });
      }
      const blockingCount = v.blocking.reduce((n, b) => n + b.findings.length, 0);
      // What blocks, placed in the triage: who found each one, its proof, its
      // fix, and for a package the dependency that brings it in.
      const blocks = markBlocking({ merged, blocking: v.blocking, dashboard });
      writeTriage({ out, root, merged });
      const pv = publicVerdict({ policy: v.verdict, triage: merged.triage, blocks, secrets: locatedSecrets(out, root).places, unseen: unseen.length, mode: verdictMode(flags) });
      writeFileSync(join(out, 'verdict.json'), `${JSON.stringify({ ...v, exit: pv.exit, public: pv, blockingCount, blocks, closedByDashboard }, null, 2)}\n`);
      say(`  policies: ${v.verdict === 'SHIP' ? 'nothing blocks' : `${counted(blockingCount, 'finding blocks', 'findings block')}, under ${v.blocking.map((b) => `"${b.rule}"`).join(', ')}`}`);
      say(`  ${pv.ship ? '✓' : '✗'} ${publicVerdictLine(pv, blockingCount).replace(/^VERDICT: /, '').replace(/ \(exit \d\)$/, '')}`);
      if (blockingCount) {
        say(`     ${blocksWords(blocks)}`);
        if (blocks.elsewhere) say(`     ${blocks.elsewhere} more are open elsewhere in the project (another branch, or an earlier scan this run did not repeat): the policies count them too`);
        const main = blocks.dependencies.broughtInBy.find((b) => b.dependency && b.dependency !== 'a direct dependency');
        if (main && main.packages > 1) say(`     ${main.advisories} of those advisories come in through ${main.dependency}: one upgrade there clears them together`);
        for (const f of blocks.code.slice(0, 12)) say(`     ${f.severity.padEnd(8)} ${String(f.what).slice(0, 90)}  (${f.where}; ${f.foundBy}${f.findings > 1 ? `; ${f.findings} findings in the dashboard` : ''})`);
        if (blocks.code.length > 12) say(`     … ${blocks.code.length - 12} more in triage.md`);
      }
      if (v.warnings) say(`     ${v.warnings} more match a rule that only warns: they do not block`);
      stepSay(7, 'The dashboard');
      const link = `${inst.url}/project/${project}`;
      // The audit as one page, on the user's machine: the verdict, each proven
      // flaw with the test that is its exploit, what to upgrade, what was covered.
      const located = locatedSecrets(out, root);
      // A live replay made before the code last changed says what the application answered then: never shown as current.
      const probes = liveProbes(out, root);
      const fresh = probes.filter((p) => !p.stale);
      const staleProbes = probes.length - fresh.length;
      if (staleProbes) say(`  ! ${staleProbes} live request(s) are older than the last change to the code: not shown as current. "/cybedefend live" replays the findings on the code as it is now.`);
      // What the run cost the coding agent, in tokens, from its harness's own session log; null when no reader knows the harness.
      let runAt = null;
      try {
        runAt = JSON.parse(readFileSync(runFile, 'utf8')).at;
      } catch {
        /* no scan of this run on record */
      }
      const usage = runUsage({ since: readWatch(out)?.startedAt ?? runAt });
      if (usage) say(`  tokens: ${usageLine(usage)}`);
      let reportFile = null;
      let pdfFile = null;
      try {
        let commit = '';
        try {
          commit = git(['rev-parse', '--short', 'HEAD'], root);
        } catch {
          /* a repository without a commit yet */
        }
        reportFile = writeReport({ root, out, merged, v, blocks, coverage, secrets: located.places, link, branch, commit, probes: fresh, staleProbes, fromFiles: assessments.fromFiles, usage, mask: (t) => located.values.reduce((x, val) => x.split(val).join('REDACTED'), String(t ?? '')) });
        say(`  ✓ the audit as one page: ${reportFile}`);
        // The same page as a PDF, when a browser of the machine can print it without a window.
        pdfFile = flags.pdf === false ? null : printPdf(reportFile);
        if (pdfFile) say(`  ✓ the same page as a PDF, to hand over: ${pdfFile}`);
      } catch (err) {
        say(`  ! the audit page could not be written (${err?.message ?? err}): the triage and the dashboard have everything`);
      }
      updateWatch(out, (w) => {
        const t = merged.summary.triage;
        if (t?.scannerFindings) w.triage = { total: t.scannerFindings, judged: t.judged, kept: t.kept - t.notJudged, setAside: t.setAside };
        w.audit.flaws = merged.summary.bySource.aiScannerProven;
        w.audit.leads = merged.summary.bySource.aiScannerLeads;
        if (coverage?.rows) {
          w.audit.of = coverage.rows;
          w.audit.reviewed = coverage.ok + coverage.finding + coverage.lead + coverage.notExamined;
        }
        for (const p of fresh) if (p.note) addFeed(w, { kind: 'live', text: located.values.reduce((x, val) => x.split(val).join('REDACTED'), `${p.note}${p.response?.status ? ` (HTTP ${p.response.status})` : ''}`), where: p.finding ?? '' });
        // The numbers of the report's opening sentence: they add up to what blocks.
        w.verdict = { ship: pv.ship, exit: pv.exit, toFix: pv.ship ? pv.toFix : 0, provenHigh: pv.provenHigh, blocking: blockingCount, flaws: blocks.code.length, findings: blocks.findings ?? blocks.code.length, advisories: blocks.dependencies.advisories, packages: blocks.dependencies.packages };
        w.links = { dashboard: link, report: reportFile ? pathToFileURL(reportFile).href : null };
        for (const n of [1, 2, 3, 4, 5]) setStep(w, n, { state: 'done', note: '' });
        w.endedAt = new Date().toISOString();
      });
      // The run has its verdict: kept for a replay, whatever empties the results folder next.
      keepReplay(out);
      let signin = null;
      // A CI runner has nobody to show a page to, and no clipboard to fill.
      // Nor has a run started with CYBEDEFEND_NO_OPEN=1 (a rehearsal, a recording, a scheduled run).
      if (flags.open !== false && !process.env.CI && !['1', 'true', 'yes'].includes(String(process.env.CYBEDEFEND_NO_OPEN ?? '').toLowerCase())) {
        // The run's page has the verdict now: it keeps the front of the browser for a moment before the dashboard takes it.
        if (existsSync(pageFile(out))) await sleep(Math.max(0, Math.min(15_000, Number(process.env.CYBEDEFEND_VERDICT_PAUSE_MS ?? 6000) || 0)));
        const { toClipboard, readCredentials, maskEmail } = await import('./setup.mjs');
        const creds = readCredentials();
        const copied = creds.url === inst.url && creds.password ? toClipboard(creds.password) : false;
        // One after the other: two openers started together reach the browser in either order, and the audit page is the one to end in front.
        await openInOrder(link);
        if (reportFile) await openInOrder(reportFile);
        // The address is shown masked: a terminal is often shared or recorded, and the sign-in form holds it whole.
        signin = { email: creds.url === inst.url ? maskEmail(creds.email) : null, passwordCopied: copied };
        say(`  ✓ opened ${link}${copied ? ` (sign in as ${maskEmail(creds.email)}: the password is in your clipboard)` : ''}`);
      } else say(`  - ${link}`);
      say(`\nDone in ${Math.round((Date.now() - t0) / 1000)} s.`);
      // Short on purpose: the agent reads this whole, and pays for every
      // line. Every finding is in triage.md and triage.json, everything that
      // blocks, with its id in the dashboard, in verdict.json.
      const secrets = located.places.map((x) => `${x.file}:${x.line} ${x.kind}`);
      const line = (f) => ({ severity: f.severity, what: brief(f.what, 100), where: f.where, foundBy: f.foundBy, findings: f.findings > 1 ? f.findings : undefined, proofTest: f.proofTest ? String(f.proofTest).split(' > ').pop().split('::').pop() : undefined, fix: brief(f.fix, 170), assessment: brief(f.assessment, 170) });
      // The same fix on eighteen routes is said once.
      const firstWith = new Map();
      const once = (l) => {
        if (!l.fix) return l;
        if (firstWith.has(l.fix)) return { ...l, fix: `the same fix as ${firstWith.get(l.fix)}` };
        firstWith.set(l.fix, l.where);
        return l;
      };
      const doc = {
        // Under --policy the policies' own word, as before (SHIP or BLOCK).
        verdict: pv.mode === 'policy' ? v.verdict : pv.verdict,
        exit: pv.exit,
        // The three verdicts: what to fix while it ships, and why it does not.
        toFix: pv.toFix,
        provenHighOrCritical: pv.provenHigh,
        policyVerdict: v.verdict,
        blockingCount,
        blockingRules: v.blocking.map((b) => ({ rule: b.rule, message: b.message, findings: b.findings.length })),
        blocks: {
          code: blocks.code.slice(0, 15).map(line).map(once),
          // codeTotal: the flaws to fix; codeFindings: what the dashboard counts for them (each tool's finding is one).
          codeTotal: blocks.code.length,
          codeFindings: blocks.findings,
          elsewhereInTheProject: blocks.elsewhere,
          dependencies: { advisories: blocks.dependencies.advisories, packages: blocks.dependencies.packages, broughtInBy: blocks.dependencies.broughtInBy.slice(0, 4), upgrades: blocks.dependencies.upgrades.slice(0, 12).map((d) => ({ package: `${d.package}@${d.installed}`, upgradeTo: shownUpgrade(d.upgradeTo), advisories: d.advisories, severity: d.severity, broughtInBy: d.broughtInBy, assessment: brief(d.assessment, 170) })) },
        },
        // What does not block and still matters: the first findings of the triage that are not in "blocks".
        alsoOpen: merged.triage.filter((g) => !g.package && !g.blocks && !g.setAside).slice(0, 8).map((g) => line({ severity: g.severity, what: g.title, where: `${g.uri}:${g.line}`, foundBy: g.byAiScanner ? (g.proven ? 'AI scanner, proven' : 'AI scanner, lead') : g.byScanners.join(', '), proofTest: g.proofTest, assessment: g.assessment ? `${g.assessment.verdict}: ${g.assessment.reason}` : undefined })),
        warnings: v.warnings,
        failedScans: v.failedScans,
        incomplete: v.incomplete,
        unknown: v.unknown,
        closedByDashboard,
        // The scan as one sentence, tool by tool: the report gives it as it is.
        scan: { said: scanBoard({ out }).said },
        coverage: coverage ? { entryPoints: coverage.rows, reviewedInThisRun: coverage.rows - coverage.carried, ok: coverage.ok, finding: coverage.finding, lead: coverage.lead, notExamined: coverage.notExamined } : null,
        secrets: { total: secrets.length, where: secrets.slice(0, 15) },
        summary: { results: s.findings, afterGrouping: s.afterGrouping, bySeverity: s.bySeverity, severityFrom: s.severityFrom, bySource: s.bySource, provenAndSeenByNoScanner: s.onlyAiScanner.length, inTheCode: s.inTheCode, dependencies: s.dependencies, tools: s.tools },
        marked: { proven: marked.filter((m) => m.marked).length, of: marked.length, notMarked: marked.filter((m) => !m.marked).map((m) => `${m.uri}:${m.line} (${m.why ?? 'no reason given'})`) },
        // The triage of the scanners' findings: what was kept as a true positive, what was set aside and why.
        triage: s.triage.scannerFindings ? { scannerFindings: s.triage.scannerFindings, judged: s.triage.judged, keptAsTruePositives: s.triage.kept - s.triage.notJudged, proven: s.triage.proven, reachable: s.triage.reachable, setAside: s.triage.setAside, notJudged: s.triage.notJudged || undefined, notJudgedFirst: s.triage.notJudged ? s.triage.notJudgedFirst : undefined, packagesKept: s.triage.packagesKept, packagesSetAside: s.triage.packagesSetAside, setAsideReasons: s.triage.setAsideReasons.slice(0, 6).map((r) => ({ findings: r.findings, reason: brief(r.reason, 200), examples: r.examples.slice(0, 3) })) } : undefined,
        // Only what the agent has to act on: an entry on a package that is at another version now. An entry that judges nothing of this scan is left out and needs no second finish.
        assessments: assessed.filter((a) => !a.placed && a.nowAt).map((a) => ({ target: a.target, verdict: a.verdict, placed: false, nowAt: a.nowAt })),
        triageEntriesLeftOut: assessed.some((a) => !a.placed && !a.nowAt) ? { count: assessed.filter((a) => !a.placed && !a.nowAt).length, note: 'they judge nothing of this scan: nothing to correct, no second finish' } : undefined,
        live: probes.length ? { probes: fresh.length, findingsSeenLive: [...new Set(fresh.map((x) => x.finding).filter((f) => /^\S.*:\d+$/.test(String(f ?? ''))))].length, olderThanTheCode: staleProbes || undefined } : undefined,
        delivery: delivery.tools.every((d) => d.ok) ? { allSent: true, open: delivery.open } : delivery,
        signin,
        // Verdicts this machine did not write: how many were applied (--accept-verdicts), and which files were left out.
        verdictsFromFiles: assessments.fromFiles.applied || assessments.fromFiles.held.length ? { applied: assessments.fromFiles.applied, notApplied: assessments.fromFiles.held.map((h) => ({ file: h.file, verdicts: h.verdicts })) } : undefined,
        // The tokens of the run, read from the agent's session log up to this verdict: the report gives them as they are.
        usage: usage ? { total: usage.total, said: usageLine(usage) } : undefined,
        files: { page: reportFile, pdf: pdfFile ?? undefined, triage: join(out, 'triage.md'), verdict: join(out, 'verdict.json'), sarif: join(out, 'cybedefend-full.sarif') },
        links: { project: link, compliance: `${link}/compliance` },
      };
      // One key a line, each value compact: half the size of an indented document.
      process.stdout.write(`{\n${Object.entries(doc).filter(([, val]) => val !== undefined).map(([k, val]) => `  ${JSON.stringify(k)}: ${JSON.stringify(val)}`).join(',\n')}\n}\n`);
      // What the audit page holds of the live step, in one line the agent repeats as it is.
      if (probes.length) {
        // A finding is a file and a line: a word given in its place (a request of the setup) is not counted as one.
        const seenLive = [...new Set(fresh.map((x) => x.finding).filter((f) => /^\S.*:\d+$/.test(String(f ?? ''))))].length;
        const liveLine = fresh.length ? `LIVE: ${seenLive} finding(s) carry their live replay on the audit page, request and answer (${fresh.length} request(s) kept${staleProbes ? `, ${staleProbes} older than the code left out` : ''}).` : `LIVE: nothing live is on the audit page: the ${staleProbes} request(s) of the last replay are older than the code as it is now.`;
        // After a replay, the whole of it in a block the agent copies as it is: what ran, what the page holds, what is left on the machine.
        const step = fresh.length ? liveStep(out) : null;
        if (step) {
          say('\nTHE LIVE REPLAY');
          for (const l of liveBlock(step, liveLine)) say(`  ${l}`);
        } else say(liveLine);
      }
      // Where verdicts came from, said with the answer: a dismissal nobody on this machine gave is never silent.
      const note = fromFilesNote(assessments.fromFiles);
      if (note) say(`\nVERDICTS FROM FILES: ${note}`);
      // The last line on the screen, so a truncated output still says it.
      say(publicVerdictLine(pv, blockingCount));
      return pv.exit;
    }
    case 'open': {
      // What the last run left to look at, opened again: the project in the dashboard (the administrator's password in the clipboard) and the audit page.
      const root = repoRoot();
      const out = join(root, '.cybedefend', 'out');
      const { toClipboard, readCredentials, maskEmail } = await import('./setup.mjs');
      const link = `${inst.url}/project/${projectId(root, inst)}`;
      const page = join(out, 'audit-report.html');
      const creds = readCredentials();
      const show = flags.open !== false;
      const copied = show && creds.url === inst.url && creds.password ? toClipboard(creds.password) : false;
      if (show) {
        await openInOrder(link);
        if (existsSync(page)) await openInOrder(page);
      }
      say(show ? `  ✓ opened ${link}${copied ? ` (sign in as ${maskEmail(creds.email)}: the password is in your clipboard)` : ''}${existsSync(page) ? `, then the audit page ${page}` : ''}` : `  - ${link}`);
      print({ project: link, page: existsSync(page) ? page : null, pdf: existsSync(join(out, 'audit-report.pdf')) ? join(out, 'audit-report.pdf') : null, signin: { email: creds.url === inst.url ? maskEmail(creds.email) : null, passwordCopied: copied }, opened: show });
      return 0;
    }
    case 'prove': {
      const root = repoRoot();
      const file = positional[0] ?? join(root, '.cybedefend', 'out', 'audit.sarif');
      const marked = await markProven(inst, { project: projectId(root, inst), file, branch: currentBranch(root, flags.branch), out: join(root, '.cybedefend', 'out') });
      print({ marked: marked.filter((m) => m.marked).length, of: marked.length, findings: marked });
      return marked.every((m) => m.marked) ? 0 : 2;
    }
    case 'merge': {
      const root = repoRoot();
      const out = flags.out ? resolve(flags.out) : join(root, '.cybedefend', 'out');
      print(mergeAudit({ out, root }));
      return 0;
    }
    case 'board': {
      // The scan, tool by tool: what the user reads once the scanners are done.
      const root = repoRoot();
      const out = flags.out ? resolve(flags.out) : join(root, '.cybedefend', 'out');
      const b = scanBoard({ out });
      // The live page gets the same lines, whatever its own updates missed.
      updateWatch(out, (w) => {
        for (const r of b.rows) setTool(w, r.name, { type: r.type, state: r.state, results: r.results, unit: r.unit, seconds: r.seconds, note: r.note });
        w.scan = { files: b.files, seconds: b.seconds };
        w.setup = 'done';
      });
      // --json: the board and the same scan as one sentence (start.mjs ends on both).
      if (flags.json) print({ text: b.text, said: b.said });
      else process.stdout.write(`${b.text}\n`);
      return 0;
    }
    case 'watch': {
      // The live page of the run (watch.mjs). Never fails a run: whatever happens here, exit 0.
      //   watch --start [--no-open]        a new run: the page is written, and opened in the browser
      //   watch --plan <scan.mjs --plan's output>   the tools of this repository, waiting or left out
      //   watch --step <n> --state run|done [--note "..."]
      //   watch --replay [--speed <n>] [--max-gap <seconds>] [--delay <seconds>] [--no-open]   the last run played again on a page of its own
      try {
        const root = repoRoot();
        const out = join(root, '.cybedefend', 'out');
        // Nobody to show a page to in CI, or when the run is unattended (--no-open, CYBEDEFEND_NO_OPEN=1).
        const quiet = flags.open === false || Boolean(process.env.CI) || ['1', 'true', 'yes'].includes(String(process.env.CYBEDEFEND_NO_OPEN ?? '').toLowerCase());
        if (flags.replay) {
          const { frames, which } = replaySource(out);
          if (!frames.length) {
            say('  replay: no run to play again here. The page of a run is kept from this version on: run /cybedefend once, then ask again.');
            return 0;
          }
          const options = { speed: Number(flags.speed) > 0 ? Number(flags.speed) : 1, maxGap: Number(flags['max-gap']) > 0 ? Number(flags['max-gap']) : null, delay: flags.delay !== undefined && flags.delay !== true && Number(flags.delay) >= 0 ? Number(flags.delay) : 15 };
          if (flags.now) {
            // The one that plays: started on its own by the call below, it lasts as long as the run did.
            await replayWatch({ out, ...options, onReady: (file) => (quiet ? null : openWatch(out, { file, front: true })) });
            return 0;
          }
          // Returns at once: the replay plays by itself, whatever ends this command.
          const args = [fileURLToPath(import.meta.url), 'watch', '--replay', '--now', '--speed', String(options.speed), '--delay', String(options.delay), ...(options.maxGap ? ['--max-gap', String(options.maxGap)] : []), ...(quiet ? ['--no-open'] : [])];
          const child = spawn(process.execPath, args, { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
          child.on('error', () => {});
          child.unref();
          const seconds = Math.round(replayTimeline(frames, options).at(-1) / 1000);
          const said = which === 'kept' ? `the last run that reached its verdict (${new Date(frames[0].t).toISOString().slice(0, 16).replace('T', ' ')} UTC, not the one in progress)` : which === 'unfinished' ? 'this run as far as it went (it has no verdict yet)' : 'the last run';
          // It says the page opens only when it does: unattended, the page is written and its path is given.
          say(`  replay: the page of ${said} plays again${quiet ? '. No browser was opened (unattended run), the page is here' : ' in the browser, in front'}: ${replayFile(out)}`);
          say(`  replay: it starts in ${options.delay} s and lasts ${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s (${frames.length} states${options.speed !== 1 ? `, ${options.speed} times faster` : ''}${options.maxGap ? `, waits cut to ${options.maxGap} s` : ''}). Nothing runs again: it is the run as it was.`);
          return 0;
        }
        if (flags.start) {
          let branch = '';
          try {
            branch = currentBranch(root);
          } catch {
            /* no branch yet */
          }
          const started = startWatch({ out, repo: basename(root), branch });
          const opened = started && !quiet ? openWatch(out) : false;
          if (started) say(`  live view: ${pageFile(out)}${opened ? ' (opened in the browser: the run shows there as it happens)' : ''}`);
        }
        if (typeof flags.plan === 'string' && existsSync(flags.plan)) {
          const rows = readFileSync(flags.plan, 'utf8').split('\n').slice(1).filter((l) => l.trim() && !l.startsWith('note:')).map((l) => {
            const [name, type, , how, ...why] = l.trim().split(/\s+/);
            return { name, type, how, why: why.join(' ') };
          });
          updateWatch(out, (w) => {
            w.setup = 'done';
            for (const r of rows) setTool(w, r.name, r.how === 'skip' || r.how === 'none' ? { type: r.type, state: 'skip', note: whyNot(r.name, r.why) } : { type: r.type, state: 'wait' });
          });
        }
        if (flags.step !== undefined && flags.step !== true) {
          updateWatch(out, (w) => {
            for (const n of String(flags.step).split(',')) setStep(w, Number(n), { ...(typeof flags.state === 'string' ? { state: flags.state } : {}), ...(typeof flags.note === 'string' ? { note: flags.note.slice(0, 160) } : {}) });
          });
        }
      } catch {
        /* the page is a view of the run, never a reason to stop it */
      }
      return 0;
    }
    case 'watch-tool': {
      // scan.mjs, as each tool starts and ends: watch-tool <name> run | done <results> <seconds> | fail <why>
      try {
        const out = flags.out ? resolve(flags.out) : join(repoRoot(), '.cybedefend', 'out');
        const [name, state, a, b] = positional;
        if (name && ['run', 'done', 'fail', 'skip', 'wait'].includes(state)) {
          updateWatch(out, (w) => {
            if (state === 'done') setTool(w, name, { type: flags.type, state, results: a === undefined || a === '' ? null : Number(a), unit: a === undefined || a === '' ? '' : unitOf(Number(a), flags.type, name), seconds: b === undefined || b === '' ? null : Number(b) });
            else if (state === 'fail' || state === 'skip') setTool(w, name, { type: flags.type, state, note: state === 'skip' ? whyNot(name, a) : String(a ?? '').replace(/\s+/g, ' ').slice(0, 400) });
            else setTool(w, name, { type: flags.type, state });
          });
        }
      } catch {
        /* never a reason to stop a scan */
      }
      return 0;
    }
    case 'progress': {
      // The AI scanner says where it is: one line for the user's screen, the same on the live page.
      //   progress --of 28                       how many entry points it will review
      //   progress --reviewed 12                 how many it has reviewed so far
      //   progress --flaw "<who does what to whom>" --where <file:line>   a proof test just failed for its reason
      //   progress --lead "<what>" --where <file:line>                   a lead it could not prove
      //   progress --say "<a short line>"        anything else worth a line
      const root = repoRoot();
      const out = join(root, '.cybedefend', 'out');
      const number = (v) => (v !== undefined && v !== true && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : undefined);
      const text = (v) => (typeof v === 'string' ? v : '');
      let hide = (t) => maskInProse(t);
      try {
        // A line for the screen never carries a secret the scan located, nor a value named like one.
        const values = locatedSecrets(out, root).values;
        hide = (t) => maskInProse(values.reduce((x, val) => x.split(val).join(MASK), String(t ?? '')));
      } catch {
        /* no scan yet: nothing located */
      }
      // Without a run to show (the audit alone, an older session), the count still has a place to live.
      if (!readWatch(out)) {
        let branch = '';
        try {
          branch = currentBranch(root);
        } catch {
          /* no branch yet */
        }
        startWatch({ out, repo: basename(root), branch });
        updateWatch(out, (w) => {
          w.setup = 'done';
          setStep(w, 1, { state: 'done' });
        });
      }
      const where = text(flags.where);
      const state = updateWatch(out, (w) => {
        if (w.steps[1].state === 'todo') setStep(w, 2, { state: 'run' });
        const of = number(flags.of);
        const reviewed = number(flags.reviewed);
        if (of !== undefined) w.audit.of = of;
        if (reviewed !== undefined) w.audit.reviewed = w.audit.of ? Math.min(reviewed, w.audit.of) : reviewed;
        if (text(flags.flaw) && sayFinding(w, { kind: 'flaw', text: hide(flags.flaw), where })) w.audit.flaws += 1;
        if (text(flags.lead) && sayFinding(w, { kind: 'lead', text: hide(flags.lead), where })) w.audit.leads += 1;
        if (text(flags.say)) addFeed(w, { kind: 'note', text: hide(flags.say), where });
      });
      const audit = state?.audit ?? { of: number(flags.of), reviewed: number(flags.reviewed) ?? 0, flaws: text(flags.flaw) ? 1 : 0, leads: text(flags.lead) ? 1 : 0 };
      process.stdout.write(`${counterLine(audit)}\n`);
      // Said once, when the count starts: the page and the user follow the review only if it is said as it goes.
      if (number(flags.of) !== undefined && number(flags.reviewed) === undefined && !text(flags.flaw)) process.stdout.write('  next: progress --reviewed <n> after each file you review, and progress --flaw "<who does what to whom>" --where <file:line> the moment a proof test fails\n');
      if (text(flags.flaw)) process.stdout.write(`  ✗ proven: ${hide(flags.flaw).replace(/\s+/g, ' ').slice(0, 200)}${where ? `  (${where})` : ''}\n`);
      return 0;
    }
    case 'digest': {
      // What the scanners found, short: read by the AI scanner before its review.
      const root = repoRoot();
      const out = flags.out ? resolve(flags.out) : join(root, '.cybedefend', 'out');
      process.stdout.write(`${digest({ out, root })}\n`);
      return 0;
    }
    case 'assess': {
      // --save <file> [--part <name>]: the triage the agent wrote, outside .cybedefend, saved where the skill reads it and remembered.
      if (flags.save !== undefined) {
        if (typeof flags.save !== 'string') throw new Exit(64, 'Usage: assess --save <the file you wrote> [--part <name>]');
        const root = repoRoot();
        const name = saveAssessments({ root, out: join(root, '.cybedefend', 'out'), from: flags.save, part: typeof flags.part === 'string' ? flags.part : undefined });
        say(`  ✓ saved as .cybedefend/out/${name}: the next assess --check and finish apply it`);
        print({ saved: `.cybedefend/out/${name}` });
        return 0;
      }
      // With --check: the triage against this scan, on this machine, while the AI scanner works.
      if (flags.check || flags.wait !== undefined) {
        const root = repoRoot();
        // --fresh, right after a scan (start.mjs): this run starts from the verdicts the last finish kept.
        if (flags.fresh) putAwayKeptTriage({ root, out: join(root, '.cybedefend', 'out') });
        const { code, doc } = await checkTriage({ root, out: join(root, '.cybedefend', 'out'), wait: flags.wait, accept: flags['accept-verdicts'] });
        // Nothing judged yet: the page keeps its line that says the triage is judging.
        if (doc.triage?.scannerFindings && doc.triage.judged > 0) {
          updateWatch(join(root, '.cybedefend', 'out'), (w) => {
            w.triage = { total: doc.triage.scannerFindings, judged: doc.triage.judged, kept: doc.triage.kept, setAside: doc.triage.setAside };
            if (code === 0) setStep(w, 3, { state: 'done' });
          });
        }
        print(doc);
        return code;
      }
      // The assessments alone, after a finish: places them on the open findings and sends them.
      const root = repoRoot();
      const project = projectId(root, inst);
      const out = join(root, '.cybedefend', 'out');
      const { list, problems, fromFiles } = readAssessments(out, { root, accept: flags['accept-verdicts'] });
      const acceptVerdicts = fromFiles.accepted;
      sayFromFiles(fromFiles);
      if (problems.length) {
        for (const problem of problems) say(`  ✗ ${problem}`);
        print({ ok: false, problems });
        return 64;
      }
      const runFile = join(out, 'run.json');
      if (!existsSync(runFile)) throw new Exit(64, 'No run yet: scan and send first.');
      const types = [...new Set((JSON.parse(readFileSync(runFile, 'utf8')).scans ?? []).map((x) => x.type).filter((t) => IMPORT_TYPES.includes(t)))];
      const merged = mergeAudit({ out, root, dashboard: await openFindings(inst, { project, types, branch: currentBranch(root, flags.branch) }) });
      const applied = await applyAssessments(inst, { project, merged, list, setAside: flags['set-aside'] !== false, root, out });
      writeTriage({ out, root, merged });
      try {
        keepTriage({ root, merged, accept: acceptVerdicts });
      } catch {
        /* judged again next time */
      }
      const t = applied.totals;
      say(`TRIAGE: ${t.judged} of ${t.scannerFindings} findings of the scanners judged, ${t.setAside} set aside, ${t.kept - t.notJudged} kept. "finish" gives the verdict the policies give after it.`);
      print({ ok: true, triage: { scannerFindings: t.scannerFindings, judged: t.judged, setAside: t.setAside, proven: t.proven, reachable: t.reachable, notJudged: t.notJudged, notJudgedFirst: t.notJudgedFirst }, notPlaced: applied.done.filter((a) => !a.placed).map((a) => a.target) });
      return applied.done.every((a) => a.placed) ? 0 : 2;
    }
    case 'ignore': {
      // Only after the user's explicit yes, with the reason they gave: the
      // finding leaves the verdict, and the reason stays in the audit trail.
      const root = repoRoot();
      const project = projectId(root, inst);
      const id = positional[0];
      const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
      if (!id || reason.length < 5) throw new Exit(64, 'Usage: ignore <finding id> --reason "<the reason the user gave>"');
      // The reason twice: as the dismissal's, which the export keeps, and as a comment, which the finding's history shows.
      const res = await call(inst, 'PATCH', `/project/${project}/results/${id}`, { json: { status: 'ignored', dismissalReason: reason.slice(0, 512), comment: reason.slice(0, 512) } });
      if (res.status < 200 || res.status >= 300) throw new Exit(2, `The dashboard refused to ignore ${id} (HTTP ${res.status}).`);
      print({ ok: true, id, status: 'ignored', reason: reason.slice(0, 512) });
      return 0;
    }
    case 'write-audit': {
      // audit.md, step 4: the findings as a short list; the SARIF file is written here, the same way in every run.
      //   write-audit [findings.json]   writes .cybedefend/out/audit.sarif
      //   write-audit <file> --add      adds that file's findings to the audit file that is there (a flaw found during a fix)
      const root = repoRoot();
      const out = join(root, '.cybedefend', 'out');
      const file = positional[0] ? resolve(positional[0]) : join(out, 'findings.json');
      const target = join(out, 'audit.sarif');
      // findings.json is the whole audit of a run: adding it again would bring back what a fix took out.
      if (flags.add && !positional[0]) throw new Exit(64, 'write-audit --add: name the file that holds the new finding(s) alone, for example "write-audit .cybedefend/out/new-findings.json --add".');
      if (!existsSync(file)) throw new Exit(64, `write-audit: no ${file}. Write the findings there first (audit.md, step 4); an audit with no finding is { "findings": [] }.`);
      let input;
      try {
        input = JSON.parse(readFileSync(file, 'utf8'));
      } catch (err) {
        throw new Exit(64, `write-audit: ${file} is not JSON (${err.message}).`);
      }
      const { doc, problems } = auditFromFindings(input);
      if (!problems.length && flags.add) {
        if (!existsSync(target)) throw new Exit(64, 'write-audit --add: no .cybedefend/out/audit.sarif to add to.');
        const old = JSON.parse(readFileSync(target, 'utf8'));
        const run = old.runs?.[0];
        if (!run) throw new Exit(64, 'write-audit --add: the audit file has no run.');
        const key = (r) => `${r.ruleId}|${r.locations?.[0]?.physicalLocation?.artifactLocation?.uri}|${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
        const have = new Set((run.results ?? []).map(key));
        run.results = [...(run.results ?? []), ...doc.runs[0].results.filter((r) => !have.has(key(r)))];
        run.tool.driver.rules = [...(run.tool.driver.rules ?? []), ...doc.runs[0].tool.driver.rules.filter((r) => !(run.tool.driver.rules ?? []).some((x) => x.id === r.id))];
        doc.runs = old.runs;
      }
      // What "check --audit" would refuse is said now, while the list is in front of the agent.
      if (!problems.length) problems.push(...checkAudit(doc));
      if (problems.length) {
        for (const problem of problems) say(`  ✗ ${problem}`);
        say(`write-audit: nothing was written. Correct the ${problems.length} point(s) above in ${basename(file)}, then run it again (exit 64)`);
        print({ ok: false, written: false, problems });
        return 64;
      }
      mkdirSync(out, { recursive: true });
      writeFileSync(target, `${JSON.stringify(doc, null, 2)}\n`);
      const results = doc.runs[0].results;
      const proven = results.filter((r) => r.properties?.proven === true).length;
      say(`write-audit: ${results.length} finding(s) in .cybedefend/out/audit.sarif: ${proven} proven, ${results.length - proven} lead(s), ${doc.runs[0].tool.driver.rules.length} rule(s)`);
      const custom = [...new Set(results.map((r) => r.ruleId.split('/')[1]).filter((k) => !KINDS[k]))];
      if (custom.length) say(`write-audit: kind(s) of your own: ${custom.join(', ')}. Fine when no kind of audit.md fits.`);
      if (!flags.add && existsSync(join(root, '.cybedefend', 'audit', 'last.sarif'))) say('write-audit: a last audit exists and this file was written afresh: run "keep --reviewed <the files you reviewed>" now (audit.md, step 5).');
      // The live page shows the audit as it is written: every finding in the feed once, the counts as the file has them.
      const map = readMap(join(root, '.cybedefend', 'audit', 'map.md'));
      // The number said when the review began and the number of rows the map ends with: one of them reaches the user twice.
      const announced = Number(readWatch(out)?.audit?.of) || 0;
      if (map?.rows && announced && announced !== map.rows) say(`write-audit: the map holds ${map.rows} entry points and ${announced} were announced when the review began: in the report give the map's number, and say in one line why they differ (two routes that are one, a file that holds none).`);
      updateWatch(out, (w) => {
        setFindings(w, results.map((r) => {
          const loc = r.locations?.[0]?.physicalLocation;
          return { kind: r.properties?.proven === true ? 'flaw' : 'lead', text: r.properties?.title ?? String(r.message?.text ?? '').split(/(?<=[.!?])\s/)[0], where: `${loc?.artifactLocation?.uri ?? ''}:${loc?.region?.startLine ?? ''}` };
        }));
        w.audit.flaws = proven;
        w.audit.leads = results.length - proven;
        if (map?.rows) {
          w.audit.of = map.rows;
          w.audit.reviewed = map.ok + map.finding + map.lead + map.notExamined;
        }
        setStep(w, 2, { state: 'done' });
      });
      print({ ok: true, written: true, findings: results.length, proven, leads: results.length - proven, rules: doc.runs[0].tool.driver.rules.length, kindsOfYourOwn: custom });
      return 0;
    }
    case 'keep': {
      // What the last audit found and is still true goes back into this
      // run's audit file, so the dashboard does not close it:
      //   keep --reviewed a.py,b.py   after a review (audit.md, step 5)
      //   keep --fixed <proof test or file:line>,...   after a fix (fix.md)
      const root = repoRoot();
      const out = join(root, '.cybedefend', 'out');
      const lastFile = join(root, '.cybedefend', 'audit', 'last.sarif');
      const newFile = join(out, 'audit.sarif');
      const whereOf = (r) => `${r.locations?.[0]?.physicalLocation?.artifactLocation?.uri}:${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
      const testOf = (r) => String(r.properties?.proofTest ?? '').split(' > ').pop().split('::').pop().trim();
      const kindOf = (r) => String(r.ruleId ?? '').split('/')[1] ?? '';
      // A kept finding follows its line when the file changed around it.
      const follow = (results) => {
        const cache = new Map();
        const moved = [];
        const check = [];
        for (const r of results) {
          const before = whereOf(r);
          const how = followLine(r, root, cache);
          if (how === 'moved') moved.push(`${before} is now line ${r.locations[0].physicalLocation.region.startLine}`);
          else if (how === 'unsure') check.push({ where: whereOf(r), ruleId: r.ruleId, why: `moved from ${before}, and several lines read the same` });
          else if (how === 'changed') check.push({ where: before, ruleId: r.ruleId, why: 'the code on its line changed' });
          else if (how === 'gone') check.push({ where: before, ruleId: r.ruleId, why: 'its file is not there anymore' });
        }
        for (const m of moved) say(`keep: ${m}`);
        for (const c of check) say(`keep: check the line of ${c.where} (${c.ruleId}): ${c.why}. Correct "startLine" in .cybedefend/out/audit.sarif, or leave the finding out when its code is gone.`);
        return { moved, check };
      };
      if (typeof flags.fixed === 'string') {
        if (!existsSync(lastFile)) throw new Exit(64, 'keep --fixed: no .cybedefend/audit/last.sarif to start from.');
        const entries = flags.fixed.split(',').map((x) => x.trim().replace(/^\.\//, '')).filter(Boolean);
        const doc = JSON.parse(readFileSync(lastFile, 'utf8'));
        const results = doc.runs?.[0]?.results ?? [];
        const drop = new Set();
        const unknown = [];
        const shared = [];
        for (const entry of entries) {
          const m = /^(.+):(\d+)(?::([\w./-]+))?$/.exec(entry);
          let hits;
          if (m) {
            const here = results.filter((r) => whereOf(r) === `${m[1]}:${m[2]}`);
            hits = m[3] ? here.filter((r) => r.ruleId === m[3] || kindOf(r) === m[3] || testOf(r) === m[3]) : here;
            // Two findings on one line: fixing one must not close the other.
            if (!m[3] && new Set(here.map((r) => `${r.ruleId}|${testOf(r)}`)).size > 1) {
              shared.push(`${here.length} findings at ${entry}: name the fixed one by its proof test (${here.map((r) => testOf(r) || `${entry}:${kindOf(r)}`).join(', ')})`);
              continue;
            }
          } else hits = results.filter((r) => testOf(r) === entry);
          if (!hits.length) unknown.push(entry);
          for (const r of hits) drop.add(r);
        }
        if (shared.length) {
          for (const x of shared) say(`keep --fixed: ${x}`);
          throw new Exit(64, 'keep --fixed: nothing was written. A finding is named by its proof test, or by file:line when it is alone on its line.');
        }
        const kept = results.filter((r) => !drop.has(r));
        const fixed = [...drop].map((r) => `${whereOf(r)}${testOf(r) ? ` (${testOf(r)})` : ''}`);
        const followed = follow(kept);
        doc.runs[0].results = kept;
        const used = new Set(kept.map((r) => r.ruleId));
        doc.runs[0].tool.driver.rules = (doc.runs[0].tool.driver.rules ?? []).filter((r) => used.has(r.id));
        // Says to "keep --reviewed" that this file already is the last audit, so it adds nothing back.
        doc.runs[0].properties = { ...(doc.runs[0].properties ?? {}), keptFromLastAudit: true };
        mkdirSync(out, { recursive: true });
        writeFileSync(newFile, `${JSON.stringify(doc, null, 2)}\n`);
        say(`keep: ${drop.size} fixed finding(s) left out, ${kept.length} still in the audit file${followed.moved.length ? `, ${followed.moved.length} followed to their new line` : ''}`);
        for (const x of unknown) say(`keep: no finding of the last audit for "${x}": check the test's name, or the file and the line`);
        print({ fixed, kept: kept.length, moved: followed.moved, checkTheLine: followed.check, unknown });
        return unknown.length ? 2 : 0;
      }
      if (!existsSync(newFile)) throw new Exit(64, 'keep: write this run\'s .cybedefend/out/audit.sarif first (it may hold no result), then run keep.');
      if (!existsSync(lastFile)) {
        print({ kept: [], recheck: [], note: 'no last audit: nothing to keep' });
        return 0;
      }
      const reviewed = new Set(String(flags.reviewed ?? '').split(',').map((f) => f.trim().replace(/^\.\//, '')).filter(Boolean));
      const fresh = JSON.parse(readFileSync(newFile, 'utf8'));
      const last = JSON.parse(readFileSync(lastFile, 'utf8'));
      const run = fresh.runs?.[0];
      if (!run) throw new Exit(64, 'keep: the new audit file has no run.');
      if (run.properties?.keptFromLastAudit) {
        say('keep: this audit file was written by "keep --fixed": it already is the last audit without what was fixed. Nothing to add.');
        print({ kept: [], recheck: [], note: 'already the last audit without what was fixed' });
        return 0;
      }
      run.results ??= [];
      run.tool.driver.rules ??= [];
      const key = (r) => `${r.ruleId}|${r.locations?.[0]?.physicalLocation?.artifactLocation?.uri}|${r.locations?.[0]?.physicalLocation?.region?.startLine}`;
      const have = new Set(run.results.map(key));
      const place = new Set(run.results.map((r) => `${r.locations?.[0]?.physicalLocation?.artifactLocation?.uri}|${r.locations?.[0]?.physicalLocation?.region?.startLine}`));
      const lastRules = new Map((last.runs?.[0]?.tool?.driver?.rules ?? []).map((r) => [r.id, r]));
      const kept = [];
      const carried = [];
      const recheck = [];
      for (const r of last.runs?.[0]?.results ?? []) {
        const uri = r.locations?.[0]?.physicalLocation?.artifactLocation?.uri;
        const line = r.locations?.[0]?.physicalLocation?.region?.startLine;
        if (have.has(key(r))) continue;
        if (reviewed.has(uri)) {
          // Reviewed this time and not in the new file: fixed, moved, or missed. The agent's to decide.
          if (!place.has(`${uri}|${line}`)) recheck.push({ ruleId: r.ruleId, where: `${uri}:${line}`, proofTest: r.properties?.proofTest ?? null });
          continue;
        }
        run.results.push(r);
        carried.push(r);
        if (!run.tool.driver.rules.some((x) => x.id === r.ruleId) && lastRules.has(r.ruleId)) run.tool.driver.rules.push(lastRules.get(r.ruleId));
        kept.push({ ruleId: r.ruleId, where: `${uri}:${line}` });
      }
      const followed = follow(carried);
      writeFileSync(newFile, `${JSON.stringify(fresh, null, 2)}\n`);
      say(`keep: ${kept.length} finding(s) of the last audit, in files this run did not review, kept as they were`);
      for (const r of recheck) say(`keep: re-check ${r.where} (${r.ruleId}): in a file you reviewed and not in your new file. Run its proof test${r.proofTest ? ` (${String(r.proofTest).split(' > ').pop()})` : ''}: still failing, add it back; passing, it is fixed.`);
      print({ kept, recheck, moved: followed.moved, checkTheLine: followed.check });
      return 0;
    }
    case 'blocks': {
      // What blocks, short: the working list of /cybedefend fix. verdict.json holds the same and five times more.
      const root = repoRoot();
      const file = join(root, '.cybedefend', 'out', 'verdict.json');
      if (!existsSync(file)) throw new Exit(64, 'No verdict yet: run /cybedefend first (start.mjs, then finish).');
      const v = JSON.parse(readFileSync(file, 'utf8'));
      const b = v.blocks ?? { code: [], findings: 0, elsewhere: 0, dependencies: { advisories: 0, packages: 0, upgrades: [], broughtInBy: [] } };
      const inDashboard = b.findings ?? b.code.length;
      const flat = (t, n) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
      const lines = [v.verdict === 'SHIP' ? 'BLOCKS: nothing, the verdict is SHIP' : `BLOCKS: ${b.code.length} in the code and its configuration${inDashboard > b.code.length ? ` (${inDashboard} findings in the dashboard: several tools report the same flaw)` : ''}, ${counted(b.dependencies.advisories, 'advisory', 'advisories')} on ${counted(b.dependencies.packages, 'package')} to upgrade`];
      if (b.code.length) lines.push('', 'CODE AND CONFIGURATION, the most severe first, what a test proves before what a tool reports');
      const firstWith = new Map();
      b.code.forEach((f, i) => {
        const fix = flat(f.fix, 300);
        const same = fix ? firstWith.get(fix) : undefined;
        if (fix && !same) firstWith.set(fix, i + 1);
        lines.push(`${i + 1}. ${f.severity} | ${f.where} | ${f.foundBy}${f.proofTest ? ` | test ${String(f.proofTest).split(' > ').pop().split('::').pop()}` : ''} | id ${(f.ids?.length ? f.ids : [f.id ?? '-']).join(', ')}`);
        lines.push(`   ${flat(f.message ?? f.what, 220)}`);
        if (fix) lines.push(`   fix: ${same ? `the same as number ${same}` : fix}`);
        if (f.assessment) lines.push(`   your assessment: ${flat(f.assessment, 220)}`);
      });
      if (b.elsewhere) lines.push('', `${b.elsewhere} more block from elsewhere in the project (another branch, or an earlier scan this run did not repeat).`);
      // The policies' own count is the one the verdict gives: when this list places fewer, it says so, never a silent zero.
      const placedHere = inDashboard + (b.dependencies.advisories ?? 0) + (b.elsewhere ?? 0);
      if (v.verdict !== 'SHIP' && Number(v.blockingCount) > placedHere) lines.push('', `The policies count ${v.blockingCount} blocking finding(s) in all: ${Number(v.blockingCount) - placedHere} of them could not be placed on this run's results. The project's page in the dashboard lists every one; "finish" places them again.`);
      if (b.dependencies.upgrades.length) {
        lines.push('', 'DEPENDENCIES, one line per package to upgrade');
        for (const d of b.dependencies.upgrades) lines.push(`- ${d.package}@${d.installed} → ${shownUpgrade(d.upgradeTo)} (${counted(d.advisories, 'advisory', 'advisories')}, ${d.severity}; ${d.lockfile}${d.broughtInBy ? `; brought in by ${d.broughtInBy}` : ''})${d.assessment ? `; your assessment: ${flat(d.assessment, 200)}` : ''}`);
        const main = (b.dependencies.broughtInBy ?? []).find((x) => x.dependency && x.dependency !== 'a direct dependency');
        if (main && main.packages > 1) lines.push(`  ${main.advisories} of those advisories come in through ${main.dependency}: one upgrade there clears them together.`);
      }
      process.stdout.write(`${lines.join('\n')}\n`);
      return 0;
    }
    case 'redact': {
      // scan.mjs, after the tools: redact --src <the copy that was scanned> [--out <dir>]
      const root = repoRoot();
      const out = flags.out ? resolve(flags.out) : join(root, '.cybedefend', 'out');
      const r = redactOut({ out, src: flags.src ? resolve(flags.src) : root });
      if (r.places.length) {
        const shown = r.places.slice(0, 8).map((x) => `${x.file}:${x.line} (${x.kind})`).join(', ');
        say(`secrets: ${r.places.length} in the code: ${shown}${r.places.length > 8 ? ', …' : ''}`);
        say('secrets: their values are masked in every result. Never print those lines: read such a file with "cybedefend.mjs show <file>".');
      }
      print({ secrets: r.places.map((x) => ({ file: x.file, line: x.line, kind: x.kind })), masked: r.replaced, files: r.files });
      return 0;
    }
    case 'show': {
      // A file of the repository, the secrets Gitleaks located in it masked:
      // what the agent reads instead of the file itself.
      const root = repoRoot();
      const file = positional[0];
      if (!file) throw new Exit(64, 'Usage: show <file>');
      // The real path: a symbolic link of the repository can point to a file outside it (a key in the user's home).
      const path = insideRoot(root, resolve(file));
      if (!path || path === insideRoot(root, root) || !statSync(path).isFile()) throw new Exit(64, `show: ${file} is not a file of this repository`);
      const { values, places } = locatedSecrets(join(root, '.cybedefend', 'out'), root);
      const located = values.reduce((t, v) => t.split(v).join(MASK), readFileSync(path, 'utf8'));
      // A settings file by its name; anything else is read as source code.
      const settings = /(^|[./_-])(env|ini|cfg|conf|config|properties|toml|ya?ml)(\.|$)|(^|\/)(Makefile|Dockerfile[^/]*|[^/]*compose[^/]*\.ya?ml)$/i.test(basename(path)) || /\.env(\.|$)/i.test(basename(path));
      const { text, masked } = maskNamedSecrets(located, { code: !settings });
      const here = places.filter((x) => insideRoot(root, x.file) === path).length;
      process.stdout.write(text.split('\n').map((l, i) => `${String(i + 1).padStart(5)}  ${l}`).join('\n') + '\n');
      say(`${here} secret(s) the scan located and ${masked} value(s) named like a key, a token or a password are masked in this file`);
      return 0;
    }
    case 'readable-rules': {
      // scan.mjs, after the tools: readable-rules [--out <dir>]
      const out = flags.out ? resolve(flags.out) : join(repoRoot(), '.cybedefend', 'out');
      print(readableOut({ out }));
      return 0;
    }
    case 'strip-rule-prefix': {
      // scan.mjs, after Opengrep: strip-rule-prefix <file.sarif> <the --config path it ran with>
      const [file, config] = positional;
      if (!file || !config) throw new Exit(64, 'Usage: strip-rule-prefix <file.sarif> <config path>');
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      const n = stripRulePrefix(doc, config);
      writeFileSync(file, JSON.stringify(doc));
      print({ renamed: n });
      return 0;
    }
    case 'doctor': {
      const result = await doctor(inst, repoRoot());
      print(result);
      return result.ok ? 0 : 3;
    }
    case 'import': {
      const root = repoRoot();
      const file = positional[0];
      if (!file || !flags.type) throw new Exit(64, 'Usage: import <file.sarif> --type <type> [--sbom <file>] [--image <ref>] [--branch <b>] [--no-wait]');
      const project = projectId(root, inst);
      const branch = currentBranch(root, flags.branch);
      const r = await importFile(inst, { root, project, file, type: flags.type, sbom: flags.sbom, image: flags.image, branch, wait: flags.wait !== false });
      if (flags['add-to-run'] === true) {
        // The audit joins the scan's run, so the verdict reads its policies too.
        const runFile = join(root, '.cybedefend', 'out', 'run.json');
        const run = existsSync(runFile) ? JSON.parse(readFileSync(runFile, 'utf8')) : { projectId: project, branch, at: new Date().toISOString(), scans: [] };
        const scanner = basename(file).replace(/\.(sarif|json|sarif\.gz)$/, '');
        run.scans = run.scans.filter((x) => x.scanner !== scanner);
        run.scans.push({ scanner, tier: 'audit', ...r });
        mkdirSync(dirname(runFile), { recursive: true });
        writeFileSync(runFile, `${JSON.stringify(run, null, 2)}\n`);
      }
      print({ ...r, link: `${inst.url}/project/${project}/scan/${r.scanId}` });
      return r.state === 'failed' || r.state === 'cancelled' ? 2 : 0;
    }
    case 'send': {
      const root = repoRoot();
      const project = projectId(root, inst);
      const out = flags.out ? resolve(flags.out) : join(root, '.cybedefend', 'out');
      const run = await sendRun(inst, { root, project, out, branch: currentBranch(root, flags.branch), image: flags.image, addToRun: flags['add-to-run'] === true });
      print({ ...run, links: links(inst, project, run) });
      return run.scans.some((s) => s.state === 'failed') ? 2 : 0;
    }
    case 'verdict': {
      const root = repoRoot();
      const project = projectId(root, inst);
      const runFile = flags.run ? resolve(flags.run) : join(root, '.cybedefend', 'out', 'run.json');
      if (!existsSync(runFile)) throw new Exit(64, `No run at ${runFile}: run scan.mjs then send first.`);
      const run = JSON.parse(readFileSync(runFile, 'utf8'));
      const v = await verdict(inst, { project, run });
      writeFileSync(join(root, '.cybedefend', 'out', 'verdict.json'), `${JSON.stringify(v, null, 2)}\n`);
      print({ ...v, links: links(inst, project, run) });
      return v.verdict === 'SHIP' ? 0 : 1;
    }
    case 'instance-scan': {
      const root = repoRoot();
      const project = projectId(root, inst);
      const run = await instanceScan(inst, { root, project, branch: currentBranch(root, flags.branch) });
      mkdirSync(join(root, '.cybedefend', 'out'), { recursive: true });
      writeFileSync(join(root, '.cybedefend', 'out', 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
      print({ ...run, links: links(inst, project, run) });
      return run.scans.some((s) => s.state === 'failed') ? 2 : 0;
    }
    case 'report': {
      const root = repoRoot();
      const project = projectId(root, inst);
      const r = await report(inst, { project, branch: currentBranch(root, flags.branch), kind: flags.kind, format: flags.format });
      print(r);
      return 0;
    }
    default:
      process.stderr.write(usage());
      return command ? 64 : 0;
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      if (err instanceof Exit) {
        say(err.message);
        if (err.data) process.stdout.write(`${JSON.stringify({ error: err.message, ...err.data }, null, 2)}\n`);
        process.exit(err.code);
      }
      say(`Unexpected error: ${err?.message ?? err}`);
      process.exit(3);
    },
  );
}

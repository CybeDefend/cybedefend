#!/usr/bin/env node
// The tree of /cybedefend deep: every file, function and method of the
// repository, split into branches that agents review in parallel, one branch
// each. It reads the files git sees and writes only under .cybedefend/: it
// runs no code of the repository and sends nothing. Node alone runs it, on
// macOS, Linux, Windows (PowerShell, cmd or Git Bash) and WSL.

const USAGE = `Usage, from anywhere inside the repository:
  node tree.mjs build [--branch-size <lines>] [--with-tests]
  node tree.mjs brief <branch> [--ledger]
  node tree.mjs status [<branch>]
  node tree.mjs merge [--into <findings.json>]

  build    lists the code files git sees (docs, lockfiles, vendored and
           generated code, tests, .cybedefend/ and this skill left out),
           extracts every function and method, and splits them into branches
           that follow the folders. Writes .cybedefend/deep/tree.json.
           --branch-size  lines of code per branch (default 2000); a branch
                          never splits a file
           --with-tests   keeps the test files (never the audit's proof tests)
  brief    prints the files and the functions of one branch, for the agent
           that reviews it. --ledger also writes the branch's ledger with no
           verdict yet, when it has none.
  status   reads each branch's ledger (.cybedefend/deep/branches/<branch>.json)
           and prints how many functions have a verdict, and what has none.
           With a branch: that branch alone, every function left listed.
  merge    gathers the findings of the branches
           (.cybedefend/deep/branches/<branch>.findings.json) into
           .cybedefend/out/findings.json: what is there stays, a flaw two
           branches found (same file, line and kind) is counted once.

A ledger:
  { "branch": "src_billing", "functions": {
      "src/billing/refund.ts#refund:12":  { "verdict": "ok", "check": "owner compared in loadPayment, src/billing/payments.ts:40" },
      "src/billing/refund.ts#cancel:60":  { "verdict": "flaw", "finding": "missing-object-authorization@src/billing/refund.ts:77" },
      "src/billing/credits.ts#spend:51":  { "verdict": "lead", "what": "two spends at once may both pass the check" },
      "src/billing/old.ts#migrate:8":     { "verdict": "not-reachable", "why": "no caller in the repository" },
      "src/billing/sdk.ts#(top level):1": { "verdict": "not-examined", "why": "generated at build time" } } }

Environment:
  CYBEDEFEND_TREE_EXTRACTOR  auto (default), ctags or builtin. auto uses
                             universal-ctags when it is on the PATH, else the
                             built-in extractor. The skill never installs a tool.

Exit: 0 done (status: every function has a verdict), 2 status: some functions
have no verdict yet, 3 the machine cannot do it (no git repository, no tree
built yet, no universal-ctags when it is asked for), 64 usage error, or a
ledger or a findings file that is not right (it says what is wrong).
`;

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { which } from './os.mjs';
import { runGit, trustedRoot, TreeRefused } from './trust.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

const DEFAULT_BRANCH_SIZE = 2000;
const MAX_FILE_BYTES = 1024 * 1024;
const TREE = '.cybedefend/deep/tree.json';
const BRANCHES = '.cybedefend/deep/branches';
const FINDINGS = '.cybedefend/out/findings.json';
const TOP = '(top level)';
const VERDICTS = { ok: 'check', flaw: 'finding', lead: 'what', 'not-reachable': 'why', 'not-examined': 'why' };

class Exit extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const say = (line = '') => process.stdout.write(`${line}\n`);
const slash = (p) => p.split('\\').join('/');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pad = (s, n) => String(s).padEnd(n);
const padLeft = (s, n) => String(s).padStart(n);

// ---------------------------------------------------------------------------
// The files of the review
// ---------------------------------------------------------------------------

/** Languages the built-in extractor reads, by file ending. */
const LANGUAGES = {
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', ts: 'js', tsx: 'js', mts: 'js', cts: 'js', vue: 'js', svelte: 'js',
  py: 'python', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', cs: 'csharp', php: 'php',
  rb: 'ruby', rake: 'ruby', rs: 'rust', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  swift: 'swift', scala: 'scala', dart: 'dart',
};

/** Code and configuration with no extractor of its own: each file is reviewed as one piece. */
const OTHER_CODE = new Set([
  'groovy', 'gradle', 'm', 'mm', 'ex', 'exs', 'erl', 'clj', 'cljs', 'lua', 'pl', 'pm', 'r', 'jl', 'hs', 'ml', 'fs', 'vb', 'sol', 'zig', 'nim',
  'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'graphql', 'gql', 'proto', 'tf', 'hcl',
  'yml', 'yaml', 'properties', 'ini', 'cfg', 'conf', 'env',
  'html', 'htm', 'ejs', 'hbs', 'erb', 'jinja', 'jinja2', 'j2', 'twig', 'tpl', 'pug', 'cshtml', 'razor', 'jsp',
]);
const OTHER_NAMES = /^(Dockerfile(\..+)?|.+\.Dockerfile|Makefile|Jenkinsfile|Rakefile|Gemfile|Procfile|\.env(\..+)?)$/i;

const VENDORED = /(^|\/)(node_modules|bower_components|vendor|vendors|third[_-]?party|Pods|site-packages|\.venv|venv|__pycache__|\.next|\.nuxt|dist)\//;
const GENERATED = /(\.min\.(js|css)|\.bundle\.js|\.pb\.go|_pb2(_grpc)?\.pyi?|\.pb\.(cc|h)|\.g\.(dart|cs)|\.freezed\.dart|\.designer\.cs|\.generated\.[^/]+|\.d\.ts|\.d\.mts|\.d\.cts|_generated\.[^/]+)$/i;
const TESTS = new RegExp(
  [
    '(^|/)(tests?|__tests__|specs?|testdata|test-data|fixtures|__fixtures__|__mocks__|mocks|e2e|cypress|playwright|testing)/',
    '\\.(test|spec|e2e|stories)\\.[^/]+$',
    '_test\\.(go|py|rb|exs|dart|cc|cpp|c|rs)$',
    '(^|/)test_[^/]+\\.py$',
    '(^|/)conftest\\.py$',
    '_spec\\.rb$',
    '(Test|Tests|IT|Spec)\\.(java|kt|cs|scala|groovy|swift)$',
  ].join('|'),
);
// The audit's own proof tests (proofs.md says where they go): never reviewed, with or without the tests.
const PROOFS = /(^|\/)tests?\/security\/|(^|\/)test_security_[^/]*$|\.security\.test\.[^/]+$|_security_test\.go$|security_spec\.rb$/;
const SKILL = /(^|\/)\.[^/]+\/skills\/cybedefend(\/|$)|(^|\/)skills-lock\.json$/;

/** The repository's root, with its .cybedefend tree checked before anything there is written (trust.mjs). */
function gitRoot() {
  try {
    return trustedRoot();
  } catch (e) {
    if (e instanceof TreeRefused) throw new Exit(3, `tree.mjs: ${e.message}`);
    throw new Exit(3, 'tree.mjs: not inside a git repository. Run it from the repository to review.');
  }
}

/** The files git sees: tracked and new ones, never the ignored ones. */
function gitFiles(repo) {
  let listed;
  try {
    listed = runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, maxBuffer: 256 * 1024 * 1024 });
  } catch {
    throw new Exit(3, `tree.mjs: git could not list the files of ${repo}.`);
  }
  return [...new Set(listed.toString('utf8').split('\0').filter(Boolean).map(slash))].sort();
}

function languageOf(path) {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (LANGUAGES[ext]) return LANGUAGES[ext];
  if (OTHER_CODE.has(ext) || OTHER_NAMES.test(base)) return 'other';
  return null;
}

/** Why a file is not reviewed, or null when it is. */
export function leftOut(path, { withTests = false, skillDir = '' } = {}) {
  if (path.startsWith('.cybedefend/') || path.includes('/.cybedefend/')) return 'the skill';
  if (SKILL.test(path) || (skillDir && (path === skillDir || path.startsWith(`${skillDir}/`)))) return 'the skill';
  if (PROOFS.test(path)) return 'proof tests';
  if (VENDORED.test(path)) return 'vendored';
  if (GENERATED.test(path)) return 'generated';
  if (!languageOf(path)) return 'not code';
  if (!withTests && TESTS.test(path)) return 'tests';
  return null;
}

// ---------------------------------------------------------------------------
// The built-in extractor
// ---------------------------------------------------------------------------

const HASH_COMMENT = new Set(['python', 'ruby', 'php']);
const SLASH_COMMENT = new Set(['js', 'go', 'java', 'kotlin', 'csharp', 'php', 'rust', 'c', 'cpp', 'swift', 'scala', 'dart']);
const QUOTE_STRING = new Set(['js', 'python', 'ruby', 'php', 'dart']);
const TRIPLE = new Set(['python', 'kotlin', 'java', 'scala', 'swift', 'dart']);
const BACKTICK = new Set(['js', 'go']);

/**
 * The text with what is inside its comments and strings turned into spaces:
 * same length, same lines, so a brace in a string never counts.
 */
export function mask(text, lang) {
  const out = text.split('');
  const n = text.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  // The closing backtick of a JavaScript template that opens at `open`: its ${...} may hold templates of their own.
  const templateEnd = (open) => {
    let j = open + 1;
    while (j < n) {
      if (text[j] === '\\') j += 2;
      else if (text[j] === '`') return j;
      else if (text[j] === '$' && text[j + 1] === '{') {
        let depth = 1;
        j += 2;
        while (j < n && depth > 0) {
          if (text[j] === '`') j = templateEnd(j) + 1;
          else {
            if (text[j] === '{') depth += 1;
            else if (text[j] === '}') depth -= 1;
            j += 1;
          }
        }
      } else j += 1;
    }
    return n;
  };
  // In JavaScript a `/` opens a regular expression where a value may start: after an operator, an opening bracket or a keyword.
  const regexEnd = (open, sig) => {
    if (sig >= 0) {
      const before = text[sig];
      if (/[\w$)\]}]/.test(before)) {
        const word = /[A-Za-z_$]+$/.exec(text.slice(Math.max(0, sig - 10), sig + 1))?.[0] ?? '';
        if (!/^(return|typeof|case|do|else|in|of|void|throw|yield|await|new|delete)$/.test(word)) return -1;
      }
    }
    let inClass = false;
    for (let j = open + 1; j < n; j++) {
      const ch = text[j];
      if (ch === '\n') return -1;
      if (ch === '\\') j += 1;
      else if (ch === '[') inClass = true;
      else if (ch === ']') inClass = false;
      else if (ch === '/' && !inClass) return j;
    }
    return -1;
  };
  let i = 0;
  let sig = -1; // the last character of code that is not a space
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (lang === 'js' && c === '`') {
      const j = templateEnd(i);
      blank(i + 1, j);
      sig = j;
      i = j + 1;
    } else if (lang === 'js' && c === '/' && next !== '/' && next !== '*' && regexEnd(i, sig) > 0) {
      const j = regexEnd(i, sig);
      blank(i + 1, j);
      sig = j;
      i = j + 1;
    } else if (SLASH_COMMENT.has(lang) && c === '/' && next === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
    } else if (SLASH_COMMENT.has(lang) && c === '/' && next === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blank(i, j);
      i = j;
    } else if (HASH_COMMENT.has(lang) && c === '#' && !(lang === 'php' && next === '[')) {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      blank(i, j);
      i = j;
    } else if (TRIPLE.has(lang) && (c === '"' || (c === "'" && lang === 'python')) && next === c && text[i + 2] === c) {
      let j = text.indexOf(c + c + c, i + 3);
      j = j < 0 ? n : j;
      blank(i + 3, j);
      i = j + 3;
    } else if (lang === 'csharp' && c === '@' && next === '"') {
      let j = i + 2;
      while (j < n && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      blank(i + 2, j);
      i = j + 1;
    } else if (c === '"' || (c === "'" && QUOTE_STRING.has(lang)) || (c === '`' && BACKTICK.has(lang))) {
      const multiline = c === '`';
      let j = i + 1;
      while (j < n && text[j] !== c && (multiline || text[j] !== '\n')) j += text[j] === '\\' && !(c === '`' && lang === 'go') ? 2 : 1;
      blank(i + 1, j);
      sig = j;
      i = j + 1;
    } else if (c === "'") {
      // A character literal ('x', '\n'); a Rust lifetime ('a) is left as it is.
      const m = /^'(\\.[^'\n]{0,8}|[^'\\\n])'/.exec(text.slice(i, i + 12));
      if (m) {
        blank(i + 1, i + m[0].length - 1);
        i += m[0].length;
      } else i += 1;
      sig = i - 1;
    } else {
      if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') sig = i;
      i += 1;
    }
  }
  return out.join('');
}

/** Line numbers (from 1) for offsets in a text. */
function lineIndex(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return {
    starts,
    of(offset) {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= offset) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
  };
}

/** The offset of the brace, bracket or parenthesis that closes the one at `open`, or -1. */
function closing(masked, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const o = masked[open];
  const c = pairs[o];
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === o) depth += 1;
    else if (masked[i] === c) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Where an expression that starts at `from` ends: its `;`, or the end of its last line. */
function expressionEnd(masked, from) {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i - 1;
      depth -= 1;
    } else if (depth === 0 && c === ';') return i;
    else if (depth === 0 && c === '\n') {
      const before = masked.slice(from, i).trimEnd();
      const after = /^\s*(\S)/.exec(masked.slice(i + 1, i + 200))?.[1] ?? '';
      const goesOn = /[=,+\-*/%&|?:<>(.]$/.test(before) || before === '' || /[.?:&|+\-*/]/.test(after);
      if (!goesOn) return i - 1;
    }
  }
  return masked.length - 1;
}

/**
 * The end of what a declaration header opens. From `from` (after the name),
 * the body is the first `{` outside parentheses; a `;` before it means there
 * is no body. `equals` says what a `=` is in this language: 'expression' (the
 * body is the expression), 'arrow' (only `=>` is one, a plain `=` is no
 * function), 'none' (no function) or 'skip'.
 * Returns the offset of the last character of the body, or -1.
 */
function bodyEnd(masked, from, equals = 'none') {
  let depth = 0;
  const limit = Math.min(masked.length, from + 4000);
  for (let i = from; i < limit; i++) {
    const c = masked[i];
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') {
      if (depth === 0) return -1;
      depth -= 1;
    } else if (depth > 0) continue;
    else if (c === '{') return closing(masked, i);
    else if (c === ';' || c === '}') return -1;
    else if (c === '=' && equals !== 'skip') {
      const prev = masked[i - 1];
      const next = masked[i + 1];
      if (next === '=' || prev === '=' || prev === '!' || prev === '<' || prev === '>') continue;
      if (equals === 'expression') return expressionEnd(masked, i + 1);
      if (equals === 'arrow' && next === '>') return expressionEnd(masked, i + 2);
      return -1;
    }
  }
  return -1;
}

/** The blocks that hold methods (classes, structs, impl blocks...), with their name and their range. */
function containers(masked, lang) {
  const found = [];
  const re =
    lang === 'rust'
      ? /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(impl|trait)\b([^{;\n]*)/gm
      : /(?:^|[\s;{}])(class|interface|struct|record|enum|object|trait|extension|protocol)\s+([A-Za-z_$][\w$]*)/gm;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    let name = m[2];
    if (lang === 'rust') {
      name = name.replace(/<[^>]*>/g, ' ').trim();
      if (m[1] === 'impl' && / for /.test(` ${name} `)) name = name.split(/\sfor\s/).pop();
      name = (/[A-Za-z_]\w*/.exec(name.replace(/\bwhere\b.*/, '')) ?? [''])[0];
      if (!name) continue;
    }
    // The body: the first `{` of the header, which may sit on the next line.
    let depth = 0;
    let open = -1;
    for (let i = m.index + m[0].length; i < masked.length && i < m.index + 2000; i++) {
      const c = masked[i];
      if (c === '(' || c === '[') depth += 1;
      else if (c === ')' || c === ']') depth -= 1;
      else if (depth > 0) continue;
      else if (c === '{') {
        open = i;
        break;
      } else if (c === ';' || c === '}' || c === '=') break;
      else if (c === '\n') {
        const after = /^\s*(\S+)/.exec(masked.slice(i + 1, i + 200))?.[1] ?? '';
        if (!/^(\{|:|,|extends\b|implements\b|where\b|with\b|permits\b)/.test(after) && !/[,:(]\s*$/.test(masked.slice(m.index, i))) break;
      }
    }
    if (open < 0) continue;
    const close = closing(masked, open);
    if (close > 0) found.push({ name, from: open, to: close });
  }
  return found;
}

const inside = (blocks, offset) => blocks.filter((b) => b.from < offset && offset < b.to).sort((a, b) => b.from - a.from)[0];

const JS_NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'new', 'delete', 'void', 'yield', 'with', 'do', 'else', 'try', 'import', 'export', 'super', 'throw', 'case', 'in', 'of']);
const JS_FUNCTION_VALUE = '(?:async\\s+)?(function\\b|\\(|[\\w$]+\\s*=>|<)';
const JS_PATTERNS = [
  { re: /^[ \t]*(?:export\s+)?(default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)?\s*(?:<[^>(]*>)?\s*\(/, kind: 'declaration' },
  { re: new RegExp(`^[ \\t]*(?:export\\s+)?(?:const|let|var)\\s+([\\w$]+)\\s*(?::\\s*[^=]+?)?=\\s*(?:await\\s+)?${JS_FUNCTION_VALUE}`), kind: 'value' },
  { re: /^[ \t]*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::\s*[^=]+?)?=\s*[\w$]+\(\s*(?:async\s+)?(?:function\b|\([^()]*\)\s*(?::[^=()]*)?=>|[\w$]+\s*=>)/, kind: 'wrapped' }, // asyncHandler(async (req, res) => ...)
  { re: new RegExp(`^[ \\t]*(?:[\\w$]+\\.)+([\\w$]+)\\s*=\\s*${JS_FUNCTION_VALUE}`), kind: 'value' },
  { re: new RegExp(`^[ \\t]*([\\w$]+)\\s*:\\s*${JS_FUNCTION_VALUE}`), kind: 'value' },
  { re: new RegExp(`^[ \\t]*(?:(?:public|private|protected|static|readonly|override)\\s+)*(#?[\\w$]+)\\s*(?::\\s*[^=]+?)?=\\s*${JS_FUNCTION_VALUE}`), kind: 'field' },
  { re: /^[ \t]*(?:(?:public|private|protected|static|async|override|readonly|abstract|get|set|declare)\s+)*\*?\s*(#?[\w$]+)\s*(?:<[^>(]*>)?\s*\(/, kind: 'method' },
];

function extractJs(masked, lines, at) {
  const blocks = containers(masked, 'js');
  const found = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (!line.includes('(') && !line.includes('=>')) continue;
    const start = at.starts[n];
    for (const { re, kind } of JS_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      let name;
      let end = -1;
      if (kind === 'declaration') {
        name = m[2] ?? (m[1] ? 'default' : '');
        if (name) end = bodyEnd(masked, start + m[0].length - 1, 'skip');
      } else if (kind === 'method') {
        name = m[1];
        if (JS_NOT_A_NAME.has(name)) continue;
        const close = closing(masked, start + m[0].length - 1);
        if (close < 0) continue;
        const rest = masked.slice(close + 1, masked.indexOf('\n', close) < 0 ? masked.length : masked.indexOf('\n', close));
        if (!/^\s*(?::.*)?\{\s*$/.test(rest)) continue;
        end = closing(masked, close + 1 + rest.lastIndexOf('{'));
      } else if (kind === 'wrapped') {
        name = m[1];
        const open = start + line.indexOf('(', line.indexOf('='));
        end = closing(masked, open);
      } else {
        name = m[1];
        const value = m[2];
        const from = start + m[0].length - value.length;
        if (value === 'function') end = bodyEnd(masked, from + value.length, 'skip');
        else {
          // An arrow function: its parameters, an optional type, `=>`, then a block or an expression.
          let arrow;
          if (value === '(' || value === '<') {
            const open = value === '(' ? from : masked.indexOf('(', from);
            const close = open < 0 ? -1 : closing(masked, open);
            if (close < 0) continue;
            const after = /^\s*(?::[^;\n]*?)?=>/.exec(masked.slice(close + 1, close + 400));
            if (!after) continue;
            arrow = close + 1 + after[0].length;
          } else arrow = from + value.length;
          const body = /^\s*\{/.exec(masked.slice(arrow, arrow + 200));
          end = body ? closing(masked, arrow + body[0].length - 1) : expressionEnd(masked, arrow);
        }
      }
      if (!name || end < 0) continue;
      const holder = inside(blocks, start + m.index + m[0].length - 1);
      found.push({ name, kind: kind === 'method' || (kind === 'field' && holder) ? 'method' : 'function', line: n + 1, end: at.of(end), in: holder?.name });
      break;
    }
  }
  return found;
}

function extractPython(masked, lines) {
  const found = [];
  const indentOf = (l) => /^[ \t]*/.exec(l)[0].replace(/\t/g, '        ').length;
  const blockEnd = (n, indent) => {
    let last = n;
    for (let k = n + 1; k < lines.length; k++) {
      if (!lines[k].trim()) continue;
      if (indentOf(lines[k]) <= indent) break;
      last = k;
    }
    return last;
  };
  const classes = [];
  for (let n = 0; n < lines.length; n++) {
    const c = /^([ \t]*)class\s+([A-Za-z_]\w*)/.exec(lines[n]);
    if (c) classes.push({ name: c[2], from: n, to: blockEnd(n, indentOf(lines[n])), indent: indentOf(lines[n]) });
    const m = /^([ \t]*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(lines[n]);
    if (!m) continue;
    const indent = indentOf(lines[n]);
    // A method is a def right under a class: a def nested in a function is a function.
    const holder = classes.filter((k) => k.from < n && n <= k.to).pop();
    let direct = Boolean(holder);
    for (let k = n - 1; holder && k > holder.from; k--) {
      if (lines[k].trim() && indentOf(lines[k]) < indent) {
        direct = false;
        break;
      }
    }
    found.push({ name: m[2], kind: direct ? 'method' : 'function', line: n + 1, end: blockEnd(n, indent) + 1, in: direct ? holder.name : undefined });
  }
  return found;
}

function extractRuby(masked, lines) {
  const found = [];
  const indentOf = (l) => /^[ \t]*/.exec(l)[0].length;
  const endOf = (n) => {
    const indent = indentOf(lines[n]);
    for (let k = n + 1; k < lines.length; k++) if (/^[ \t]*end\b/.test(lines[k]) && indentOf(lines[k]) === indent) return k;
    return n;
  };
  const holders = [];
  for (let n = 0; n < lines.length; n++) {
    const c = /^[ \t]*(?:class|module)\s+([A-Z][\w:]*)/.exec(lines[n]);
    if (c) holders.push({ name: c[1], from: n, to: endOf(n) });
    const m = /^[ \t]*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?|[+\-*/<=>!~%&|^[\]]+)/.exec(lines[n]);
    if (!m) continue;
    const oneLine = /;\s*end\b/.test(lines[n]) || /^[ \t]*def\s+\S+(\([^)]*\))?\s*=[^=]/.test(lines[n]);
    const holder = holders.filter((k) => k.from < n && n <= k.to).pop();
    found.push({ name: m[1], kind: 'method', line: n + 1, end: (oneLine ? n : endOf(n)) + 1, in: holder?.name });
  }
  return found;
}

const C_NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'sizeof', 'synchronized', 'using', 'lock', 'foreach', 'fixed', 'checked', 'unchecked', 'when', 'try', 'do', 'else', 'defined', 'assert', 'super', 'this', 'base', 'new', 'throw', 'delete', 'typeof', 'await', 'yield', 'function', 'alignof', 'decltype', 'operator', 'nameof', 'default']);
const C_NOT_A_TYPE = new Set(['return', 'new', 'else', 'throw', 'case', 'goto', 'delete', 'await', 'yield', 'typedef', 'using', 'import', 'package', 'namespace', 'class', 'struct', 'enum', 'interface', 'extends', 'implements', 'if', 'while', 'for', 'switch', 'do', 'in', 'is', 'as', 'co_return', 'co_await', 'co_yield', 'throws', 'where', 'define', 'include']);
const C_EQUALS = { csharp: 'arrow', dart: 'arrow' };

/** Java, C#, C, C++ and Dart: a return type, a name, parameters, then a body. */
function extractCLike(masked, lines, at, lang) {
  const blocks = containers(masked, lang);
  const found = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    const p = line.indexOf('(');
    if (p < 0) continue;
    let head = line.slice(0, p).replace(/^\s*(?:@[\w.]+\s+)*/, '');
    if (!head.trim() || /[^\w\s:<>[\],.?*&~]/.test(head)) continue;
    head = head.replace(/([*&]+)/g, ' $1 ').replace(/\s+,/g, ',').trim();
    const tokens = head.split(/\s+/).filter((t) => !/^[*&]+$/.test(t));
    const name = tokens.pop();
    if (!name || !/^~?[A-Za-z_]\w*(?:::~?[A-Za-z_]\w*)*$/.test(name) || C_NOT_A_NAME.has(name)) continue;
    if (tokens.some((t) => C_NOT_A_TYPE.has(t) || !/\w/.test(t) || /^[:.,?]/.test(t))) continue;
    const offset = at.starts[n] + p;
    const holder = inside(blocks, offset);
    if (!tokens.length) {
      // No return type: a constructor, or a C function whose type sits on the line above.
      const typeAbove = (lang === 'c' || lang === 'cpp') && /^[A-Za-z_]/.test(line) && /^[A-Za-z_][\w\s*&:<>,]*$/.test((lines[n - 1] ?? '').trim()) && !C_NOT_A_TYPE.has((lines[n - 1] ?? '').trim());
      if (!name.includes('::') && !(holder && holder.name === name.replace(/^~/, '')) && !typeAbove) continue;
    }
    const close = closing(masked, offset);
    if (close < 0) continue;
    const end = bodyEnd(masked, close + 1, C_EQUALS[lang] ?? 'none');
    if (end < 0) continue;
    const scoped = name.includes('::');
    const method = lang === 'java' || lang === 'csharp' || scoped || Boolean(holder);
    found.push({ name, kind: method ? 'method' : 'function', line: n + 1, end: at.of(end), in: scoped ? name.slice(0, name.lastIndexOf('::')) : holder?.name });
  }
  return found;
}

const KEYWORD_LANGUAGES = {
  go: { re: /^func\s+(?:\(\s*(?:[\w]+\s+)?\*?\s*([A-Za-z_]\w*)[^)]*\)\s*)?([A-Za-z_]\w*)\s*[([]/, equals: 'none' },
  rust: { re: /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:default|const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+()([A-Za-z_]\w*)/, equals: 'none' },
  php: { re: /^[ \t]*(?:(?:public|private|protected|static|abstract|final)\s+)*function\s+&?\s*()([A-Za-z_]\w*)\s*\(/, equals: 'none' },
  kotlin: { re: /^[ \t]*(?:(?:[a-z]+|@[\w.]+(?:\([^)]*\))?)\s+)*?fun\s+(?:<[^>]*>\s*)?(?:([\w<>?, ]+)\.)?([A-Za-z_]\w*)\s*\(/, equals: 'expression' },
  swift: { re: /^[ \t]*(?:(?:[a-z]+|@\w+(?:\([^)]*\))?)\s+)*?func\s+()([A-Za-z_]\w*)\s*[(<]/, equals: 'none' },
  scala: { re: /^[ \t]*(?:(?:[a-z]+|@\w+(?:\([^)]*\))?)\s+)*?def\s+()([A-Za-z_]\w*)/, equals: 'expression' },
};

/** Go, Rust, PHP, Kotlin, Swift and Scala: a keyword names the function. */
function extractKeyword(masked, lines, at, lang) {
  const { re, equals } = KEYWORD_LANGUAGES[lang];
  const blocks = lang === 'go' ? [] : containers(masked, lang);
  const found = [];
  for (let n = 0; n < lines.length; n++) {
    const m = re.exec(lines[n]);
    if (!m) continue;
    const from = at.starts[n] + m.index + m[0].length - (/[([<]$/.test(m[0]) ? 1 : 0);
    const body = bodyEnd(masked, from, equals);
    const holder = inside(blocks, from);
    const owner = m[1] || holder?.name;
    // A declaration with no body (a trait or an interface method) is still one line to read.
    found.push({ name: m[2], kind: owner ? 'method' : 'function', line: n + 1, end: body < 0 ? n + 1 : at.of(body), in: owner || undefined });
  }
  return found;
}

/** The functions and methods of one file: [{ name, kind, line, end, in? }]. */
export function extractFunctions(text, lang) {
  if (!lang || lang === 'other') return [];
  const masked = mask(text, lang);
  const lines = masked.split('\n');
  const at = lineIndex(masked);
  let found;
  if (lang === 'js') found = extractJs(masked, lines, at);
  else if (lang === 'python') found = extractPython(masked, lines);
  else if (lang === 'ruby') found = extractRuby(masked, lines);
  else if (KEYWORD_LANGUAGES[lang]) found = extractKeyword(masked, lines, at, lang);
  else found = extractCLike(masked, lines, at, lang);
  return found.map((f) => {
    const o = { name: f.name, kind: f.kind, line: f.line, end: Math.max(f.line, f.end) };
    if (f.in) o.in = f.in;
    return o;
  });
}

// ---------------------------------------------------------------------------
// universal-ctags
// ---------------------------------------------------------------------------

const CTAGS_KINDS = new Set(['function', 'func', 'method', 'member', 'constructor', 'getter', 'setter', 'generator', 'singleton method', 'subroutine', 'procedure', 'fn', 'def']);
const CTAGS_METHODS = new Set(['method', 'member', 'constructor', 'getter', 'setter', 'singleton method']);
const CTAGS_HOLDERS = new Set(['class', 'struct', 'interface', 'trait', 'impl', 'implementation', 'object', 'module', 'enum', 'record']);

export const isUniversalCtags = (versionText) => /Universal Ctags/i.test(String(versionText));

/** The functions and methods in the JSON lines universal-ctags prints: [{ file, name, kind, line, end, in? }]. */
export function parseCtags(output) {
  const found = [];
  for (const raw of String(output).split(/\r?\n/)) {
    if (!raw.startsWith('{')) continue;
    let t;
    try {
      t = JSON.parse(raw);
    } catch {
      continue;
    }
    if (t._type !== 'tag' || !t.name || !t.path || !Number.isInteger(t.line)) continue;
    const kind = String(t.kind ?? '');
    if (!CTAGS_KINDS.has(kind)) continue;
    // "member" is a method in Python, a field elsewhere.
    if (kind === 'member' && t.language !== 'Python') continue;
    const o = {
      file: slash(t.path).replace(/^\.\//, ''),
      name: String(t.name),
      kind: CTAGS_METHODS.has(kind) || CTAGS_HOLDERS.has(String(t.scopeKind ?? '')) ? 'method' : 'function',
      line: t.line,
      end: Number.isInteger(t.end) && t.end >= t.line ? t.end : t.line,
    };
    if (t.scope) o.in = String(t.scope);
    found.push(o);
  }
  return found;
}

function findCtags() {
  const bin = which('ctags', { env });
  if (!bin) return null;
  const v = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
  return v.status === 0 && isUniversalCtags(v.stdout) ? bin : null;
}

/** Runs universal-ctags on the files; null when it could not answer in JSON. */
function runCtags(bin, repo, files) {
  const r = spawnSync(bin, ['--output-format=json', '--fields=+nKel', '--sort=no', '-f', '-', '-L', '-'], {
    cwd: repo,
    input: files.join('\n'),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.status !== 0 || r.error) return null;
  return parseCtags(r.stdout);
}

// ---------------------------------------------------------------------------
// The branches
// ---------------------------------------------------------------------------

const DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

/** A folder's path as a branch name: lowercase letters, digits and `_`, the end of the path kept when it is long. */
function slug(path) {
  let parts = path.toLowerCase().split('/').map((p) => p.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')).filter(Boolean);
  while (parts.length > 1 && parts.join('_').length > 40) parts = parts.slice(1);
  let s = parts.join('_').slice(-40).replace(/^_+/, '');
  if (!s) s = 'root';
  if (DEVICE_NAMES.test(s)) s += '_dir';
  return s;
}

/**
 * Splits files ([{ path, lines }]) into branches of about `size` lines. A
 * folder that fits is one branch; one that does not is split along its
 * sub-folders, and its small neighbours are put together. A file is never split.
 */
export function splitBranches(files, size) {
  const root = { path: '', dirs: new Map(), files: [], total: 0 };
  for (const f of files) {
    let node = root;
    node.total += f.lines;
    const parts = f.path.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { path: parts.slice(0, i + 1).join('/'), dirs: new Map(), files: [], total: 0 });
      node = node.dirs.get(parts[i]);
      node.total += f.lines;
    }
    node.files.push(f);
  }
  const all = (node) => [...node.files, ...[...node.dirs.keys()].sort().flatMap((k) => all(node.dirs.get(k)))];
  const groups = [];
  const split = (node) => {
    if (node.total <= size) {
      if (node.total > 0 || node.files.length) groups.push({ dir: node.path, dirs: [node.path], files: all(node) });
      return;
    }
    const units = node.files.map((f) => ({ dir: node.path, files: [f], lines: f.lines }));
    for (const key of [...node.dirs.keys()].sort()) {
      const sub = node.dirs.get(key);
      if (sub.total <= size) units.push({ dir: sub.path, files: all(sub), lines: sub.total });
      else split(sub);
    }
    const bins = [];
    for (const u of units) {
      const last = bins[bins.length - 1];
      if (last && last.lines + u.lines <= size) {
        last.units.push(u);
        last.lines += u.lines;
      } else bins.push({ units: [u], lines: u.lines });
    }
    // A small last bin joins the one before it, when the two stay close to the size.
    if (bins.length > 1) {
      const last = bins[bins.length - 1];
      const before = bins[bins.length - 2];
      if (last.lines < size / 3 && before.lines + last.lines <= size * 1.25) {
        before.units.push(...last.units);
        before.lines += last.lines;
        bins.pop();
      }
    }
    for (const b of bins) {
      // The folders a branch holds, in order: its name and its "folder" column come from them.
      const dirs = [...new Set(b.units.map((u) => u.dir))];
      groups.push({ dir: dirs.length === 1 ? dirs[0] : node.path, dirs, files: b.units.flatMap((u) => u.files) });
    }
  };
  split(root);
  for (const g of groups) g.files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  groups.sort((a, b) => (a.files[0].path < b.files[0].path ? -1 : 1));
  const used = new Map();
  return groups.map((g) => {
    // Several folders in one branch: their names, three at most, so that "api_config" says what "root_2" hides.
    const inner = g.dirs.filter((d) => d !== g.dir);
    const names = inner.map((d) => d.slice(g.dir ? g.dir.length + 1 : 0));
    const label = names.length > 3 ? [...names.slice(0, 3), 'more'] : names;
    const base = slug(label.length ? [g.dir, ...label].filter(Boolean).join('/') : g.dir);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const folder = g.dirs.map((d) => (d ? `${d}/` : './')).join(', ');
    return { id: n === 1 ? base : `${base}_${n}`, folder, files: g.files.map((f) => f.path), lines: g.files.reduce((s, f) => s + f.lines, 0) };
  }).map((b, _, list) => {
    // Two folders can give the same name with a number (a_2 from "a" twice, and a folder "a/2").
    let id = b.id;
    while (list.some((o) => o !== b && o.id === id)) id += '_x';
    return { ...b, id };
  });
}

// ---------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------

function readJson(file, what) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    throw new Exit(64, `tree.mjs: ${what}: cannot read ${slash(file)} (${e.code ?? e.message}).`);
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Exit(64, `tree.mjs: ${what}: ${slash(file)} is not valid JSON (${e.message}).`);
  }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function loadTree(repo) {
  const file = join(repo, TREE);
  if (!existsSync(file)) throw new Exit(3, `tree.mjs: no tree yet (${TREE}). Run "node tree.mjs build" first.`);
  const t = readJson(file, 'the tree');
  if (!Array.isArray(t?.functions) || !Array.isArray(t?.branches) || !Array.isArray(t?.files)) throw new Exit(3, `tree.mjs: ${TREE} is not a tree. Run "node tree.mjs build" again.`);
  return t;
}

function build(repo, opts) {
  const mode = env.CYBEDEFEND_TREE_EXTRACTOR || 'auto';
  if (!['auto', 'ctags', 'builtin'].includes(mode)) throw new Exit(64, `tree.mjs: CYBEDEFEND_TREE_EXTRACTOR is auto, ctags or builtin, not ${mode}`);
  const ctags = mode === 'builtin' ? null : findCtags();
  if (mode === 'ctags' && !ctags) throw new Exit(3, 'tree.mjs: universal-ctags is not on the PATH (a "ctags" that says "Universal Ctags" with --version). Leave CYBEDEFEND_TREE_EXTRACTOR out to use the built-in extractor.');
  repo ??= gitRoot();

  const skillRel = slash(relative(repo, resolve(here, '..')));
  const skillDir = skillRel && !skillRel.startsWith('..') && !isAbsolute(skillRel) ? skillRel : '';
  const out = {};
  const files = [];
  const texts = new Map();
  for (const path of gitFiles(repo)) {
    if (!existsSync(join(repo, path))) continue; // deleted in the working tree, still in the index
    let why = leftOut(path, { withTests: opts.withTests, skillDir });
    let text = '';
    if (!why) {
      try {
        const st = lstatSync(join(repo, path));
        if (!st.isFile()) why = 'not code';
        else if (st.size > MAX_FILE_BYTES) why = 'too large';
        else {
          text = readFileSync(join(repo, path), 'utf8');
          if (text.slice(0, 8000).includes('\0')) why = 'not code';
          else if (/^.{0,200}(@generated|Code generated .{0,80}DO NOT EDIT|DO NOT EDIT.{0,80}generated)/im.test(text.slice(0, 2000))) why = 'generated';
        }
      } catch {
        why = 'not code'; // a file that cannot be read
      }
    }
    if (why) {
      out[why] = (out[why] ?? 0) + 1;
      continue;
    }
    const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    files.push({ path, language: languageOf(path), lines });
    texts.set(path, text);
  }

  let extractor = 'builtin';
  let tags = null;
  if (ctags) {
    tags = runCtags(ctags, repo, files.map((f) => f.path));
    if (tags) extractor = 'ctags';
    else if (mode === 'ctags') throw new Exit(3, 'tree.mjs: universal-ctags did not answer in JSON (it is built without it). Leave CYBEDEFEND_TREE_EXTRACTOR out to use the built-in extractor.');
  }
  const byFile = new Map(files.map((f) => [f.path, []]));
  if (tags) {
    for (const t of tags) byFile.get(t.file)?.push(t);
  } else {
    for (const f of files) byFile.set(f.path, extractFunctions(texts.get(f.path), f.language));
  }

  const functions = [];
  const ids = new Set();
  for (const f of files) {
    // The code outside any function is one more line of the file: nothing in it escapes the review.
    const list = [{ name: TOP, kind: 'file', line: 1, end: Math.max(1, f.lines) }, ...byFile.get(f.path).sort((a, b) => a.line - b.line || (a.name < b.name ? -1 : 1))];
    for (const fn of list) {
      const id = `${f.path}#${fn.name}:${fn.line}`;
      if (ids.has(id)) continue;
      ids.add(id);
      const o = { id, file: f.path, name: fn.name, kind: fn.kind, line: fn.line, end: fn.end };
      if (fn.in) o.in = fn.in;
      functions.push(o);
    }
  }

  const branches = splitBranches(files, opts.branchSize).map((b) => {
    const mine = new Set(b.files);
    return { ...b, functions: functions.filter((f) => mine.has(f.file)).map((f) => f.id) };
  });
  const tree = { version: 1, extractor, branchSize: opts.branchSize, files, functions, branches };
  writeJson(join(repo, TREE), tree);
  const ignore = join(repo, '.cybedefend', 'deep', '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');

  const named = functions.filter((f) => f.kind !== 'file').length;
  const totalLines = files.reduce((s, f) => s + f.lines, 0);
  say(`tree: ${plural(files.length, 'file')}, ${named} functions and methods, ${totalLines} lines of code, ${plural(branches.length, 'branch', 'branches')} of about ${opts.branchSize} lines (${extractor === 'ctags' ? 'universal-ctags' : 'built-in extractor'})`);
  // The count "status" follows: each file adds one line for its code outside any function.
  say(`${functions.length} to review: the ${named} functions and methods, and the code outside them in each of the ${plural(files.length, 'file')}`);
  const reasons = Object.entries(out).filter(([k]) => k !== 'not code').map(([k, v]) => `${v} ${k}`);
  if (out['not code']) reasons.push(`${out['not code']} not code (docs, lockfiles, data, images)`);
  if (reasons.length) say(`left out: ${reasons.join(', ')}`);
  const width = Math.max(6, ...branches.map((b) => b.id.length));
  say(`  ${pad('branch', width)}  ${padLeft('files', 5)}  ${padLeft('to review', 9)}  ${padLeft('lines', 6)}  folders`);
  for (const b of branches) say(`  ${pad(b.id, width)}  ${padLeft(b.files.length, 5)}  ${padLeft(b.functions.length, 9)}  ${padLeft(b.lines, 6)}  ${b.folder}`);
  const ledgers = existsSync(join(repo, BRANCHES)) ? readdirSync(join(repo, BRANCHES)).filter((f) => f.endsWith('.json') && !f.endsWith('.findings.json')).length : 0;
  if (ledgers) say(`${plural(ledgers, 'ledger')} of an earlier build kept in ${BRANCHES}/: "node tree.mjs status" says what still matches.`);
  say(`tree: ${TREE}`);
  return 0;
}

function branchOf(tree, id) {
  if (!id) throw new Exit(64, `tree.mjs: name a branch: ${tree.branches.map((b) => b.id).join(', ')}`);
  const b = tree.branches.find((x) => x.id === id);
  if (!b) throw new Exit(64, `tree.mjs: no branch "${id}". The branches: ${tree.branches.map((x) => x.id).join(', ')}`);
  return b;
}

function brief(repo, opts) {
  const tree = loadTree(repo);
  const b = branchOf(tree, opts.branch);
  const ledger = `${BRANCHES}/${b.id}.json`;
  if (opts.ledger) {
    if (existsSync(join(repo, ledger))) say(`ledger kept as it is: ${ledger}`);
    else {
      writeJson(join(repo, ledger), { branch: b.id, functions: Object.fromEntries(b.functions.map((id) => [id, { verdict: '' }])) });
      say(`ledger written, no verdict yet: ${ledger}`);
    }
    return 0;
  }
  const byId = new Map(tree.functions.map((f) => [f.id, f]));
  const lines = new Map(tree.files.map((f) => [f.path, f.lines]));
  say(`Branch ${b.id}: ${plural(b.files.length, 'file')}, ${b.functions.length - b.files.length} functions and methods, ${b.functions.length} to review, ${b.lines} lines (${b.folder})`);
  say(`Ledger:      ${ledger}`);
  say(`Findings:    ${BRANCHES}/${b.id}.findings.json`);
  say(`Proof tests: files of this branch alone, named deep_${b.id}, one or one per package where the stack wants it (test_security_deep_${b.id}.py, deep_${b.id}.security.test.ts, deep_${b.id}_security_test.go, deep_${b.id}_security_spec.rb)`);
  const width = Math.max(...b.functions.map((id) => id.length));
  for (const file of b.files) {
    say('');
    say(`${file} (${plural(lines.get(file) ?? 0, 'line')})`);
    for (const id of b.functions) {
      const f = byId.get(id);
      if (!f || f.file !== file) continue;
      if (f.kind === 'file') say(`  ${pad(id, width)}  the code outside any function`);
      else say(`  ${pad(id, width)}  ${pad(f.kind, 8)}  lines ${f.line}-${f.end}${f.in ? `  in ${f.in}` : ''}`);
    }
  }
  return 0;
}

const normalWhere = (where) => slash(String(where).trim()).replace(/^\.\//, '');
const findingKey = (f) => `${String(f.kind).trim()}@${normalWhere(f.where)}`;

/** The findings of a file: { findings: [...] } or a bare list. Each one names its kind and its place. */
function readFindings(file, what) {
  const doc = readJson(file, what);
  const list = Array.isArray(doc) ? doc : doc?.findings;
  if (!Array.isArray(list)) throw new Exit(64, `tree.mjs: ${what}: ${slash(file)} holds no "findings" list.`);
  list.forEach((f, i) => {
    if (!f || typeof f !== 'object' || typeof f.kind !== 'string' || !f.kind.trim() || typeof f.where !== 'string' || !/^.+:\d+$/.test(f.where.trim())) {
      throw new Exit(64, `tree.mjs: ${what}: finding ${i + 1} of ${slash(file)} needs a "kind" and a "where" (file:line).`);
    }
  });
  return list;
}

/** One branch's ledger, read and checked: { verdicts: Map(id -> verdict), problems: [] }. */
function readLedger(repo, branch, knownFindings) {
  const file = join(repo, BRANCHES, `${branch.id}.json`);
  const verdicts = new Map();
  const problems = [];
  if (!existsSync(file)) return { verdicts, problems, missing: true };
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    return { verdicts, problems: [`${BRANCHES}/${branch.id}.json is not valid JSON (${e.message})`] };
  }
  const entries = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.functions : null;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return { verdicts, problems: ['the ledger is an object with "functions": one entry per function id'] };
  if (doc.branch !== undefined && doc.branch !== branch.id) problems.push(`"branch" says ${JSON.stringify(doc.branch)}`);
  const mine = new Set(branch.functions);
  for (const [id, entry] of Object.entries(entries)) {
    if (!mine.has(id)) {
      problems.push(`${id} is not a function of this branch (copy the ids from "tree.mjs brief ${branch.id}")`);
      continue;
    }
    const verdict = entry && typeof entry === 'object' ? entry.verdict : entry;
    if (verdict === '' || verdict === null || verdict === undefined) continue; // no verdict yet
    const needs = VERDICTS[verdict];
    if (!needs) {
      problems.push(`${id}: the verdict is one of ${Object.keys(VERDICTS).join(', ')}, not ${JSON.stringify(verdict)}`);
      continue;
    }
    const value = entry[needs];
    if (typeof value !== 'string' || !value.trim()) {
      const hint = { check: 'what protects it, with its file and line', finding: 'the finding, as <kind>@<file:line>', what: 'what you suspect', why: 'why' }[needs];
      problems.push(`${id}: the verdict "${verdict}" needs "${needs}" (${hint})`);
      continue;
    }
    if (verdict === 'flaw' && !knownFindings.has(normalFindingId(value))) {
      problems.push(`${id}: the finding ${value} is not in ${BRANCHES}/${branch.id}.findings.json (a finding with that "kind" and that "where")`);
      continue;
    }
    verdicts.set(id, verdict);
  }
  return { verdicts, problems };
}

function normalFindingId(value) {
  const i = String(value).indexOf('@');
  return i < 0 ? String(value).trim() : `${value.slice(0, i).trim()}@${normalWhere(value.slice(i + 1))}`;
}

function status(repo, opts) {
  const tree = loadTree(repo);
  const only = opts.branch ? branchOf(tree, opts.branch) : null;
  const merged = new Set();
  if (existsSync(join(repo, FINDINGS))) {
    try {
      for (const f of readFindings(join(repo, FINDINGS), 'the audit findings')) merged.add(findingKey(f));
    } catch {
      // write-audit judges that file: here it only helps to find a flaw's finding.
    }
  }
  const rows = [];
  const problems = [];
  // With a branch named, only that branch is read: its agent is not stopped by a ledger another agent is still writing.
  for (const b of only ? [only] : tree.branches) {
    const known = new Set(merged);
    const findingsFile = join(repo, BRANCHES, `${b.id}.findings.json`);
    if (existsSync(findingsFile)) {
      try {
        for (const f of readFindings(findingsFile, `branch ${b.id}`)) known.add(findingKey(f));
      } catch (e) {
        problems.push(e.message.replace(/^tree\.mjs: /, ''));
      }
    }
    const ledger = readLedger(repo, b, known);
    for (const p of ledger.problems) problems.push(`branch ${b.id}: ${p}`);
    const counts = {};
    for (const v of ledger.verdicts.values()) counts[v] = (counts[v] ?? 0) + 1;
    rows.push({ branch: b, ledger, counts, left: b.functions.filter((id) => !ledger.verdicts.has(id)) });
  }
  if (problems.length) {
    const shown = problems.slice(0, 40).map((p) => `tree.mjs: ${p}`);
    if (problems.length > 40) shown.push(`tree.mjs: and ${problems.length - 40} more.`);
    throw new Exit(64, shown.join('\n'));
  }

  const total = rows.reduce((s, r) => s + r.branch.functions.length, 0);
  const done = rows.reduce((s, r) => s + r.ledger.verdicts.size, 0);
  const sum = (v) => rows.reduce((s, r) => s + (r.counts[v] ?? 0), 0);
  const complete = rows.filter((r) => r.left.length === 0).length;
  const filled = total ? Math.round((done / total) * 20) : 20;
  let line = `${only ? `Branch ${only.id}` : 'Deep audit'}  ${'█'.repeat(filled)}${'░'.repeat(20 - filled)}  ${done}/${total} functions with a verdict, ${only ? '' : `${complete} of ${plural(rows.length, 'branch', 'branches')} complete, `}${plural(sum('flaw'), 'flaw')}, ${plural(sum('lead'), 'lead')}`;
  if (sum('not-examined')) line += `, ${sum('not-examined')} not examined`;
  say(line);
  const width = Math.max(6, ...rows.map((r) => r.branch.id.length));
  for (const r of rows) {
    const detail = r.ledger.missing ? 'no ledger yet' : Object.keys(VERDICTS).filter((v) => r.counts[v]).map((v) => `${v} ${r.counts[v]}`).join(', ') || 'no verdict yet';
    say(`  ${r.left.length ? '○' : '✓'} ${pad(r.branch.id, width)}  ${padLeft(`${r.ledger.verdicts.size}/${r.branch.functions.length}`, 9)}  ${detail}`);
  }
  const open = rows.filter((r) => r.left.length);
  if (done < total) {
    say('');
    say(`No verdict yet: ${total - done} functions in ${plural(rows.filter((r) => r.left.length).length, 'branch', 'branches')}.`);
    for (const r of open) {
      if (r.ledger.missing) {
        say(`  ${r.branch.id}: all ${r.left.length} (no ledger yet)`);
        continue;
      }
      const cap = only ? r.left.length : 30;
      say(`  ${r.branch.id}:`);
      for (const id of r.left.slice(0, cap)) say(`    ${id}`);
      if (r.left.length > cap) say(`    and ${r.left.length - cap} more: node tree.mjs status ${r.branch.id}`);
    }
  }
  return done === total ? 0 : 2;
}

function merge(repo, opts) {
  const tree = loadTree(repo);
  const target = opts.into ? resolve(opts.into) : join(repo, FINDINGS);
  const shown = slash(relative(repo, target)) || FINDINGS;
  const findings = existsSync(target) ? [...readFindings(target, 'the audit findings')] : [];
  const index = new Map(findings.map((f, i) => [findingKey(f), i]));
  const fresh = [];
  const twice = [];
  let read = 0;
  let sources = 0;
  for (const b of tree.branches) {
    const file = join(repo, BRANCHES, `${b.id}.findings.json`);
    if (!existsSync(file)) continue;
    const list = readFindings(file, `branch ${b.id}`);
    sources += 1;
    for (const f of list) {
      read += 1;
      const key = findingKey(f);
      const entry = { ...f, where: normalWhere(f.where) };
      if (!index.has(key)) {
        index.set(key, findings.length);
        findings.push(entry);
        fresh.push({ key, branch: b.id, lead: f.lead === true });
        continue;
      }
      // The same flaw, already there or from another branch. A proof wins over a lead.
      const at = index.get(key);
      const proves = findings[at].lead === true && f.lead !== true;
      if (proves) findings[at] = entry;
      twice.push({ key, branch: b.id, note: proves ? 'its proof replaces the lead' : 'kept as it was' });
    }
  }
  writeJson(target, { findings });
  say(`merge: ${plural(read, 'finding')} read from ${plural(sources, 'branch', 'branches')}: ${fresh.length} new, ${twice.length} found twice or already there. ${shown} now holds ${findings.length}.`);
  for (const f of fresh) say(`  + ${f.key}${f.lead ? '  (lead)' : ''}  from ${f.branch}`);
  for (const f of twice) say(`  = ${f.key}  from ${f.branch}: ${f.note}`);
  const leads = findings.filter((f) => f.lead === true).length;
  if (leads > 5) say(`${leads} leads: the list takes five, the strongest. Keep the others in the map, as lead rows.`);
  return 0;
}

function parseArgs(argv) {
  const o = { command: '', branch: '', branchSize: DEFAULT_BRANCH_SIZE, withTests: false, ledger: false, into: '', help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--branch-size') o.branchSize = argv[++i] ?? '';
    else if (a === '--with-tests') o.withTests = true;
    else if (a === '--ledger') o.ledger = true;
    else if (a === '--into') o.into = argv[++i] ?? '';
    else if (a.startsWith('-')) throw new Exit(64, `tree.mjs: unknown argument ${a}\n${USAGE}`);
    else rest.push(a);
  }
  [o.command, o.branch] = [rest[0] ?? '', rest[1] ?? ''];
  if (rest.length > 2) throw new Exit(64, `tree.mjs: unknown argument ${rest[2]}\n${USAGE}`);
  return o;
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!['build', 'brief', 'status', 'merge'].includes(opts.command)) throw new Exit(64, `tree.mjs: ${opts.command ? `unknown command ${opts.command}` : 'name a command'}\n${USAGE}`);
  if (opts.command === 'build') {
    const size = Number(opts.branchSize);
    if (!Number.isInteger(size) || size < 1) throw new Exit(64, `tree.mjs: --branch-size is a number of lines, not ${opts.branchSize}`);
    opts.branchSize = size;
    if (opts.branch) throw new Exit(64, `tree.mjs: unknown argument ${opts.branch}\n${USAGE}`);
    return build(null, opts);
  }
  const repo = gitRoot();
  if (opts.command === 'brief') return brief(repo, opts);
  if (opts.command === 'status') return status(repo, opts);
  if (opts.branch) throw new Exit(64, `tree.mjs: unknown argument ${opts.branch}\n${USAGE}`);
  if (opts.into === '' && argv.includes('--into')) throw new Exit(64, 'tree.mjs: --into names the findings file to write.');
  return merge(repo, opts);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // A reader that stops early (a pager, a pipe that closes) is no error.
  process.stdout.on('error', (e) => {
    if (e.code !== 'EPIPE') throw e;
  });
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      if (e instanceof Exit) {
        if (e.message) process.stderr.write(`${e.message}\n`);
        process.exitCode = e.code;
      } else {
        process.stderr.write(`tree.mjs: ${e?.stack ?? e}\n`);
        process.exitCode = 3;
      }
    },
  );
}

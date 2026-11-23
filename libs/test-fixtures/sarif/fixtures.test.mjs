// Pins the SARIF fixtures themselves (not the import): shapes, README table,
// and the message templates of the SCA and container import parsers.
// Run from the repo root: node --test libs/test-fixtures/sarif/fixtures.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const README = readFileSync(join(DIR, 'README.md'), 'utf8');

const isFixtureName = (name) =>
  name.endsWith('.sarif') || name.endsWith('.sarif.gz') || name.endsWith('.json');
const fixtureNames = readdirSync(DIR).filter((n) => isFixtureName(n));

function readSarif(name) {
  let buf = readFileSync(join(DIR, name));
  if (name.endsWith('.gz')) buf = gunzipSync(buf);
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip a leading BOM
  return JSON.parse(text);
}

function countResults(doc) {
  return (doc.runs ?? []).reduce(
    (n, run) => n + (Array.isArray(run.results) ? run.results.length : 0),
    0,
  );
}

function rulesOf(run) {
  const driver = run.tool?.driver ?? {};
  return [
    ...(Array.isArray(driver.rules) ? driver.rules : []),
    ...(Array.isArray(run.tool?.extensions) ? run.tool.extensions : []).flatMap((e) =>
      Array.isArray(e.rules) ? e.rules : [],
    ),
  ];
}

function ruleOf(run, result) {
  const rules = rulesOf(run);
  if (typeof result.ruleId === 'string') {
    const byId = rules.find((r) => r.id === result.ruleId);
    if (byId) return byId;
  }
  const idx = result.ruleIndex ?? result.rule?.index;
  if (typeof idx === 'number') return rules[idx];
  return undefined;
}

function readmeTableRows() {
  const rows = [];
  for (const line of README.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'File' || cells.every((c) => /^-+$/.test(c))) continue;
    const m = cells[0].match(/`([^`]+)`/);
    if (!m) continue;
    rows.push({ file: m[1], type: cells[1], status: cells[2], findings: cells[3], skipped: cells[4], suppressed: cells[5] });
  }
  return rows;
}

const TRIVY_VULN_MESSAGE = /^Package: (.+)\nInstalled Version: (.+)\nVulnerability (.+)\nSeverity: (\w+)\nFixed Version: (.*)\n/;
const GRYPE_MESSAGE = /^A (\w+) vulnerability in (\S+) package: (.+), version (\S+) was found/;
const OSV_MESSAGE = /^Package '(.+)' is vulnerable to '([^']+)'/;

test('every .sarif/.json but malformed.sarif parses (after BOM strip) with version 2.1.0 and runs', () => {
  for (const name of fixtureNames) {
    if (!name.endsWith('.sarif') && !name.endsWith('.json')) continue; // .sarif.gz is binary
    if (name === 'malformed.sarif') continue;
    const doc = readSarif(name);
    if (name === 'not-sarif.json') continue; // valid JSON, but neither SARIF version nor runs
    assert.equal(doc.version, '2.1.0', `${name}: version`);
    assert.ok(Array.isArray(doc.runs), `${name}: runs`);
    assert.equal(doc.$schema, 'https://json.schemastore.org/sarif-2.1.0.json', `${name}: $schema`);
  }
});

test('malformed.sarif does not parse', () => {
  assert.throws(() => JSON.parse(readFileSync(join(DIR, 'malformed.sarif'), 'utf8')), SyntaxError);
});

test('bom.sarif starts with EF BB BF', () => {
  const buf = readFileSync(join(DIR, 'bom.sarif'));
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test('minimal.sarif.gz gunzips to exactly minimal.sarif bytes', () => {
  const gz = readFileSync(join(DIR, 'minimal.sarif.gz'));
  assert.deepEqual(gunzipSync(gz), readFileSync(join(DIR, 'minimal.sarif')));
});

test('twenty-runs.sarif has 20 runs, too-many-runs.sarif has 21', () => {
  assert.equal(readSarif('twenty-runs.sarif').runs.length, 20);
  assert.equal(readSarif('too-many-runs.sarif').runs.length, 21);
});

test('large-snippet.sarif snippet has 1,048,576 characters', () => {
  const doc = readSarif('large-snippet.sarif');
  const snippet = doc.runs[0].results[0].locations[0].physicalLocation.region.snippet.text;
  assert.equal(snippet.length, 1048576);
});

test('every completed README row: result count = findings + skipped + suppressed', () => {
  const rows = readmeTableRows().filter((r) => r.status.includes('completed'));
  assert.ok(rows.length > 0, 'README table has completed rows');
  const byFile = new Map();
  for (const row of rows) {
    if (!byFile.has(row.file)) byFile.set(row.file, countResults(readSarif(row.file)));
    const total = [row.findings, row.skipped, row.suppressed].map(Number).reduce((a, b) => a + b, 0);
    assert.equal(
      byFile.get(row.file),
      total,
      `${row.file} (${row.type}): README row ${row.findings}+${row.skipped}+${row.suppressed} vs ${byFile.get(row.file)} results`,
    );
  }
  // sca-unparsable.sarif holds 2 results and writes none: its rows are failed, not counted above.
  assert.ok(readmeTableRows().some((r) => r.file === 'sca-unparsable.sarif' && r.status.includes('failed')));
});

test('every fixture file name appears in the README table', () => {
  for (const name of fixtureNames) {
    assert.ok(README.includes(name), `${name} is named in README.md`);
  }
});

test('every Trivy vulnerability message matches the Trivy template', () => {
  for (const name of fixtureNames) {
    if (!name.endsWith('.sarif') || name === 'malformed.sarif') continue; // malformed does not parse
    const doc = readSarif(name);
    for (const run of doc.runs) {
      if (run.tool?.driver?.name?.toLowerCase() !== 'trivy') continue;
      for (const result of run.results ?? []) {
        const rule = ruleOf(run, result);
        if (rule?.properties?.tags?.[0] !== 'vulnerability') continue;
        const text = result.message?.text ?? '';
        if (name === 'sca-unparsable.sarif' && result.ruleId === 'CVE-2020-8203') {
          // result (b): no Installed Version line, must NOT match
          assert.ok(!TRIVY_VULN_MESSAGE.test(text), 'sca-unparsable result (b) is unparsable on purpose');
          continue;
        }
        assert.ok(TRIVY_VULN_MESSAGE.test(text), `${name} result ${result.ruleId}: ${JSON.stringify(text)}`);
      }
    }
  }
});

test('every grype-image.sarif message matches the Grype template and the rule id ends with -<package>', () => {
  const doc = readSarif('grype-image.sarif');
  const run = doc.runs[0];
  for (const result of run.results) {
    const m = result.message.text.match(GRYPE_MESSAGE);
    assert.ok(m, `grype message: ${JSON.stringify(result.message.text)}`);
    assert.ok(result.ruleId.endsWith(`-${m[3]}`), `${result.ruleId} ends with -${m[3]}`);
    assert.ok(
      result.message.text.includes(' in image ghcr.io/example/web:1.4.2 at: '),
      'grype image message names the image',
    );
  }
});

test('every osv-scanner.sarif message matches the osv template and the rule table has the package row', () => {
  const doc = readSarif('osv-scanner.sarif');
  const run = doc.runs[0];
  for (const result of run.results) {
    const m = result.message.text.match(OSV_MESSAGE);
    assert.ok(m, `osv message: ${JSON.stringify(result.message.text)}`);
    const rule = ruleOf(run, result);
    assert.ok(rule, `rule for ${result.ruleId}`);
    const pkg = m[1].split('@').length > 1 ? m[1].slice(0, m[1].lastIndexOf('@')) : m[1];
    const markdown = rule.help?.markdown ?? '';
    assert.ok(markdown.includes('### Fixed Versions'), `rule ${rule.id}: Fixed Versions table`);
    assert.ok(markdown.includes(`| ${pkg} |`), `rule ${rule.id}: table row for ${pkg}`);
  }
});

test('trivy-image.sarif run carries properties.imageName and properties.imageID', () => {
  const doc = readSarif('trivy-image.sarif');
  assert.equal(doc.runs[0].properties.imageName, 'ghcr.io/example/api:2.0.1');
  assert.equal(
    doc.runs[0].properties.imageID,
    'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  );
});

test('every sca-package-bag.sarif result carries a cybedefend/package bag with name and version', () => {
  const doc = readSarif('sca-package-bag.sarif');
  let seen = 0;
  for (const run of doc.runs) {
    for (const result of run.results ?? []) {
      const bag = result.properties?.['cybedefend/package'];
      assert.ok(bag && typeof bag.name === 'string' && bag.name.length > 0, 'bag name');
      assert.ok(typeof bag.version === 'string' && bag.version.length > 0, 'bag version');
      seen += 1;
    }
  }
  assert.equal(seen, 3);
});

test('trivy-mixed-kinds.sarif holds exactly one result of each kind vulnerability, misconfiguration, secret, license', () => {
  const doc = readSarif('trivy-mixed-kinds.sarif');
  const kinds = (doc.runs[0].results ?? []).map((r) => ruleOf(doc.runs[0], r)?.properties?.tags?.[0]);
  assert.deepEqual([...kinds].sort(), ['license', 'misconfiguration', 'secret', 'vulnerability']);
});

test('minimal.sarif rule 1 carries the CWE-95 and OWASP-A03:2021 tags', () => {
  const doc = readSarif('minimal.sarif');
  const tags = doc.runs[0].tool.driver.rules[0].properties.tags;
  assert.ok(tags.includes('CWE-95'));
  assert.ok(tags.includes('OWASP-A03:2021 - Injection'));
});

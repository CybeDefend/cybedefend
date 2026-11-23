import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TEXT = readFileSync(fileURLToPath(new URL('../init.sql', import.meta.url)), 'utf8');

const STATEMENTS = TEXT.split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n')
  .split(';')
  .map((s) => s.replace(/\s+/g, ' ').trim())
  .filter(Boolean);

const DATABASES = [
  'permify',
  'cybedefend_policy',
  'cybedefend_global_management',
  'cybedefend_scanning',
  'cybedefend_analysis_and_reporting',
  'cybedefend_file_management',
  'cybedefend_external_integrations',
];

test('creates the seven databases, each owned by cybedefend', () => {
  const expected = DATABASES.map((name) => `CREATE DATABASE ${name} OWNER cybedefend`).sort();
  assert.deepEqual([...STATEMENTS].sort(), expected);
});

test('creates nothing else', () => {
  const sql = STATEMENTS.join(';\n');
  for (const forbidden of [/CREATE\s+ROLE/i, /CREATE\s+USER/i, /\bALTER\b/i, /\bGRANT\b/i, /CREATE\s+EXTENSION/i, /IF\s+NOT\s+EXISTS/i]) {
    assert.doesNotMatch(sql, forbidden);
  }
  assert.doesNotMatch(TEXT, /`/);
  assert.doesNotMatch(TEXT, /utf8mb4/i);
});

test('holds no password', () => {
  assert.doesNotMatch(TEXT, /PASSWORD\s+'/i);
});

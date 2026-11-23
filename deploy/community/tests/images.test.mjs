// Checks what the analysis-reporting image carries, once it is built from this
// tree (docker-compose.build.yml): Chromium for the PDF reports, and none of
// what only the closed cloud features need (git, the SCA AutoFix packages),
// nor what the build leaves behind (puppeteer's own browser downloads, pnpm and
// its content store).
//
// Runs the image with `docker run --rm` (no network, nothing started but `sh`).
// It checks the image CYBEDEFEND_AR_IMAGE names, else the local
// ghcr.io/cybedefend/cybedefend-analysis-reporting:latest. Skipped, with a message,
// when docker is not installed or that image is not on this machine. In CI
// (CI set) CYBEDEFEND_AR_IMAGE is required: a CI run never checks whatever
// `latest` happens to be there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const IN_CI = Boolean(process.env.CI);
const NAMED = process.env.CYBEDEFEND_AR_IMAGE || '';
const IMAGE = NAMED || 'ghcr.io/cybedefend/cybedefend-analysis-reporting:latest';

const hasImage =
  spawnSync('docker', ['image', 'inspect', IMAGE], { encoding: 'utf8' }).status === 0;
const skip =
  IN_CI && !NAMED
    ? 'CYBEDEFEND_AR_IMAGE is required in CI'
    : hasImage
      ? false
      : `${IMAGE} is not on this machine (or docker is missing): images.test.mjs skipped`;

test('in CI, the image under test is named by CYBEDEFEND_AR_IMAGE', { skip: IN_CI ? false : 'not in CI' }, () => {
  assert.notEqual(NAMED, '', 'CI is set: name the image to check with CYBEDEFEND_AR_IMAGE, the local latest is not used');
  assert.ok(hasImage, `${IMAGE} is not on this machine`);
});

/** Runs `sh -c script` in the image, as root (it only reads), and returns its stdout. */
function inImage(script) {
  const res = spawnSync(
    'docker',
    ['run', '--rm', '--network', 'none', '--user', '0', '--entrypoint', 'sh', IMAGE, '-c', script],
    { encoding: 'utf8' },
  );
  assert.equal(res.status, 0, `docker run failed: ${res.stderr}`);
  return res.stdout;
}

const NODE_MODULES = '/app/analysis-reporting-service/node_modules';

test('the analysis-reporting image carries no git', { skip }, () => {
  assert.equal(inImage('command -v git || echo none').trim(), 'none');
  assert.equal(inImage('apk info -e git || echo none').trim(), 'none');
});

test('the analysis-reporting image carries the Chromium its PDF reports run', { skip }, () => {
  assert.equal(inImage('test -x /usr/bin/chromium && echo ok').trim(), 'ok');
  assert.match(inImage(`test -f ${NODE_MODULES}/puppeteer/package.json && echo ok`), /ok/);
});

test('the analysis-reporting image carries no closed-feature package', { skip }, () => {
  const present = inImage(
    `for p in @cybedefend/deepfix simple-git unzipper compare-versions; do test -e ${NODE_MODULES}/$p && echo $p; done; true`,
  ).trim();
  assert.equal(present, '');
});

test('the analysis-reporting image carries neither puppeteer browser downloads nor pnpm and its store', { skip }, () => {
  const present = inImage(
    'for d in /root/.cache/puppeteer /root/.local/share/pnpm /root/.cache/pnpm /usr/local/lib/node_modules/pnpm; do test -e $d && echo $d; done; command -v pnpm; true',
  ).trim();
  assert.equal(present, '');
});

test('the analysis-reporting image points puppeteer at the Alpine chromium', { skip }, () => {
  const res = spawnSync('docker', ['image', 'inspect', '--format', '{{json .Config.Env}}', IMAGE], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.ok(JSON.parse(res.stdout).includes('PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium'), res.stdout);
});

test('the analysis-reporting image runs as appuser and starts through its entrypoint', { skip }, () => {
  const res = spawnSync('docker', ['image', 'inspect', '--format', '{{.Config.User}} {{json .Config.Entrypoint}}', IMAGE], {
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), 'appuser ["/scripts/entrypoint.sh"]');
});

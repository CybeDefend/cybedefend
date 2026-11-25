import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate as t } from '@/test/i18n-mock';

// Resolves keys against the real `en` locale.
vi.mock('react-i18next', async () => (await import('@/test/i18n-mock')).reactI18nextMock());
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const post = vi.hoisted(() => vi.fn());
vi.mock('@/server/api/gatewayAPI', () => ({ default: { post } }));
vi.mock('@/config/runtimeConfig', () => ({ getApiUrl: () => '/api' }));

import ImportResultsDialog from './ImportResultsDialog';
import type { ImportType } from '@/server/services/importService';

const PROJECT = '11111111-2222-3333-4444-555555555555';

const mount = (defaultType: ImportType = 'sast', defaultBranch = 'main') => {
  const onClose = vi.fn();
  const onImported = vi.fn();
  render(
    <ImportResultsDialog
      projectId={PROJECT}
      defaultType={defaultType}
      defaultBranch={defaultBranch}
      onClose={onClose}
      onImported={onImported}
    />,
  );
  return { onClose, onImported };
};

const pickFile = (name = 'results.sarif', size = 20) => {
  const file = new File(['{"version":"2.1.0"}'.padEnd(size, ' ')], name, { type: 'application/json' });
  if (size > 1024) Object.defineProperty(file, 'size', { value: size });
  fireEvent.change(screen.getByLabelText(t('components.importResults.file.label')), { target: { files: [file] } });
  return file;
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: t('components.importResults.submit') }));
const chooseType = (type: ImportType) => fireEvent.click(screen.getByTestId(`import-type-${type}`));
const imageField = () => screen.queryByLabelText(t('components.importResults.image.label'));
const branchField = () => screen.getByLabelText(t('components.importResults.branch.label'));
const sentForm = (): FormData => post.mock.calls[0][1] as FormData;

const failWith = (status: number, data: unknown, headers: Record<string, string> = {}) =>
  post.mockRejectedValue({ isAxiosError: true, message: 'Request failed', response: { status, data, headers } });

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({ status: 202, data: { scanId: 'scan-42' } });
});

describe('ImportResultsDialog', () => {
  it('refuses a 51 MB file before any request', async () => {
    mount();
    pickFile('results.sarif', 51 * 1024 * 1024);
    submit();
    expect(await screen.findByText(t('components.importResults.file.errors.size'))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a .zip before any request', async () => {
    mount();
    pickFile('source.zip');
    submit();
    expect(await screen.findByText(t('components.importResults.file.errors.extension'))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('requires a file', async () => {
    mount();
    submit();
    expect(await screen.findByText(t('components.importResults.file.errors.missing'))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('requires a branch', async () => {
    mount('sast', '');
    pickFile();
    submit();
    expect(await screen.findByText(t('components.importResults.branch.errors.missing'))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a malformed commit before any request', async () => {
    mount();
    pickFile();
    fireEvent.change(screen.getByLabelText(t('components.importResults.commit.label')), { target: { value: 'not-a-sha' } });
    submit();
    expect(await screen.findByText(t('components.importResults.commit.errors.invalid'))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('offers the six types in order', () => {
    mount();
    const group = screen.getByRole('group', { name: t('components.importResults.type.label') });
    const labels = Array.from(group.querySelectorAll('button')).map((b) => b.getAttribute('data-testid'));
    expect(labels).toEqual(['sast', 'iac', 'secret', 'cicd', 'sca', 'container'].map((v) => `import-type-${v}`));
  });

  it('sends file, type, branch and format=sarif as multipart and reports the scan id', async () => {
    const { onImported, onClose } = mount('iac', 'develop');
    const file = pickFile();
    fireEvent.change(screen.getByLabelText(t('components.importResults.commit.label')), { target: { value: 'abcdef1' } });
    submit();
    await waitFor(() => expect(onImported).toHaveBeenCalledWith('scan-42'));
    expect(onClose).toHaveBeenCalled();
    expect(post.mock.calls[0][0]).toBe(`/project/${PROJECT}/scan/import/start`);
    const form = sentForm();
    expect(form.get('type')).toBe('iac');
    expect(form.get('branch')).toBe('develop');
    expect(form.get('format')).toBe('sarif');
    expect(form.get('commit')).toBe('abcdef1');
    expect((form.get('file') as File).name).toBe(file.name);
    expect(form.has('image')).toBe(false);
  });

  it('names a gzipped part results.sarif.gz', async () => {
    const { onImported } = mount();
    pickFile('trivy-output.sarif.gz');
    submit();
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect((sentForm().get('file') as File).name).toBe('results.sarif.gz');
  });

  it('requires an image for a container import', async () => {
    mount('container');
    pickFile();
    submit();
    expect(await screen.findByText(t('components.importResults.image.errors.missing'))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    fireEvent.change(imageField()!, { target: { value: 'NGINX' } });
    submit();
    expect(await screen.findByText(t('components.importResults.image.errors.invalid'))).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('sends the image part for a container import', async () => {
    const { onImported } = mount('container');
    pickFile();
    fireEvent.change(imageField()!, { target: { value: 'ghcr.io/acme/api:v2' } });
    submit();
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(sentForm().get('type')).toBe('container');
    expect(sentForm().get('image')).toBe('ghcr.io/acme/api:v2');
  });

  it('sends no image part once the type is no longer container', async () => {
    const { onImported } = mount('container');
    pickFile();
    fireEvent.change(imageField()!, { target: { value: 'ghcr.io/acme/api:v2' } });
    chooseType('sca');
    expect(imageField()).toBeNull();
    submit();
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(sentForm().get('type')).toBe('sca');
    expect(sentForm().has('image')).toBe(false);

    // Back to container: the image typed before is gone.
    chooseType('container');
    expect(imageField()).toHaveValue('');
  });

  it('opens on the page type', () => {
    mount('sca');
    expect(screen.getByTestId('import-type-sca')).toHaveAttribute('aria-pressed', 'true');
    expect(imageField()).toBeNull();
  });

  it('opens a container page on container, with the image field shown', () => {
    mount('container');
    expect(screen.getByTestId('import-type-container')).toHaveAttribute('aria-pressed', 'true');
    expect(imageField()).toBeInTheDocument();
  });

  it('prefills the branch with the selected branch', () => {
    mount('sast', 'release/1.4');
    expect(branchField()).toHaveValue('release/1.4');
  });

  it('says an sca import replaces the branch dependency picture', () => {
    mount('sca');
    const note = t('components.importResults.typeNote.sca');
    // The type note and the command hint's first line.
    expect(screen.getAllByText(note).length).toBe(2);
    chooseType('sast');
    expect(screen.queryByText(note)).toBeNull();
  });

  it('says a container import replaces the image picture', () => {
    mount('container');
    expect(screen.getAllByText(t('components.importResults.typeNote.container')).length).toBe(2);
    chooseType('secret');
    expect(screen.queryByText(t('components.importResults.typeNote.container'))).toBeNull();
  });

  it.each(['IMPORT_IMAGE_REQUIRED', 'IMPORT_IMAGE_INVALID', 'IMPORT_TYPE_NOT_AVAILABLE'])(
    'the route refusal %s has its own sentence',
    async (code) => {
      failWith(400, { code, message: 'server text' });
      mount('container');
      pickFile();
      fireEvent.change(imageField()!, { target: { value: 'nginx' } });
      submit();
      expect(await screen.findByText(t(`components.importResults.errors.${code}`))).toBeInTheDocument();
      expect(screen.queryByText('server text')).toBeNull();
    },
  );

  it("never shows the server's message", async () => {
    failWith(400, { code: 'IMPORT_INVALID_SARIF', message: 'Unexpected token < at 1' });
    const { onImported, onClose } = mount();
    pickFile();
    submit();
    expect(await screen.findByText(t('components.importResults.errors.IMPORT_INVALID_SARIF'))).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected token/)).toBeNull();
    expect(onImported).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('an unknown refusal shows the generic sentence, not its message', async () => {
    failWith(500, { message: 'Internal: stack trace here' });
    mount();
    pickFile();
    submit();
    expect(await screen.findByText(t('components.importResults.errors.GENERIC'))).toBeInTheDocument();
    expect(screen.queryByText(/stack trace/)).toBeNull();
  });

  it('a busy instance says when to retry', async () => {
    failWith(503, { code: 'IMPORT_BUSY' }, { 'retry-after': '15' });
    mount();
    pickFile();
    submit();
    expect(
      await screen.findByText(t('components.importResults.errors.IMPORT_BUSY', { seconds: 15 })),
    ).toBeInTheDocument();
    expect(screen.getByText(/15 seconds/)).toBeInTheDocument();
  });

  it('shows the CLI and curl commands with the project id and an absolute API URL', () => {
    mount('sast', 'main');
    expect(
      screen.getByText(`cybedefend import --project-id ${PROJECT} --type sast --branch main results.sarif`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `curl -X POST -H "Authorization: Bearer $CYBEDEFEND_TOKEN" -F file=@results.sarif --form-string type=sast --form-string branch=main --form-string format=sarif ${window.location.origin}/api/project/${PROJECT}/scan/import/start`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/trivy/)).toBeNull();
    expect(screen.getByRole('button', { name: t('components.importResults.hint.copyCli') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('components.importResults.hint.copyCurl') })).toBeInTheDocument();
  });

  it('adds --image and --form-string image= to the commands of a container import', () => {
    mount('container', 'main');
    fireEvent.change(imageField()!, { target: { value: 'ghcr.io/acme/api:v2' } });
    expect(
      screen.getByText(
        `cybedefend import --project-id ${PROJECT} --type container --branch main --image ghcr.io/acme/api:v2 results.sarif`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/--form-string image=ghcr\.io\/acme\/api:v2 --form-string format=sarif/),
    ).toBeInTheDocument();
    expect(screen.getByText('trivy image --format sarif -o results.sarif ghcr.io/acme/api:v2')).toBeInTheDocument();
  });

  it('names Trivy fs as the producer of an sca import', () => {
    mount('sca');
    expect(screen.getByText('trivy fs --format sarif -o results.sarif .')).toBeInTheDocument();
  });

  // The page hands the id of the project the API answered for: none while it
  // loads, and the import must not post to a path without it.
  it.each(['', 'not-a-uuid'])('cannot import while the project id is %j', async (projectId) => {
    render(
      <ImportResultsDialog projectId={projectId} defaultType="sast" defaultBranch="main" onClose={vi.fn()} onImported={vi.fn()} />,
    );
    pickFile();
    expect(screen.getByRole('button', { name: t('components.importResults.submit') })).toBeDisabled();
    submit();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the branch placeholder for a branch a terminal could read differently', () => {
    mount('sast', "it's my branch");
    expect(screen.getByText(/--branch <branch> results\.sarif/)).toBeInTheDocument();
    expect(screen.getByText(t('components.importResults.hint.placeholder'))).toBeInTheDocument();
  });

  it('cannot be dismissed with Escape or the backdrop while the upload runs', async () => {
    let finish: (value: unknown) => void = () => undefined;
    post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { onClose } = mount();
    pickFile();
    submit();
    await waitFor(() => expect(post).toHaveBeenCalled());

    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();

    finish({ status: 202, data: { scanId: 'scan-42' } });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on Escape when no upload runs', () => {
    const { onClose } = mount();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

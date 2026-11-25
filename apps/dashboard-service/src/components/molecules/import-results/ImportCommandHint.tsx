import React from 'react';
import { useTranslation } from 'react-i18next';
import CopyButton from '@/components/atoms/copy-button';
import { getApiUrl } from '@/config/runtimeConfig';
import type { ImportType } from '@/server/services/importService';
import { isUuid } from '@/utils/uuid';
import { isPlainBranch, isPlainImage, shellWord } from '@/utils/shell';

interface ImportCommandHintProps {
  projectId: string;
  type: ImportType;
  /** The branch the dialog holds; `<branch>` while it is empty. */
  branch: string;
  /** The image of a container import; `<image>` while it is empty. */
  image?: string;
}

export { shellWord };

/** The gateway's base URL made absolute against this origin, without its trailing slash. */
export function absoluteApiUrl(): string {
  const raw = getApiUrl() ?? '';
  let url: string;
  try {
    url = new URL(raw, window.location.origin).toString();
  } catch {
    url = window.location.origin;
  }
  return url.replace(/\/+$/, '');
}

export interface ImportCommands {
  cli: string;
  curl: string;
  /** The Trivy line that produces the file, for sca and container only. */
  producer: string | null;
  /** A branch or an image was held back and shows as its placeholder. */
  heldValues: boolean;
}

/**
 * The commands, or `null` when the project id is not a UUID. The branch and
 * the image are inserted only when every shell reads them literally
 * (`isPlainBranch`, `isPlainImage`); otherwise, and while they are empty, they
 * show as `<branch>` / `<image>`. Every text field is sent with
 * `--form-string`, which curl never reads as a file name.
 */
export function importCommands({ projectId, type, branch, image }: ImportCommandHintProps): ImportCommands | null {
  if (!isUuid(projectId)) return null;

  const isContainer = type === 'container';
  const plainBranch = branch !== '' && isPlainBranch(branch) ? branch : undefined;
  const plainImage = image && isPlainImage(image) ? image : undefined;
  const heldValues = (branch !== '' && !plainBranch) || (isContainer && !!image && !plainImage);
  const branchWord = plainBranch ? shellWord(plainBranch) : '<branch>';
  const imageWord = plainImage ? shellWord(plainImage) : '<image>';
  const textField = (name: string, value: string | undefined, placeholder: string) =>
    `--form-string ${value ? shellWord(`${name}=${value}`) : `${name}=${placeholder}`}`;
  const cli = [
    'cybedefend import',
    `--project-id ${shellWord(projectId)}`,
    `--type ${shellWord(type)}`,
    `--branch ${branchWord}`,
    ...(isContainer ? [`--image ${imageWord}`] : []),
    'results.sarif',
  ].join(' ');
  const curl = [
    'curl -X POST',
    '-H "Authorization: Bearer $CYBEDEFEND_TOKEN"',
    '-F file=@results.sarif',
    textField('type', type, type),
    textField('branch', plainBranch, '<branch>'),
    ...(isContainer ? [textField('image', plainImage, '<image>')] : []),
    textField('format', 'sarif', 'sarif'),
    shellWord(`${absoluteApiUrl()}/project/${projectId}/scan/import/start`),
  ].join(' ');
  const producer =
    type === 'sca'
      ? 'trivy fs --format sarif -o results.sarif .'
      : isContainer
        ? `trivy image --format sarif -o results.sarif ${imageWord}`
        : null;
  return { cli, curl, producer, heldValues };
}

const CommandLine: React.FC<{ label: string; command: string; copyLabel: string }> = ({ label, command, copyLabel }) => (
  <div>
    <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-1">{label}</p>
    <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-as-line-strong dark:bg-white/[0.03]">
      <code className="flex-1 min-w-0 break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">{command}</code>
      <CopyButton text={command} label={copyLabel} size="xs" />
    </div>
  </div>
);

/**
 * How to send the same file without the dialog: the CybeDefend CLI, curl with
 * a personal access token, and, for sca and container, the Trivy line that
 * produces it.
 */
const ImportCommandHint: React.FC<ImportCommandHintProps> = (props) => {
  const { t } = useTranslation();
  const commands = importCommands(props);
  const note = props.type === 'sca' || props.type === 'container' ? t(`components.importResults.typeNote.${props.type}`) : null;

  if (!commands) {
    return (
      <section className="space-y-3" aria-label={t('components.importResults.hint.title')}>
        <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('components.importResults.hint.title')}</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('components.importResults.hint.unavailable')}</p>
      </section>
    );
  }
  const { cli, curl, producer, heldValues } = commands;

  return (
    <section className="space-y-3" aria-label={t('components.importResults.hint.title')}>
      <h3 className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('components.importResults.hint.title')}</h3>
      {note && <p className="text-xs text-zinc-600 dark:text-zinc-400">{note}</p>}
      {heldValues && <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('components.importResults.hint.placeholder')}</p>}
      {producer && (
        <CommandLine label={t('components.importResults.hint.producer')} command={producer} copyLabel={t('components.importResults.hint.copyProducer')} />
      )}
      <CommandLine label={t('components.importResults.hint.cli')} command={cli} copyLabel={t('components.importResults.hint.copyCli')} />
      <CommandLine label={t('components.importResults.hint.curl')} command={curl} copyLabel={t('components.importResults.hint.copyCurl')} />
    </section>
  );
};

export default ImportCommandHint;

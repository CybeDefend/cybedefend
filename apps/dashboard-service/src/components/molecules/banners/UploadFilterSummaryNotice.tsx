import React from 'react';
import { useTranslation } from 'react-i18next';
import { AS_NOTICE_BLOCK } from '@/components/atoms/appsec/recipes';
import type { UploadFilterSummaryDto } from '@/server/interfaces/Scan';

interface UploadFilterSummaryNoticeProps {
  summary?: UploadFilterSummaryDto | null;
}

/** Excluded folders named in the notice; the others are counted. */
const FOLDERS_SHOWN = 5;

/** Characters of an excluded folder's path shown, the middle cut beyond. */
const MAX_SHOWN_NAME_LENGTH = 48;

/**
 * `name` shortened in the middle to MAX_SHOWN_NAME_LENGTH characters: the
 * start and the excluded folder at its end stay readable. Never cuts a
 * character in two.
 */
export function shortenMiddle(name: string): string {
  const characters = [...name];
  if (characters.length <= MAX_SHOWN_NAME_LENGTH) return name;
  const tail = Math.floor((MAX_SHOWN_NAME_LENGTH - 1) / 2);
  const head = MAX_SHOWN_NAME_LENGTH - 1 - tail;
  return `${characters.slice(0, head).join('')}…${characters.slice(-tail).join('')}`;
}

/**
 * Tells which files of an uploaded archive the scanners never read, and why:
 * excluded folders (named), excluded file types, scanner configuration files,
 * unsafe names. Git metadata the filter drops (hook samples, attributes) is
 * no file of the repository's tree: it is not announced. Nothing is shown when
 * nothing else was left out or the scan has no summary.
 *
 * Folder names come from the scanned repository: each is shown as text,
 * isolated for direction (`<bdi>`), so a bidirectional character in a name
 * cannot reorder the counts around it.
 */
const UploadFilterSummaryNotice: React.FC<UploadFilterSummaryNoticeProps> = ({ summary }) => {
  const { t } = useTranslation();

  if (!summary) return null;
  const excludedPath = summary.excludedPath ?? 0;
  const excludedType = summary.excludedType ?? 0;
  const scannerConfiguration = summary.scannerConfiguration ?? 0;
  const unsafeName = summary.unsafeName ?? 0;
  const total = excludedPath + excludedType + scannerConfiguration + unsafeName;
  if (total === 0) return null;

  const folders = summary.excludedFolders ?? [];
  const shown = folders.slice(0, FOLDERS_SHOWN);
  const more = folders.length - shown.length;

  return (
    <div className={`${AS_NOTICE_BLOCK} flex-col`} role="status">
      <p>{t('components.uploadFilterSummary.headline', { count: total })}</p>
      {excludedPath > 0 && (
        <p>{t('components.uploadFilterSummary.excludedPath', { count: excludedPath })}</p>
      )}
      {excludedPath > 0 && shown.length > 0 && (
        <p className="break-words">
          {t('components.uploadFilterSummary.foldersLabel')}{' '}
          {shown.map((folder, index) => (
            <React.Fragment key={`${index}-${folder.name}`}>
              {index > 0 && ', '}
              <bdi>{shortenMiddle(folder.name)}</bdi> ({folder.count})
            </React.Fragment>
          ))}
          {more > 0 && <>, {t('components.uploadFilterSummary.moreFolders', { count: more })}</>}.
        </p>
      )}
      {excludedType > 0 && (
        <p>{t('components.uploadFilterSummary.excludedType', { count: excludedType })}</p>
      )}
      {scannerConfiguration > 0 && (
        <p>{t('components.uploadFilterSummary.scannerConfiguration', { count: scannerConfiguration })}</p>
      )}
      {unsafeName > 0 && <p>{t('components.uploadFilterSummary.unsafeName', { count: unsafeName })}</p>}
    </div>
  );
};

export default UploadFilterSummaryNotice;

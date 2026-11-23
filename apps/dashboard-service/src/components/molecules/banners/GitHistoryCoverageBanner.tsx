import React from 'react';
import { useTranslation } from 'react-i18next';
import { AS_NOTICE_BLOCK } from '@/components/atoms/appsec/recipes';
import type { ScanResponseDto } from '@/server/interfaces/Scan';
import { convertDate } from '@/utils/function/utils';

interface GitHistoryCoverageBannerProps {
  coverage?: ScanResponseDto['historyCoverage'];
}

const shortSha = (sha: string) => sha.slice(0, 7);

/**
 * Tells how much of a branch's git history the Secrets scan analysed.
 * Nothing is shown when the history is fully covered or unknown.
 */
const GitHistoryCoverageBanner: React.FC<GitHistoryCoverageBannerProps> = ({ coverage }) => {
  const { t } = useTranslation();

  if (!coverage) return null;
  const gaps = coverage.gaps ?? [];

  // What the last pass recorded decides the sentence. Incomplete coverage with
  // no date and no recorded outcome claims nothing.
  let headline: string | null = null;
  if (coverage.lastPassOutcome === 'failed') {
    headline = t('components.gitHistoryCoverage.failed');
  } else if (coverage.lastPassOutcome === 'none') {
    headline = t('components.gitHistoryCoverage.none');
  } else if (!coverage.complete && coverage.coveredSince) {
    headline = t('components.gitHistoryCoverage.partial', {
      date: convertDate(coverage.coveredSince),
    });
  }

  if (!headline && gaps.length === 0) return null;

  return (
    <div className={`${AS_NOTICE_BLOCK} flex-col`} role="status">
      {headline && <p>{headline}</p>}
      {gaps.map((gap) => (
        <p key={`${gap.fromSha}-${gap.toSha}`}>
          {t('components.gitHistoryCoverage.gaps', {
            from: gap.fromDate ? convertDate(gap.fromDate) : shortSha(gap.fromSha),
            to: gap.toDate ? convertDate(gap.toDate) : shortSha(gap.toSha),
          })}
        </p>
      ))}
    </div>
  );
};

export default GitHistoryCoverageBanner;

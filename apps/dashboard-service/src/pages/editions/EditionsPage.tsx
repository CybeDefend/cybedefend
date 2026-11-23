import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Check, Filter, GitBranch, Minus } from '@/components/atoms/icon/icons';
import { AS_SECTION_TITLE } from '@/components/atoms/appsec/styles';
import { Table, TableBody, TableData, TableHead, TableHeader, TableRow } from '@/components/organismes/table';
import { upsellLink } from '@/edition/upsell/upsellLink';
import { EDITION_COLUMNS, EDITIONS_MATRIX, PROPRIETARY_RULE_LANGUAGES, type EditionCell } from './editionsMatrix';

/** The slot id of this page, which tags its links (`utm_campaign`). */
export const EDITIONS_UPSELL_SLOT_ID = 'editions';

/** A CTA: a muted outlined link to the site, in a new tab, never an accent fill. */
const CTA_CLASS =
  'inline-flex h-9 items-center rounded-lg border border-zinc-200 px-3 text-[13px] font-medium text-zinc-700 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-900 dark:border-as-line dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100';

/** The « Why Cloud » items, in order: `pages.editions.highlights.<key>.{title,body}`. */
const HIGHLIGHTS = [
  { key: 'reachability', Icon: GitBranch },
  { key: 'falsePositives', Icon: Filter },
  { key: 'rules', Icon: BookOpen },
] as const;

/**
 * The Community Edition's comparison of the three editions, at
 * `/editions` (Community route table only). Each mark carries its translated
 * name, so a screen reader reads « Included » or « Not included »; a cell that
 * is only partly true adds its note as small text under the mark.
 */
const EditionsPage: React.FC = () => {
  const { t } = useTranslation();
  const mark = (included: boolean) => (
    <span role="img" aria-label={t(included ? 'pages.editions.included' : 'pages.editions.notIncluded')}>
      {included ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 text-zinc-700 dark:text-zinc-300" />
      ) : (
        <Minus aria-hidden="true" className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-450" />
      )}
    </span>
  );
  const cell = ({ included, note }: EditionCell) => (
    <span className="inline-flex flex-col items-center gap-0.5">
      {mark(included)}
      {note ? (
        <span className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
          {t(`pages.editions.notes.${note}`)}
        </span>
      ) : null}
    </span>
  );
  const cta = (label: string, path: string) => (
    <a href={upsellLink(EDITIONS_UPSELL_SLOT_ID, path)} target="_blank" rel="noopener noreferrer" className={CTA_CLASS}>
      {label}
      <span className="sr-only"> {t('pages.editions.opensInNewTab')}</span>
    </a>
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h2 className={AS_SECTION_TITLE}>{t('pages.editions.title')}</h2>
        <p className="mt-1 text-[13px] text-zinc-500 dark:text-zinc-400">{t('pages.editions.subtitle')}</p>
      </div>

      <section
        aria-labelledby="editions-highlights-title"
        className="rounded-xl border border-secondary/30 bg-secondary/5 p-4 dark:border-secondary-light/40 dark:bg-secondary/10 sm:p-5"
      >
        <h3
          id="editions-highlights-title"
          className="text-[14px] font-semibold text-secondary dark:text-secondary-light"
        >
          {t('pages.editions.highlights.title')}
        </h3>
        <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">{t('pages.editions.highlights.subtitle')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {HIGHLIGHTS.map(({ key, Icon }) => (
            <div key={key} className="min-w-0">
              <div className="flex items-center gap-2">
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-secondary dark:text-secondary-light" />
                <h4 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                  {t(`pages.editions.highlights.${key}.title`)}
                </h4>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-zinc-600 dark:text-zinc-400">
                {t(`pages.editions.highlights.${key}.body`)}
              </p>
              {key === 'rules' ? (
                <ul aria-label={t('pages.editions.highlights.languagesLabel')} className="mt-2 flex flex-wrap gap-1">
                  {PROPRIETARY_RULE_LANGUAGES.map((language) => (
                    <li
                      key={language}
                      className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[11px] text-zinc-700 dark:border-as-line dark:bg-white/[0.04] dark:text-zinc-300"
                    >
                      {language}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-4">{cta(t('pages.editions.cta.cloud'), '/pricing')}</div>
      </section>

      <Table aria-label={t('pages.editions.tableLabel')} variant="compact">
        <TableHeader>
          <TableRow isHeader>
            <TableHead scope="col">{t('pages.editions.feature')}</TableHead>
            {EDITION_COLUMNS.map((column) => (
              <TableHead key={column} scope="col" className="text-center">
                {t(`pages.editions.columns.${column}`)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {EDITIONS_MATRIX.map((row) => (
            <TableRow key={row.key}>
              <TableData className="text-zinc-700 dark:text-zinc-300">{t(`pages.editions.rows.${row.key}`)}</TableData>
              {EDITION_COLUMNS.map((column) => (
                <TableData key={column} className="text-center">
                  {cell(row[column])}
                </TableData>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-wrap gap-3">
        {cta(t('pages.editions.cta.cloud'), '/pricing')}
        {cta(t('pages.editions.cta.enterprise'), '/contact')}
      </div>
    </div>
  );
};

export default EditionsPage;

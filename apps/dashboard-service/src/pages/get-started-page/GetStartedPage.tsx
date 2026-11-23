import React, { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/molecules/page-container';
import Badge from '@/components/atoms/badge/Badge';
import Card from '@/components/atoms/card';
import IconTile from '@/components/atoms/icon-tile';
import TextLink from '@/components/atoms/text-link';
import {
  Bot,
  Container,
  ExternalLink,
  FileImport,
  Github,
  Plug,
  ShieldCheck,
  Terminal,
  Zap,
  type IconProps,
} from '@/components/atoms/icon/icons';
import { AS_META, AS_PAGE_TITLE, AS_PANEL_TITLE, AS_SECTION_TITLE } from '@/components/atoms/appsec/styles';
import { upsellLink } from '@/edition/upsell/upsellLink';
import { APPSEC_PROJECTS_PATH } from '@/utils/product';
import { cn } from '@/utils/function/utils';

/** The slot ids of this page's links to the site (`utm_campaign`), one per surface. */
export const GET_STARTED_CLOUD_SLOT_ID = 'get-started-cloud';
export const GET_STARTED_PRIVATE_CLOUD_SLOT_ID = 'get-started-private-cloud';

/** The comparison of the editions, a page of the Community dashboard (`App.tsx`). */
const EDITIONS_PATH = '/editions';

/** The self-hosting guide of the public repository, where the cluster and MCP sections live. */
const COMMUNITY_README = 'https://github.com/CybeDefend/cybedefend/blob/main/deploy/community/README.md';

interface QuickStart {
  /** Its keys under `pages.getStarted.quickStart`. */
  key: string;
  icon: React.ComponentType<IconProps>;
  /** An in-app route (`to`) or a page elsewhere (`href`, in a new tab). */
  to?: string;
  href?: string;
}

const QUICK_STARTS: readonly QuickStart[] = [
  // Imports are made from a project's results page (« Import results »).
  { key: 'importSarif', icon: FileImport, to: APPSEC_PROJECTS_PATH },
  { key: 'kubernetes', icon: Container, href: `${COMMUNITY_README}#run-scans-on-a-kubernetes-cluster` },
  // The public CLI does not work with Open Source yet (it signs in through
  // Logto and has no import command): CI imports go through the API.
  { key: 'ciImport', icon: Terminal, href: `${COMMUNITY_README}#importing-results` },
  { key: 'githubAction', icon: Github, href: 'https://github.com/CybeDefend/cybedefend-scanners' },
  { key: 'repositories', icon: Plug, to: '/organization/settings/integrations' },
  { key: 'mcp', icon: Bot, href: `${COMMUNITY_README}#the-mcp-server-optional` },
  { key: 'policy', icon: ShieldCheck, to: '/organization/settings/policies/create' },
];

/** A muted outlined link, as the editions page's CTAs; the banner's is the accent fill. */
const CTA_OUTLINE =
  'inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-700 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50 dark:border-as-line dark:bg-transparent dark:text-zinc-300 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100';
const CTA_ACCENT =
  'inline-flex h-9 items-center gap-1.5 rounded-lg bg-secondary px-3 text-[13px] font-medium text-white transition-colors duration-[120ms] hover:bg-secondary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary/50 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-as-bg';

/** A cloud drawn in the space's accent (no remote image), for the banner. */
const CloudIllustration: React.FC = () => (
  <svg
    aria-hidden="true"
    viewBox="0 0 120 80"
    className="h-20 w-28 shrink-0 text-secondary dark:text-secondary-light"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M34 66h54a20 20 0 0 0 2-39.9A26 26 0 0 0 40.6 30 18 18 0 0 0 34 66Z"
      fill="currentColor"
      fillOpacity="0.12"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinejoin="round"
    />
    <path d="M52 50l8-8 8 8M60 42v16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="98" cy="12" r="3" fill="currentColor" fillOpacity="0.5" />
    <circle cx="14" cy="24" r="2" fill="currentColor" fillOpacity="0.4" />
  </svg>
);

/**
 * The Community Edition's AppSec home, in
 * the style of Logto's « Get started »: the cloud first, the Private cloud for
 * those who need it, then one card per first step. The project list it
 * replaced as the landing is at `APPSEC_PROJECTS_PATH`. The cloud never routes
 * this page.
 */
const GetStartedPage: React.FC = () => {
  const { t } = useTranslation();
  const cloudId = useId();
  const privateId = useId();
  const quickId = useId();
  const newTab = <span className="sr-only"> {t('pages.getStarted.opensInNewTab')}</span>;
  const external = (href: string, label: string, className: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
      {newTab}
    </a>
  );

  return (
    <PageContainer background="default" padding="md">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <header>
          <h1 className={AS_PAGE_TITLE}>{t('pages.getStarted.title')}</h1>
          <p className={cn(AS_META, 'mt-1')}>{t('pages.getStarted.description')}</p>
        </header>

        <section
          aria-labelledby={cloudId}
          className="flex flex-col gap-4 rounded-xl border border-secondary/25 bg-secondary/[0.06] p-4 sm:p-6 lg:flex-row lg:items-center dark:border-secondary-light/25 dark:bg-secondary/[0.12]"
        >
          <CloudIllustration />
          <div className="min-w-0 flex-1">
            {/* The badge sits beside the heading, not in it: the heading and the
                region it names keep the banner title alone as their name. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 id={cloudId} className={AS_PANEL_TITLE}>
                {t('pages.getStarted.cloud.title')}
              </h2>
              <Badge
                variant="secondary"
                size="xs"
                className="rounded-full"
                icon={<Zap aria-hidden="true" className="h-3 w-3" />}
              >
                {t('pages.getStarted.cloud.recommended')}
              </Badge>
            </div>
            <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">{t('pages.getStarted.cloud.body')}</p>
          </div>
          {/* The editions page, in the app, under the button: it compares what each
              edition holds before the site is opened. */}
          <div className="flex shrink-0 flex-col items-start gap-2 lg:items-center">
            {external(upsellLink(GET_STARTED_CLOUD_SLOT_ID, '/pricing'), t('pages.getStarted.cloud.cta'), CTA_ACCENT)}
            <TextLink to={EDITIONS_PATH} className="text-[12px]">
              {t('pages.getStarted.cloud.editions')}
            </TextLink>
          </div>
        </section>

        <section aria-labelledby={privateId} className="space-y-3">
          <h2 id={privateId} className={AS_SECTION_TITLE}>
            {t('pages.getStarted.privateCloud.sectionTitle')}
          </h2>
          <Card padding="none" className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-6">
            <IconTile size="lg">
              <ShieldCheck />
            </IconTile>
            <div className="min-w-0 flex-1">
              <h3 className={AS_PANEL_TITLE}>{t('pages.getStarted.privateCloud.title')}</h3>
              <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">
                {t('pages.getStarted.privateCloud.body')}
              </p>
            </div>
            <div className="shrink-0">
              {external(
                upsellLink(GET_STARTED_PRIVATE_CLOUD_SLOT_ID, '/contact'),
                t('pages.getStarted.privateCloud.cta'),
                CTA_OUTLINE,
              )}
            </div>
          </Card>
        </section>

        <section aria-labelledby={quickId} className="space-y-3">
          <h2 id={quickId} className={AS_SECTION_TITLE}>
            {t('pages.getStarted.quickStart.title')}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
            {QUICK_STARTS.map(({ key, icon: Icon, to, href }) => (
              <Card key={key} as="article" padding="none" className="flex h-full flex-col gap-3 p-4 sm:p-5">
                <IconTile size="sm">
                  <Icon />
                </IconTile>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[14px] font-medium text-zinc-900 dark:text-zinc-100">
                    {t(`pages.getStarted.quickStart.${key}.title`)}
                  </h3>
                  <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">
                    {t(`pages.getStarted.quickStart.${key}.body`)}
                  </p>
                </div>
                <div>
                  {to ? (
                    <TextLink to={to} className="text-[13px]">
                      {t(`pages.getStarted.quickStart.${key}.cta`)}
                    </TextLink>
                  ) : (
                    <TextLink href={href} target="_blank" className="inline-flex items-center gap-1 text-[13px]">
                      {t(`pages.getStarted.quickStart.${key}.cta`)}
                      <ExternalLink aria-hidden="true" className="h-3 w-3" />
                      {newTab}
                    </TextLink>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </PageContainer>
  );
};

export default GetStartedPage;

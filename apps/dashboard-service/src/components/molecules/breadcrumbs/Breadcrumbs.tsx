import React from "react";
import { useLocation, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useBreadcrumbProjectName } from './BreadcrumbProjectContext';
import { PRODUCTS, PRODUCT_SPACES, productHome, spaceOf, useProduct } from '@/utils/product';
import { AS_TOUCH } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
import { useSlotEntries } from '@/edition/slots';
import { EDITION } from '@/edition/edition';
import { isScannerTabEntry, scannerTabSegment } from '@/components/molecules/wrapper/scannerTabs';

/** The first segment of each product's prefix (`appsec`, and each closed space's). */
const PRODUCT_SEGMENTS: readonly string[] = PRODUCTS.map((product) => productHome(product).slice(1));

/**
 * URL segment → translation key suffix, under `navigation.breadcrumb.*`.
 *
 * The trail used to be built by capitalising the raw pathname, which is why
 * users saw "Sast", "Code-graph", the space's slug, "Reports", "Settings" and
 * "Policies" — slugs, in English, in a French interface. A segment absent from
 * this map renders unchanged (lowercase slug) rather than title-cased: a
 * missing entry should look obviously wrong, not like a plausible label.
 *
 * `sast` deliberately resolves to the same wording as its tab ("Code Source")
 * so one screen stops carrying three names for itself.
 */
const SEGMENT_KEYS: Record<string, string> = {
  project: 'project',
  overview: 'overview',
  // analysis types
  sast: 'sast',
  iac: 'iac',
  cicd: 'cicd',
  secret: 'secret',
  sca: 'sca',
  container: 'container',
  // project tabs
  'code-graph': 'code-graph',
  compliance: 'compliance',
  // organisation
  autofix: 'autofix',
  reports: 'reports',
  policies: 'policies',
  settings: 'settings',
  teams: 'teams',
  projects: 'projects',
  integrations: 'integrations',
  integration: 'integration',
  billing: 'billing',
  'subscription-expired': 'subscription-expired',
  // A product the member does not hold (per-member products).
  'no-access': 'no-access',
  usage: 'usage',
  licenses: 'licenses',
  license: 'license',
  profile: 'profile',
  security: 'security',
  'personal-access-tokens': 'personal-access-tokens',
  issue: 'issue',
  scan: 'scan',
  create: 'create',
  edit: 'edit',
  link: 'link',
  connect: 'connect',
  activity: 'activity',
};

/**
 * Segments of pages only the Community Edition routes (`/editions`). Read
 * at render: the cloud has no such page and keeps its
 * trail as it was.
 */
const COMMUNITY_SEGMENT_KEYS: Record<string, string> = {
  editions: 'editions',
};
const communitySegmentKey = (segment: string): string | undefined =>
  EDITION === 'community' ? COMMUNITY_SEGMENT_KEYS[segment] : undefined;

/** A segment of a product space's own project tabs (`ProductSpace.breadcrumbSegments`), or undefined. */
const spaceSegmentKey = (segment: string): string | undefined =>
  PRODUCT_SPACES.map((space) => space.breadcrumbSegments?.[segment]).find((key) => key !== undefined);

/**
 * The classes of the trail, per skin. AppSec's follow the AppSec style;
 * the zinc skin's follow the zinc kit: 13 px zinc-500 crumbs leading to the current one in ink, hairline
 * chevrons, and the chip as the 12 px mark beside the word in zinc-500 — no
 * tinted pill. Every structural class the phone relies on (truncation, shrink
 * order, the inset focus ring, the `sm` paddings) is in both.
 */
interface TrailSkin {
  chip: string;
  rootItem: string;
  rootLink: string;
  separator: string;
  separatorStroke: string;
  crumbText: string;
  projectLink: string;
  /** The `li` of a crumb between the project and the current page. */
  middleItem: string;
  /** The `li` of the current page. */
  currentItem: string;
  link: string;
  current: string;
  homeLabel: string;
}

/** AppSec: 13 px zinc crumbs to the current one in ink, the product chip in zinc too. */
const APPSEC_LINK =
  "text-zinc-500 transition-colors duration-[120ms] hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

const APPSEC_TRAIL: TrailSkin = {
  // Zinc text on nothing, like the other crumbs: the root of the trail is
  // not where the eye should go, the page is. No tinted pill, no violet text. The hover is the header's zinc tint.
  chip: cn(
    "relative rounded-md px-1.5 py-0.5 text-xs font-medium text-zinc-500 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-secondary dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-100 dark:focus-visible:ring-secondary-light sm:px-2",
    AS_TOUCH
  ),
  rootItem: "hidden shrink-0 items-center text-[13px] sm:flex",
  rootLink: `font-medium ${APPSEC_LINK}`,
  separator: "shrink-0 mx-1.5 overflow-visible size-2.5 text-zinc-300 dark:text-zinc-600",
  separatorStroke: "2",
  crumbText: "text-[13px]",
  // A phone gets 44 px to tap: a link that truncates grows by its padding (it
  // clips what overflows, an ::after would be cut).
  projectLink: `min-w-0 max-w-[8rem] truncate max-md:-my-3 max-md:py-3 ${APPSEC_LINK} sm:max-w-[16rem]`,
  // A middle crumb gives way before the current page: on a
  // phone « Settings › Policies › Cr… » kept its middle crumbs whole and cut
  // the page the user is on. It ends with an ellipsis, after the project
  // (`shrink-[8]`) and before the current page — but never below 56 px (its
  // separator and three letters), where « Paramètres » had become a 15 px
  // « … ». Below `sm` it is not shown at all: a phone
  // reads « AppSec › Création », and the page itself names its section.
  middleItem: "min-w-[3.5rem] shrink-[4] max-sm:hidden",
  // The current page keeps its words while anything else can give way: flexbox
  // shares the deficit by width × factor, and any shrink at all ends its text
  // with an ellipsis (0.3 px did, measured at 390 px; so did 0.07 px with a
  // factor of 0.01 on « Création »). At 0.001 its share stays under the 1/64 px
  // layout grid until the other crumbs are nearly gone; alone and too long, it
  // is the only crumb left to shrink and still ends with an ellipsis, never
  // cut by the header's edge. Its `min-w-0` is what lets it truncate.
  currentItem: "min-w-0 shrink-[0.001]",
  link: `min-w-0 truncate max-md:-my-3 max-md:py-3 ${APPSEC_LINK}`,
  current: "min-w-0 truncate font-medium text-zinc-900 dark:text-zinc-100",
  homeLabel: "min-w-0 truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100",
};

const ZINC_LINK =
  "text-zinc-500 transition-colors duration-[120ms] hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100";

const ZINC_TRAIL: TrailSkin = {
  chip: "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-zinc-500 transition-colors duration-[120ms] hover:text-zinc-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-zinc-400 dark:text-zinc-400 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-500 sm:px-2",
  rootItem: "hidden shrink-0 items-center text-[13px] sm:flex",
  rootLink: ZINC_LINK,
  separator: "shrink-0 mx-2 overflow-visible size-2.5 text-zinc-300 dark:text-zinc-600",
  separatorStroke: "1.5",
  crumbText: "text-[13px]",
  projectLink: `min-w-0 max-w-[8rem] truncate ${ZINC_LINK} sm:max-w-[16rem]`,
  // Kept as they always were in this skin.
  middleItem: "shrink-0",
  currentItem: "min-w-0",
  link: ZINC_LINK,
  current: "min-w-0 truncate text-zinc-900 dark:text-zinc-100",
  homeLabel: "min-w-0 truncate text-[13px] text-zinc-900 dark:text-zinc-100",
};

export const Breadcrumbs: React.FC = () => {
  const location = useLocation();
  const { t } = useTranslation();
  const projectName = useBreadcrumbProjectName();
  const product = useProduct();
  const home = productHome(product);
  const space = spaceOf(product);
  const isZinc = space.skin === 'zinc';
  const skin = isZinc ? ZINC_TRAIL : APPSEC_TRAIL;
  // The zinc chip is the space's 12 px mark beside its name.
  const ChipMark = isZinc ? space.Mark : undefined;

  const isUUID = (segment: string) => {
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[4][0-9a-fA-F]{3}-[89ab][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
      segment
    );
  };

  // The closed tree's scanner-list tabs (the AI-BOM one) also have a
  // crumb: their segment is registered on `project.tabs` as `scanner:<segment>`.
  const scannerSegments = useSlotEntries('project.tabs')
    .filter(isScannerTabEntry)
    .map((entry) => scannerTabSegment(entry.id));

  const segments = location.pathname.split("/").filter((segment) => segment);

  const breadcrumbItems = [];
  let cumulativePath = "";

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // The product prefix is named by the chip, not by a crumb of its own; it
    // stays in the path so every crumb links inside the space of the page.
    if (i === 0 && PRODUCT_SEGMENTS.includes(segment)) {
      cumulativePath += "/" + segment;
      continue;
    }

    if (segment === "organization") {
      continue;
    }

    
    if (segment === "project") {
      cumulativePath += "/" + segment;

      const nextSegment = segments[i + 1];
      if (nextSegment && isUUID(nextSegment)) {
        cumulativePath += "/" + nextSegment;
        i++; 
      }

      breadcrumbItems.push({
        segment,
        path: cumulativePath,
      });

      continue;
    }

    cumulativePath += "/" + segment;

    if (isUUID(segment)) {
      continue;
    }

    // Skip pure-namespace separators that have no semantic value for the
    // user (ex: a closed scanner page's /c/<purl> — the `c` is just a routing namespace).
    if (segment === "c" && scannerSegments.includes(segments[i - 1])) {
      continue;
    }

    breadcrumbItems.push({
      segment,
      path: cumulativePath,
    });
  }

  return (
    // `min-w-0` on the trail and on its last crumb: the mobile header gives the
    // trail what its actions leave and hides what overflows, and with the chip
    // in front most trails are wider than that on a phone. A flex item never
    // shrinks below its text unless told it may, so a crumb was cut in the
    // middle of a letter; the current page now ends with an ellipsis. Below
    // `sm` the trail also gives up its left margin and the chip a little of
    // its padding, for the same reason.
    <ol className="flex min-w-0 items-center whitespace-nowrap sm:ms-3">
      {/* The chip names the product and is the way to its home on every width.
          It never shrinks. The focus ring is inset: the mobile header clips
          what overflows. */}
      <li className="mr-1.5 flex shrink-0 items-center sm:mr-2">
        <Link
          to={home}
          data-testid="breadcrumb-product"
          className={skin.chip}
        >
          {ChipMark && <ChipMark aria-hidden="true" className="h-3 w-3 shrink-0" />}
          {t(`components.productSwitch.${product}`)}
        </Link>
      </li>

      {/* Root link, with its chevron. Hidden below `sm`: the trail has
          little room on a phone, and the chip already leads home. Absent on a
          page with no crumb (a product home), where the label below says it. */}
      {breadcrumbItems.length > 0 && (
        <li className={skin.rootItem}>
          <Link
            to={home}
            className={skin.rootLink}
          >
            {t('navigation.dashboard')}
          </Link>
          <svg
            className={skin.separator}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M5 1L10.6869 7.16086C10.8637 7.35239 10.8637 7.64761 10.6869 7.83914L5 14"
              stroke="currentColor"
              strokeWidth={skin.separatorStroke}
              strokeLinecap="round"
            />
          </svg>
        </li>
      )}

      {breadcrumbItems.length > 0 ? (
        breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;
          // Decode the segment when it is URL-encoded (typically a purl with
          // %3A / %2F on detail pages).
          let displaySegment: string;
          try {
            displaySegment = decodeURIComponent(item.segment);
          } catch {
            displaySegment = item.segment;
          }

          // Known route → translated label. A registered scanner segment is
          // one too (its key is the segment itself). Unknown route → the slug
          // as-is, so a missing entry is visible rather than passing for a real label.
          const lowered = item.segment.toLowerCase();
          const key = SEGMENT_KEYS[lowered] ?? communitySegmentKey(lowered) ?? spaceSegmentKey(lowered) ?? (scannerSegments.includes(lowered) ? lowered : undefined);
          if (key) {
            displaySegment = t(`navigation.breadcrumb.${key}`);
          }

          // A project crumb naming the project beats one naming the concept:
          // "Projet" is the same word on every project in the account.
          const namesProject = item.segment.toLowerCase() === 'project' && !!projectName;
          if (namesProject) {
            displaySegment = projectName;
          }
          // A project crumb before the current page gives way first, its full
          // name in a `title`: kept whole, a long name left nothing of the
          // current page on a phone.
          const shrinkableProject = namesProject && !isLast;

          // Truncate very long segments (e.g. a full purl at the end of the URL)
          // so they do not break the breadcrumb layout.
          if (!shrinkableProject && displaySegment.length > 40) {
            displaySegment = displaySegment.slice(0, 37) + '...';
          }

          let linkPath = item.path;

          if (item.segment.toLowerCase() === "settings") {
            linkPath = "/organization/settings";
          }

          return (
            // The current page gives way, and a project named before it. What
            // a middle crumb does, and how reluctantly the current page gives
            // way, is the skin's: a crumb that shrinks without truncating
            // loses its last letters (« Paramètr… »), so a skin that lets it
            // shrink also lets its link truncate.
            <li
              key={index}
              // The project gives way well before the current page (`shrink-[8]`):
              // at 320 px, shrinking alike, « Scan diff » was left as « S… ».
              className={`flex items-center ${skin.crumbText} ${
                shrinkableProject ? 'min-w-0 shrink-[8]' : isLast ? skin.currentItem : skin.middleItem
              }`}
            >
              {index > 0 && (
                <svg
                  className={skin.separator}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M5 1L10.6869 7.16086C10.8637 7.35239 10.8637 7.64761 10.6869 7.83914L5 14"
                    stroke="currentColor"
                    strokeWidth={skin.separatorStroke}
                    strokeLinecap="round"
                  />
                </svg>
              )}

              {shrinkableProject ? (
                <Link
                  to={linkPath}
                  title={displaySegment}
                  className={skin.projectLink}
                >
                  {displaySegment}
                </Link>
              ) : !isLast ? (
                <Link
                  to={linkPath}
                  className={skin.link}
                >
                  {displaySegment}
                </Link>
              ) : (
                <span
                  className={skin.current}
                  aria-current="page"
                >
                  {displaySegment}
                </span>
              )}
            </li>
          );
        })
      ) : (
        <li className={skin.homeLabel}>
          {t('navigation.dashboard')}
        </li>
      )}
    </ol>
  );
};

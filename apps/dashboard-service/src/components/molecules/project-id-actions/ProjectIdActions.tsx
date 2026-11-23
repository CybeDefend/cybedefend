import React, { useState } from "react";
import { toast } from "react-toastify";
import { Check, Clipboard } from '@/components/atoms/icon/icons';
import { useTranslation } from "react-i18next";
import { useProduct } from "@/utils/product";
import { Slot } from "@/edition/slots";
import { AS_TOUCH_SQUARE } from "@/components/atoms/appsec/styles";
import { copyText } from "@/utils/copyText";

/** AppSec's keyboard ring; a zinc space, which shows the same row, keeps the browser's. */
const APPSEC_FOCUS =
  "appsec:focus:outline-none appsec:focus-visible:ring-2 appsec:focus-visible:ring-secondary appsec:focus-visible:ring-offset-1 appsec:focus-visible:ring-offset-white appsec-dark:focus-visible:ring-offset-as-bg";

interface ProjectIdActionsProps {
  projectId: string;
  /**
   * False where these actions sit next to the identifier rather than in the
   * page header (the « Project ID » box of the settings form): the
   * `project.actions` registrations are told (`placement: 'inline'`), and a
   * header element (a state pill) is shown once per page.
   */
  statePill?: boolean;
}

/**
 * The tooltip of an action, shown on hover and on keyboard focus: it is the
 * only visible label of an icon. Its parent must be `relative group`.
 *
 * Not laid out until then (`hidden`, not a transparent box): the one of the
 * copy action holds the project id on a single line, and next to a long project
 * name on a phone it reached past the right edge and made the page scroll
 * sideways without ever being seen.
 */
// AppSec takes the refreshed tooltip (ink on light, white on dark); a zinc
// space, which shows the same row, keeps today's (`appsec:` is off under its
// attribute). The `project.actions` registrations take it too.
export const ActionTooltip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg hidden group-hover:block group-focus-within:block pointer-events-none whitespace-nowrap z-50 shadow-lg appsec:rounded-md appsec:px-2 appsec:py-1 appsec:leading-4 appsec:bg-zinc-900 appsec:shadow-none appsec-dark:bg-zinc-100 appsec-dark:text-zinc-900">
    {children}
    <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 dark:bg-gray-700 rotate-45 appsec:bg-zinc-900 appsec-dark:bg-zinc-100"></div>
  </div>
);

/**
 * ProjectIdActions — the row of icon buttons next to a project title: the
 * copy of the project ID to the clipboard, then the registrations of the
 * `project.actions` slot (a closed space's own action, or its way in).
 */
const ProjectIdActions: React.FC<ProjectIdActionsProps> = ({ projectId, statePill = true }) => {
  const { t } = useTranslation();
  const product = useProduct();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (await copyText(projectId)) {
      setCopied(true);
      toast.success(t("common.copiedToClipboard"));
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error(t("common.copyFailed"));
    }
  };

  return (
    // `contents`: the actions are items of the row they are mounted in (a
    // `flex items-center gap-2` row, next to the project name or its id), not a
    // box of their own. That row can then share its room between the name and
    // the state pill; inside a box the pill could not be narrowed.
    <div className="contents">
      {/* Copy project ID */}
      <div className="relative group shrink-0">
        <button
          onClick={handleCopy}
          data-testid="copy-project-id-button"
          aria-label={t("common.copyProjectId")}
          className={`relative inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors appsec:duration-[120ms] appsec:text-zinc-400 appsec:hover:bg-zinc-100 appsec:hover:text-zinc-700 appsec-dark:text-zinc-500 appsec-dark:hover:bg-white/[0.06] appsec-dark:hover:text-zinc-200 ${APPSEC_FOCUS} ${AS_TOUCH_SQUARE}`}
        >
          {copied ? (
            <Check className="w-5 h-5 text-green-500 appsec:h-4 appsec:w-4" />
          ) : (
            <Clipboard className="w-5 h-5 appsec:h-4 appsec:w-4" />
          )}
        </button>
        <ActionTooltip>
          <div className="font-medium mb-0.5">{t("common.copyProjectId")}</div>
          <div className="text-gray-300 font-mono text-[10px] appsec:text-[11px] appsec:text-zinc-300 appsec-dark:text-zinc-600">{projectId}</div>
        </ActionTooltip>
      </div>

      <Slot
        name="project.actions"
        context={{ projectId, product, placement: statePill ? "header" : "inline" }}
      />
    </div>
  );
};

export default ProjectIdActions;

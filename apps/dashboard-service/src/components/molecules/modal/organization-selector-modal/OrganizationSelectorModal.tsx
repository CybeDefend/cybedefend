

import { motion } from "framer-motion";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDispatch, useSelector } from "react-redux";
import { useAuth } from "@/edition/auth/useAuth";
import { ProfileOrganization } from "../../../../server/interfaces/Organization";
import { setSelectedOrganization } from "../../../../server/store/organizationSlice";
import SearchBox from "../../../atoms/search-box/SearchBox";
import { Skeleton } from "../../../atoms/skeleton/Skeleton";
import { Check } from '@/components/atoms/icon/icons';

interface OrganizationSelectorModalProps {
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /**
   * `dark`: the skin of a zinc-kit rail, dark in both themes — a plain
   * popover (hairline, 8 px radius, no shadow), 32 px rows, the current
   * organisation marked in ink. The `dark` class scopes its contents (the
   * search box) to their dark colours. It enters by moving, never by fading:
   * an overlay is never see-through. Without it, the picker is unchanged.
   */
  surface?: 'default' | 'dark';
}

/** The dark rail skin (a zinc-kit space). */
const DARK_PANEL =
  'fixed z-50 rounded-lg border border-white/[0.08] bg-[#111113] text-zinc-100 modal-content dark';
const DARK_ROW =
  'flex h-8 items-center justify-between rounded-md px-2.5 cursor-pointer text-[13px] text-zinc-300 transition-colors duration-[120ms] hover:bg-white/[0.05] hover:text-white';

/*
 * The default skin. Another space's light theme opens it too, so the AppSec
 * style only reaches it through
 * `appsec:` / `appsec-dark:`, which a page of another space switches off. In AppSec
 * it is the zinc kit menu's quality: a raised surface with a hairline, 36 px
 * rows of 13 px, the current organisation marked by a 6 px dot in the accent
 * at the row's end — as the rail's settings menu marks its current entry —
 * never a fill.
 */
const DEFAULT_PANEL =
  'fixed z-50 bg-white dark:bg-neutral-900 rounded-lg shadow border border-gray-200 dark:border-neutral-700 modal-content appsec:border-zinc-200 appsec:shadow-[0_4px_16px_-4px_rgb(0_0_0/0.08),0_1px_2px_rgb(0_0_0/0.04)] appsec-dark:bg-as-raised appsec-dark:border-as-line-strong appsec-dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.05),0_16px_40px_-8px_rgb(0_0_0/0.7)]';
const DEFAULT_ROW =
  'flex justify-between items-center py-2 px-4 cursor-pointer hover:bg-alternative dark:hover:bg-neutral-700 rounded-lg appsec:h-9 appsec:gap-2 appsec:py-0 appsec:px-2.5 appsec:rounded-md appsec:transition-colors appsec:duration-[80ms] appsec:hover:bg-zinc-100 appsec:max-md:h-11 appsec-dark:hover:bg-white/[0.06]';
/** The current organisation's row in AppSec: the dot, drawn by the row itself (the Brain keeps its check). */
const DEFAULT_ROW_CURRENT =
  "appsec:after:ml-auto appsec:after:h-1.5 appsec:after:w-1.5 appsec:after:shrink-0 appsec:after:rounded-full appsec:after:bg-secondary appsec-dark:after:bg-secondary-light appsec:after:content-['']";

const OrganizationSelectorModal: React.FC<OrganizationSelectorModalProps> = ({
  onClose,
  triggerRef,
  surface = 'default',
}) => {
  const dark = surface === 'dark';
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const selectedOrganization = useSelector(
    (state: any) => state.organization.selectedOrganization
  );
  const organizations = useSelector((state: any) => state.user.myOrganizations);
  const [searchTerm, setSearchTerm] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  const { loading } = useAuth();

  const [modalPosition, setModalPosition] = useState<{
    top: number;
    left: number;
    width: number;
  }>({
    top: 0,
    left: 0,
    width: 300,
  });

  const [filteredOrganizations, setFilteredOrganizations] =
    useState<ProfileOrganization[]>(organizations);

  useEffect(() => {
    setFilteredOrganizations(
      organizations.filter((org: ProfileOrganization) =>
        org.name.toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
  }, [searchTerm, organizations]);

  const handleSelect = (organization: ProfileOrganization) => {
    dispatch(setSelectedOrganization(organization));
    onClose();
  };

  useEffect(() => {
    if (!triggerRef.current) return;

    /*
      Anchored to the button that opens it, in both layouts.

      It used to be placed at `left: rect.right + 20` on desktop — beside the
      sidebar, level with the trigger's top — which reads as a floating panel
      belonging to nothing, and on a narrow window it landed over the middle of
      the rail. On mobile it was centred on the screen, equally detached. A
      picker sits under the control it belongs to; the only extra work is
      keeping it inside the viewport.
    */
    const rect = triggerRef.current.getBoundingClientRect();
    const GAP = 8;
    const MARGIN = 12;
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - MARGIN * 2);
    const height = modalRef.current?.offsetHeight ?? 0;

    let left = rect.left;
    if (left + width > window.innerWidth - MARGIN) left = window.innerWidth - MARGIN - width;
    if (left < MARGIN) left = MARGIN;

    // Below the trigger, unless that would run off the bottom.
    let top = rect.bottom + GAP;
    if (height && top + height > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, rect.top - GAP - height);
    }

    setModalPosition({ top, left, width });
  }, [triggerRef]);

  return (
    <>
      {}
      <div
        className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-50"
        onClick={onClose}
      ></div>

      {}
      <motion.div
        ref={modalRef}
        style={{
          top: modalPosition.top,
          left: modalPosition.left,
          width: modalPosition.width,
        }}
        className={dark ? DARK_PANEL : DEFAULT_PANEL}
        initial={dark ? { y: -4 } : { opacity: 0, x: 50 }}
        animate={dark ? { y: 0 } : { opacity: 1, x: 0 }}
        exit={dark ? { y: -4 } : { opacity: 0, x: 50 }}
        transition={dark ? { duration: 0.12, ease: 'easeOut' } : undefined}
      >
        {}
        <div className={dark ? "p-2" : "p-4 appsec:p-2"}>
          <h2 className={dark ? "px-1 pb-2 pt-0.5 text-[11px] font-medium text-zinc-400" : "text-gray-500 mb-2 appsec:px-1 appsec:text-xs appsec:font-medium appsec:text-zinc-500 appsec-dark:text-zinc-400"}>{t('components.modal.organizationSelector.title')}</h2>

          <SearchBox onSearch={setSearchTerm} withDropdown={false} />

          <div className={dark ? "mt-2 max-h-48 overflow-y-auto custom-scrollbar" : "mt-4 max-h-48 overflow-y-auto custom-scrollbar appsec:mt-2"}>
            {loading ? (
              
              <Skeleton key={`skeleton-org-1`} type="text" width="90%" />
            ) : filteredOrganizations.length === 0 ? (
              <div className="text-center text-gray-500 dark:text-gray-400 appsec:py-2 appsec:text-[13px] appsec:text-zinc-500 appsec-dark:text-zinc-400">
                {t('components.modal.organizationSelector.noOrganizations')}
              </div>
            ) : (
              filteredOrganizations.map((organization) => (
                dark ? (
                  <div
                    key={organization.id}
                    data-org-row=""
                    className={DARK_ROW}
                    onClick={() => handleSelect(organization)}
                  >
                    <span className="min-w-0 truncate">{organization.name}</span>
                    {selectedOrganization?.id === organization.id && (
                      <Check className="h-3 w-3 shrink-0 text-zinc-100" />
                    )}
                  </div>
                ) : (
                <div
                  key={organization.id}
                  className={selectedOrganization?.id === organization.id ? `${DEFAULT_ROW} ${DEFAULT_ROW_CURRENT}` : DEFAULT_ROW}
                  onClick={() => handleSelect(organization)}
                >
                  <span className="text-sm text-black dark:text-gray-300 appsec:min-w-0 appsec:truncate appsec:text-[13px] appsec:text-zinc-700 appsec-dark:text-zinc-300">
                    {organization.name}
                  </span>
                  {/* The current organisation. The Brain's check; in AppSec the
                      row draws the dot itself (above), so the check is hidden. */}
                  {selectedOrganization?.id === organization.id && (
                    <Check
                      className="h-5 w-5 text-secondary appsec:hidden"
                     />
                  )}
                </div>
                )
              ))
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
};

export default OrganizationSelectorModal;

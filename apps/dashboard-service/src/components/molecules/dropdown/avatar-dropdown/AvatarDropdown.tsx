import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Avatar from "../../../atoms/avatar/Avatar";
import DropdownHeader from "../../../atoms/dropdown-header/DropdownHeader";
import DropdownItem from "../../../atoms/dropdown-item/DropdownItem";
import useLogout from "../../../../server/hooks/useLogout";
import { SignOutAlt, User } from '@/components/atoms/icon/icons';
import AccountAvatar from "@/components/molecules/kit/account/AccountAvatar";
import { spaceOf, type Product } from "@/utils/product";
import { AS_FLOATING, AS_FOCUS, AS_TOUCH_SQUARE } from "@/components/atoms/appsec/styles";

/** The AppSec trigger: 32 px, a zinc ring on hover, the violet ring on keyboard focus only. */
const APPSEC_TRIGGER = `relative size-8 inline-flex justify-center items-center rounded-full transition-shadow duration-[120ms] hover:ring-2 hover:ring-zinc-200 dark:hover:ring-white/[0.12] ${AS_FOCUS} ${AS_TOUCH_SQUARE}`;

interface AvatarDropdownProps {
  avatarSrc: string;
  avatarAlt: string;
  email: string;
  /**
   * The space the menu is shown in. Without it (AppSec) the menu is the one it
   * always was. A space with its own rows (`ProductSpace.AccountMenuRows`): a
   * plain popover holding them, Logout last, whose only
   * image is the avatar, and the trigger without the accent.
   */
  product?: Product;
  /** The account's name, for a space's own menu. Defaults to `avatarAlt`. */
  name?: string;
}

/** A space's own menu: white or #0c0c0e, a hairline, 8 px radius, a shadow only in light. */
const SPACE_MENU =
  "absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-[0_1px_2px_rgb(0_0_0/0.04)] dark:border-white/[0.07] dark:bg-[#0c0c0e] dark:shadow-none";

const AvatarDropdown: React.FC<AvatarDropdownProps> = ({
  avatarSrc,
  email,
  avatarAlt,
  product = 'appsec',
  name,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const logout = useLogout();
  const { t } = useTranslation();
  const SpaceMenuRows = spaceOf(product).AccountMenuRows;
  const isSpaceMenu = Boolean(SpaceMenuRows);

  const toggleDropdown = () => {
    setIsOpen((prev) => !prev);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // A space's own menu: Escape closes it and gives the focus back to the trigger.
  useEffect(() => {
    if (!isSpaceMenu || !isOpen) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isSpaceMenu, isOpen]);

  return (
    <div className="relative inline-flex" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggleDropdown}
        aria-label={t('navigation.accountMenu')}
        className={isSpaceMenu ? "size-[38px] inline-flex justify-center items-center rounded-full transition-shadow duration-[120ms] hover:ring-2 hover:ring-zinc-200 dark:hover:ring-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:focus-visible:ring-zinc-500" : APPSEC_TRIGGER}
        aria-haspopup="menu"
        aria-expanded={isOpen ? "true" : "false"}
      >
        {isSpaceMenu ? (
          <AccountAvatar src={avatarSrc} name={name ?? avatarAlt} />
        ) : (
          <Avatar src={avatarSrc} alt={avatarAlt} size="size-8" />
        )}
      </button>

      {/* Dropdown menu */}
      {SpaceMenuRows ? (
        <div className={`${isOpen ? "block" : "hidden"} ${SPACE_MENU}`}>
          <SpaceMenuRows
            name={name ?? avatarAlt}
            email={email}
            avatarSrc={avatarSrc}
            onClose={() => setIsOpen(false)}
            onLogout={() => {
              logout();
              setIsOpen(false);
            }}
          />
        </div>
      ) : (
      <div
        /*
          No entrance animation at all.
          A menu that fades or scales in is see-through or undersized for the
          length of the transition, and the page shows through it — which is
          what made this one unreadable. Worse, the transition is driven by
          requestAnimationFrame, which the browser suspends while the tab is in
          the background: open the menu on a restored tab and it can stay stuck
          part-way. It is either on screen, fully opaque, or not there.
        */
        className={`${isOpen ? "block" : "hidden"} absolute right-0 top-full mt-2 min-w-60 z-50 overflow-hidden ${AS_FLOATING}`}
      >
        <DropdownHeader email={email} />
        <div className="p-1">
          <DropdownItem
            icon={User}
            label={t('navigation.myAccount')}
            href="/profile"
            onClick={() => {
              setIsOpen(false);
            }}
          />
          <DropdownItem
            icon={SignOutAlt}
            label={t('common.logout')}
            onClick={() => {
              logout();
              setIsOpen(false);
            }}
          />
        </div>
      </div>
      )}
    </div>
  );
};

export default AvatarDropdown;

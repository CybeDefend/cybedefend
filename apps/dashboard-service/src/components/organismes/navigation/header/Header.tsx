import React, { useEffect, useRef, useState, useCallback } from "react";
import { useSelector } from "react-redux";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/function/utils";
import { RootState } from "../../../../server/store";
import LanguageSwitcherSelect from "../../../atoms/select/LanguageSwitcherSelect";
import { SidebarToggleButton } from "../../../atoms/sidebar-toogle-button/SidebarToggleButton";
import { Breadcrumbs } from "../../../molecules/breadcrumbs/Breadcrumbs";
import AvatarDropdown from "../../../molecules/dropdown/avatar-dropdown/AvatarDropdown";
import { SidebarContent } from "../../../molecules/sidebar/sidebar-content/SidebarContent";
import { BackgroundTasksHeaderButton } from "../../background-tasks/BackgroundTasksHeaderButton";
import { Slot } from "@/edition/slots";
import { spaceOf, type Product } from "@/utils/product";

interface HeaderProps {
  currentPath: string;
  /**
   * The space of the page, from Layout. The header has no router hook of its
   * own (its tests render it without a router), so it is told, and tells the
   * registrations of its `app.header.actions` slot. Without it (AppSec) the
   * header is the one it always was. A space of the zinc skin: the page's colour, a hairline and a blur only once the page scrolls
   * under it, a 13 px trail, the space's own actions first, the drawer flat
   * near-black.
   */
  product?: Product;
}

const Header: React.FC<HeaderProps> = ({ currentPath, product = "appsec" }) => {
  const { t } = useTranslation();
  const isZinc = spaceOf(product).skin === "zinc";
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
  }, []);

  const user = useSelector((state: RootState) => state.user);

  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target as Node)
      ) {
        closeSidebar();
      }
    };

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSidebar();
      }
    };

    if (isSidebarOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscapeKey);
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscapeKey);
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    };
  }, [isSidebarOpen, closeSidebar]);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 inset-x-0 z-[40] w-full",
          "flex flex-wrap md:justify-start md:flex-nowrap",
          // AppSec: 56 px, the surface colour, a hairline that waits for the
          // page to scroll under it (no shadow).
          isZinc ? "text-sm py-2.5 md:py-3 lg:pl-64" : "text-sm h-14 lg:pl-56",
          isZinc ? "bg-[#fafafa] dark:bg-[#09090b]" : "bg-white dark:bg-as-surface border-b border-transparent",
          isZinc ? "transition-colors duration-150 ease-out" : "transition-[border-color,background-color] duration-[120ms]",
          isScrolled && (isZinc
            ? [
              "border-b border-zinc-200 dark:border-white/[0.07]",
              "backdrop-blur-md bg-[#fafafa]/80 dark:bg-[#09090b]/80",
            ]
            : [
            "border-zinc-200 dark:border-as-line",
            "bg-white/90 dark:bg-as-surface/90 backdrop-blur-md",
          ])
        )}
      >
        <nav className="px-4 sm:px-6 lg:px-8 flex basis-full items-center w-full mx-auto">
          {/* Mobile Navigation. It takes what the actions leave and no more:
              sized by its trail, it widened a project page to 1153 px at 1024
              and pushed the language selector and the avatar off the screen. */}
          <div className="lg:hidden min-w-0 flex-1">
            <div className={cn("flex min-w-0 items-center gap-2", isZinc && "py-2")}>
              <SidebarToggleButton
                onClick={toggleSidebar}
                isOpen={isSidebarOpen}
                ariaControls="hs-application-sidebar"
              />
              {/* 12 px of padding cancelled by the margin: the trail stays where
                  it is, and what it clips is 44 px tall, so the crumbs' touch
                  reach is not cut. */}
              <div className={cn("min-w-0 truncate", !isZinc && "-my-3 py-3")}>
                <Breadcrumbs />
              </div>
            </div>
          </div>

          {/* Desktop Breadcrumbs. Out of the row below lg: empty there, its
              full width would leave nothing to the mobile trail. */}
          <div className="w-full min-w-0 hidden lg:flex items-center justify-end ms-auto md:justify-between gap-x-2 md:gap-x-4">
            <div className="hidden lg:block flex-1 min-w-0">
              <div className={isZinc ? "text-[13px] text-zinc-900 dark:text-zinc-100" : "text-zinc-900 dark:text-zinc-100 text-sm font-medium"}>
                <Breadcrumbs />
              </div>
            </div>
          </div>

          {/* Header Actions */}
          <div className={cn("flex items-center flex-shrink-0", isZinc ? "gap-3 md:gap-4 ml-4 md:ml-6" : "gap-2 ml-3 md:ml-4")}>
            {/* What the closed spaces add first among the actions (a view
                switch). Each gates itself on the space it is shown in. */}
            <Slot name="app.header.actions" context={{ product }} />

            {/* Background-tasks indicator — locked at the top of the page so it
                no longer floats over the project header. */}
            <BackgroundTasksHeaderButton />

            <div className="hidden md:block">
              <LanguageSwitcherSelect />
            </div>

            <div
              className={cn(
                isZinc
                  ? [
                    "flex-none rounded-2xl text-xl inline-block",
                    "transition-all duration-200 ease-in-out",
                    "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2",
                    "dark:focus:ring-offset-neutral-900",
                  ]
                  : [
                    "flex-none rounded-full inline-block",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2",
                    "focus-visible:ring-offset-white dark:focus-visible:ring-offset-as-surface",
                    // No fade on hover: the open menu sits inside this wrapper and went
                    // see-through (its words under 4.5:1). The trigger draws its own hover ring.
                  ]
              )}
              aria-label={t("components.appShell.userMenu")}
            >
              <AvatarDropdown
                avatarSrc={user.picture}
                avatarAlt={`${user.firstName} ${user.lastName}`}
                email={user.email}
                product={product}
                name={isZinc ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() : undefined}
              />
            </div>
          </div>
        </nav>
      </header>

      {/* Mobile Sidebar */}
      <div
        ref={sidebarRef}
        id="hs-application-sidebar"
        // Dark in both themes: the accent takes its dark-surface shade here (src/index.css).
        data-surface="dark"
        className={cn(
          "fixed inset-y-0 start-0 w-[280px] sm:w-[300px]",
          isZinc ? "bg-[#0a0a0b] text-alternative" : "bg-[#060608] text-alternative dark:bg-as-surface",
          "transform transition-transform duration-300 ease-in-out",
          isZinc ? "z-[70] h-screen overflow-hidden" : "z-[70] h-[100dvh] overflow-hidden",
          "rounded-r-xl",
          // The zinc skin: the rail inside draws its own hairline at its edge.
          !isZinc && "border-r border-white/[0.08]",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full",
          // AppSec: the shadow only while open, or it bleeds past the left edge of the page.
          !isZinc && isSidebarOpen && "shadow-[16px_0_48px_-12px_rgb(0_0_0/0.6)]",
          "lg:hidden"
        )}
        role="dialog"
        tabIndex={-1}
        aria-label={t("components.appShell.sidebar")}
        aria-hidden={!isSidebarOpen}
      >
        <SidebarContent />
      </div>

      {/* Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className={cn(
            "fixed inset-0 lg:hidden z-[65]",
            "bg-black/60 backdrop-blur-sm",
            "transition-opacity duration-300 ease-in-out",
            "animate-in fade-in"
          )}
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}
    </>
  );
};

export default Header;

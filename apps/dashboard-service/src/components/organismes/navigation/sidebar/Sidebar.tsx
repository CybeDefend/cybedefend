import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import OrganizationSelectorModal from "../../../molecules/modal/organization-selector-modal/OrganizationSelectorModal";
import { SidebarContent } from "../../../molecules/sidebar/sidebar-content/SidebarContent";

const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleCloseModal = () => setIsModalOpen(false);

  return (
    <>
      <div
        id="hs-application-sidebar"
        // Dark in both themes: the accent takes its dark-surface shade here (src/index.css).
        data-surface="dark"
        className="h-min-screen -translate-x-full transition-all duration-300 transform w-[260px] lg:w-56 h-full fixed inset-y-0 left-0 z-[40] flex flex-col border-r border-white/[0.08] bg-[#060608] dark:bg-as-surface text-alternative lg:block lg:translate-x-0 lg:right-auto lg:bottom-0"
        role="dialog"
        tabIndex={-1}
        aria-label={t("components.appShell.sidebar")}
      >
        <SidebarContent />
      </div>

      { }
      {isModalOpen && window.innerWidth >= 768 && (
        <OrganizationSelectorModal
          onClose={handleCloseModal}
          triggerRef={React.createRef<HTMLButtonElement>()}
        />
      )}
    </>
  );
};

export default Sidebar;

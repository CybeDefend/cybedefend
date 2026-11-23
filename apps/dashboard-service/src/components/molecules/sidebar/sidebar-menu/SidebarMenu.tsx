import React from "react";
import Button from "../../../atoms/button/Button";
import NotFoundElement from "../../not-found-element/NotFoundElement";
import { useTranslation } from "react-i18next";
import { cn } from "@/utils/function/utils";
import { AS_MENU_CURRENT, AS_MENU_IDLE } from "@/components/atoms/appsec/recipes";

interface SidebarMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface SidebarMenuProps {
  items: SidebarMenuItem[];
  selectedItemId: string;
  onChange: (id: string) => void;
  alignment?: "left" | "right"; 
}

const SidebarMenu: React.FC<SidebarMenuProps> = ({
  items,
  selectedItemId,
  onChange,
  alignment = "left",
}) => {
  const { t } = useTranslation();
  const alignmentClass = alignment === "left" ? "justify-start" : "justify-end";

  return (
    <ul className="space-y-1 px-2">
      {items.length > 0 ? (
        items.map((item) => (
          <li key={item.id}>
            {/* The icon goes through the atom's `icon` prop rather than being
                a child: passed as a child it landed inside the label's own
                wrapper, so the active item's icon sat above its text while
                every inactive one lined up. */}
            {/* The current item is a zinc wash with a 2 px violet marker on
                the left (the zinc kit's selected row), never a solid fill:
                the fill made it the loudest element of the page. */}
            <Button
              variant="ghost"
              onClick={() => onChange(item.id)}
              fullWidth
              className={cn(alignmentClass, selectedItemId === item.id ? AS_MENU_CURRENT : AS_MENU_IDLE)}
              icon={item.icon}
              iconPosition={alignment === "right" ? "right" : "left"}
            >
              <span className="truncate">{item.label}</span>
            </Button>
          </li>
        ))
      ) : (
        <div className="text-[13px] text-zinc-500 dark:text-zinc-400 mt-4 px-4">
          <NotFoundElement
            title={t('components.sidebar.menu.noTeamsFound')}
            description={t('components.sidebar.menu.noTeamsDescription')}
          />
        </div>
      )}
    </ul>
  );
};

export default SidebarMenu;

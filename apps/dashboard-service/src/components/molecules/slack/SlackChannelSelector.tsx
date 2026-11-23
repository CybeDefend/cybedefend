import React, { useState, useEffect, useRef } from "react";
import { Lock as LockIcon } from '@/components/atoms/icon/icons';
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { RootState } from "@/server/store";
import {
  listSlackChannels,
  setProjectSlackChannel,
  removeProjectSlackChannel,
  SlackChannel,
} from "@/server/services/integrations/slackIntegrationsService";

import { AS_FOCUS, AS_TOUCH, AS_TOUCH_SQUARE, AS_FLOATING, AS_MENU_ITEM } from '@/components/atoms/appsec/styles';
import { cn } from '@/utils/function/utils';
interface SlackChannelSelectorProps {
  projectId: string;
  currentChannelName: string;
  onChannelChange: (channelName: string) => void;
}

const SlackChannelSelector: React.FC<SlackChannelSelectorProps> = ({
  projectId,
  currentChannelName,
  onChannelChange,
}) => {
  const { t } = useTranslation();
  const organization = useSelector(
    (state: RootState) => state.organization
  );
  const organizationId = organization.selectedOrganization?.id || "";

  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleOpen = async () => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    setIsOpen(true);
    setIsLoading(true);
    try {
      const data = await listSlackChannels(organizationId);
      setChannels(data);
    } catch {
      toast.error(t("components.notificationsSettings.channelLoadError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = async (channel: SlackChannel) => {
    try {
      await setProjectSlackChannel(organizationId, projectId, channel.channelId, channel.name);
      onChannelChange(channel.name);
      setIsOpen(false);
    } catch {
      toast.error(t("components.notificationsSettings.channelUpdateError"));
    }
  };

  const handleRemove = async () => {
    try {
      await removeProjectSlackChannel(organizationId, projectId);
      onChannelChange("");
    } catch {
      toast.error(t("components.notificationsSettings.channelUpdateError"));
    }
  };

  const filteredChannels = channels.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleOpen}
          className={cn("relative inline-flex h-8 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-[13px] font-medium text-zinc-800 transition-colors duration-[120ms] hover:border-zinc-300 dark:border-as-line-strong dark:bg-as-raised dark:text-zinc-100 dark:hover:border-white/[0.2]", AS_FOCUS, AS_TOUCH)}
        >
          <img src="/image/integrations/slack.png" alt="Slack" className="w-4 h-4" />
          <span>
            {currentChannelName
              ? `#${currentChannelName}`
              : t("components.notificationsSettings.selectChannel")}
          </span>
          <svg className="w-4 h-4 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {currentChannelName && (
          <button
            type="button"
            onClick={handleRemove}
            className={cn("relative inline-flex h-6 w-6 items-center justify-center rounded-md text-sm text-zinc-400 transition-colors duration-[120ms] hover:bg-zinc-100 hover:text-red-500 dark:text-zinc-500 dark:hover:bg-white/[0.06]", AS_FOCUS, AS_TOUCH_SQUARE)}
          >
            &times;
          </button>
        )}
      </div>

      {isOpen && (
        <div className={cn(AS_FLOATING, "absolute z-50 mt-1 w-64 p-1")}>
          <div className="pb-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("components.notificationsSettings.searchChannels")}
              className="w-full h-8 px-2.5 text-[13px] max-md:text-base border border-zinc-200 dark:border-as-line-strong rounded-md bg-white dark:bg-as-surface text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-secondary/60"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {isLoading ? (
              <div className="px-3 py-4 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                {t("common.loading")}
              </div>
            ) : filteredChannels.length === 0 ? (
              <div className="px-3 py-4 text-center text-[13px] text-zinc-500 dark:text-zinc-400">
                {t("common.noResults")}
              </div>
            ) : (
              filteredChannels.map((channel) => (
                <button
                  key={channel.channelId}
                  type="button"
                  onClick={() => handleSelect(channel)}
                  className={cn(AS_MENU_ITEM, "text-left",
                    channel.name === currentChannelName
                      && "bg-zinc-100 dark:bg-white/[0.06] font-medium text-zinc-900 dark:text-zinc-50"
                  )}
                >
                  <span className="truncate">
                    #{channel.name}
                  </span>
                  {channel.isPrivate && (
                    <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                      <LockIcon className="h-3.5 w-3.5 inline-block" />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SlackChannelSelector;

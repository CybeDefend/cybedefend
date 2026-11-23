import React from "react";
import { AS_CHIP } from "@/components/atoms/appsec/styles";
import { cn } from "@/utils/function/utils";
import type { TicketProvider } from "@/server/hooks/useIssueTracking";

/** Each ticket tool's name (a brand, the same in every language) and logo. */
export const TICKET_PROVIDER_BRAND: Record<TicketProvider, { name: string; logo: string }> = {
  jira: { name: "Jira", logo: "/image/integrations/jira.png" },
  linear: { name: "Linear", logo: "/image/integrations/linear.svg" },
};

const TONE: Record<TicketProvider, string> = {
  jira: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300",
  linear: "bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300",
};

interface TicketBadgeProps {
  provider: TicketProvider;
  ticketKey: string;
  /** Opens the ticket in a new tab. Leave it out inside an element that is already a link. */
  url?: string;
}

/** A ticket's key behind its tool's logo. */
const TicketBadge: React.FC<TicketBadgeProps> = ({ provider, ticketKey, url }) => {
  const { name, logo } = TICKET_PROVIDER_BRAND[provider];
  const badge = (
    <span className={cn(AS_CHIP, TONE[provider])} title={ticketKey}>
      <img src={logo} alt={name} className="h-4 w-4" />
      <span>{ticketKey}</span>
    </span>
  );

  if (!url) return badge;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="transition-opacity hover:opacity-80"
      onClick={(e) => e.stopPropagation()}
    >
      {badge}
    </a>
  );
};

export default TicketBadge;

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import SafeMarkdown from '@/components/atoms/safe-markdown/SafeMarkdown';
import { ChevronDown, ChevronUp, MessageCircle, RefreshCw, MessageSquare, Pin } from '@/components/atoms/icon/icons';
import { CybeAvatar } from '@/components/atoms/cybe-avatar/CybeAvatar';
import ExploitabilityBadge from '@/components/atoms/badge/ExploitabilityBadge';
import {
  parseExploitabilityVerdict,
  type ParsedExploitabilityVerdict,
} from '@/utils/function/exploitabilityVerdictParser';
import { statusOptions, priorityOptions } from "../../../../utils/data/historyVulnData";
import { AS_CHIP, AS_SECTION_TITLE } from '@/components/atoms/appsec/styles';

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  picture: string;
}

interface HistoryItem {
  id: string;
  date: string;
  value: string;
  user: User | null;
  // The backend returns a "type" field (e.g. 'comment', 'status_change', 'priority_change')
  // Optional, for backward compatibility when it is absent.
  type?: string;
}

interface HistoryTimelineProps {
  historyItems: HistoryItem[];
}

const HistoryTimeline: React.FC<HistoryTimelineProps> = ({ historyItems }) => {
  const [showAll, setShowAll] = useState(false);
  const { t } = useTranslation();

  // Sanitize and normalise markdown written by agents:
  //  - remove <think> blocks
  //  - unwrap any ```markdown ... ``` block holding several headings (whole documents)
  //  - unwrap code blocks that actually hold formatted markdown
  //  - normalise ```markdown fences to ```
  //  - balance an odd number of fences by closing the last one at the end
  const sanitizeCommentValue = (raw: string): string => {
    if (!raw) return '';
    let v = raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
    v = v.replace(/\r\n?/g, '\n');

    // Detect whether a text holds formatted markdown (bold, italic, headers, etc.)
    const containsMarkdownFormatting = (text: string): boolean => {
      // Patterns that indicate formatted markdown
      const markdownPatterns = [
        /\*\*[^*]+\*\*/,           // **bold**
        /\*[^*]+\*/,               // *italic*
        /__[^_]+__/,               // __bold__
        /_[^_]+_/,                 // _italic_
        /^#{1,6}\s+/m,             // # headers
        /^\s*[-*+]\s+/m,           // - list items
        /^\s*\d+\.\s+/m,           // 1. numbered lists
        /\[.+\]\(.+\)/,            // [links](url)
        /`[^`]+`/,                 // inline `code`
      ];
      return markdownPatterns.some(pattern => pattern.test(text));
    };

    // Unwrap code blocks that actually hold markdown (not real code)
    const unwrapMarkdownInCodeBlocks = (text: string): string => {
      // Match code blocks (with or without language specifier)
      return text.replace(/```(?:\w*)?\s*\n([\s\S]*?)\n```/gi, (match, inner) => {
        const trimmedInner = inner.trim();

        // If the block holds formatted markdown and no real code patterns
        // (function declarations, imports, etc.)
        const hasMarkdown = containsMarkdownFormatting(trimmedInner);
        const looksLikeCode = /^(import |export |const |let |var |function |class |def |public |private |from |require\()/m.test(trimmedInner)
          || /[{}();]/.test(trimmedInner.split('\n')[0] || ''); // the first line looks like code

        // Clearly markdown and not code: unwrap
        if (hasMarkdown && !looksLikeCode) {
          return trimmedInner;
        }

        return match; // keep the original code block
      });
    };

    // Unwrap every fence holding several headings: a document, not code.
    const unwrapFence = (text: string): string => {
      return text.replace(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/gi, (m, inner) => {
        const headingCount = (inner.match(/^#{1,6}\s+/gm) || []).length;
        const innerFenceCount = (inner.match(/(^|\n)\s*```/g) || []).length;
        if (headingCount >= 2 && innerFenceCount < 6) {
          return inner.trim();
        }
        return m;
      });
    };

    v = unwrapMarkdownInCodeBlocks(v);
    v = unwrapFence(v);
    v = v.replace(/```\s*(markdown|md)(?=\s|\n)/gi, '```');

    if (v.startsWith('```') && !v.includes('\n```')) {
      v = v.replace(/^```\w*\s*\n?/, '');
    }

    v = v.trim();

    const fenceMatches = v.match(/(^|\n)\s*```/g) || [];
    const fenceCount = fenceMatches.length;
    if (fenceCount % 2 === 1) {
      const lastFenceIndex = v.lastIndexOf('```');
      const contentAfterLastFence = v.substring(lastFenceIndex + 3).trim();

      if (contentAfterLastFence.length > 50 && containsMarkdownFormatting(contentAfterLastFence)) {
        v = v.substring(0, lastFenceIndex) + contentAfterLastFence;
      } else {
        v += '\n```';
      }
    }

    return v;
  };

  if (historyItems.length === 0) {
    return null;
  }

  /**
   * Determines the item's type and its display label.
   * IMPORTANT: the "type" field returned by the API comes first,
   * to avoid false positives (e.g. a priority word in a Markdown comment).
   */
  const getTypeAndLabel = (item: HistoryItem) => {
    const rawValue = item.value || "";
    const lowered = rawValue.toLowerCase();

    // 1. When the API gives the type, use it directly
    if (item.type) {
      switch (item.type) {
        case 'status_change': {
          const statusMatch = statusOptions.find(o => o.value.toLowerCase() === lowered);
          return statusMatch
            ? { type: 'status', ...statusMatch }
            : { type: 'status', value: rawValue, label: rawValue };
        }
        case 'priority_change': {
          const priorityMatch = priorityOptions.find(o => o.value.toLowerCase() === lowered);
          return priorityMatch
            ? { type: 'priority', ...priorityMatch }
            : { type: 'priority', value: rawValue, label: rawValue };
        }
        case 'comment':
        default:
          return {
            type: 'comment',
            value: 'comment',
            label: 'COMMENT',
            color: 'text-zinc-400 dark:text-zinc-400',
          };
      }
    }

    // 2. Backward compatibility: without a type, try to infer it.
    const statusMatch = statusOptions.find((option) => lowered === option.value.toLowerCase());
    if (statusMatch) {
      return { type: 'status', ...statusMatch };
    }
    const priorityMatch = priorityOptions.find((option) => lowered === option.value.toLowerCase());
    if (priorityMatch) {
      return { type: 'priority', ...priorityMatch };
    }
    return {
      type: 'comment',
      value: 'comment',
      label: 'COMMENT',
      color: 'text-zinc-400 dark:text-zinc-400',
    };
  };

  const sortedHistoryItems = historyItems.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const isSystemAgent = (user: User | null) => {
    return user?.firstName === "Cybe" && user?.lastName === "Agent";
  };

  // Separate the system agent's comments from the others BEFORE the limit
  const systemAgentComments = sortedHistoryItems.filter(item => {
    const { type } = getTypeAndLabel(item);
    return type === 'comment' && isSystemAgent(item.user);
  });

  const regularHistoryItems = sortedHistoryItems.filter(item => {
    const { type } = getTypeAndLabel(item);
    return !(type === 'comment' && isSystemAgent(item.user));
  });

  // Apply the limit to the regular items only
  const itemsToShow = showAll
    ? regularHistoryItems
    : regularHistoryItems.slice(0, 3);

  // Custom markdown components for a better rendering
  const markdownComponents = {
    p: ({ children }: any) => <p className="mb-1 last:mb-0 leading-snug whitespace-normal">{children}</p>,
    strong: ({ children }: any) => <strong className="font-semibold text-primary dark:text-zinc-50">{children}</strong>,
    h1: ({ children }: any) => <h1 className="text-base font-semibold mt-3 mb-1 text-primary dark:text-zinc-50">{children}</h1>,
    h2: ({ children }: any) => <h2 className="text-sm font-semibold mt-3 mb-1 text-primary dark:text-zinc-50">{children}</h2>,
    h3: ({ children }: any) => <h3 className="text-xs font-semibold mt-2 mb-1 text-primary dark:text-zinc-50">{children}</h3>,
    ul: ({ children }: any) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
    ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
    li: ({ children }: any) => <li className="m-0 leading-snug">{children}</li>,
    // Readability: stronger contrast for code (inline and blocks)
    code: ({ children }: any) => (
      <code className="bg-zinc-100 dark:bg-as-raised border border-zinc-200 dark:border-as-line px-1.5 py-0.5 rounded text-[11px] font-mono text-zinc-800 dark:text-zinc-100 leading-snug break-words whitespace-pre-wrap">
        {children}
      </code>
    ),
    pre: ({ children }: any) => (
      <pre className="relative group bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-as-line p-3 rounded-md text-[12px] font-mono overflow-auto whitespace-pre leading-snug text-zinc-800 dark:text-zinc-100">
        {children}
      </pre>
    ),
  };

  const VerdictSummary: React.FC<{ parsed: ParsedExploitabilityVerdict }> = ({ parsed }) => {
    const scorePct = Math.round(parsed.score * 100);
    return (
      <div className="flex flex-col gap-3" data-testid="verdict-summary">
        <p className="text-sm font-semibold text-primary dark:text-zinc-50">
          {t('components.historyTimeline.verdict.headline')}
        </p>

        <div>
          <ExploitabilityBadge verdict={parsed.verdict} size="md" />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
            {/* This bar shows parsed.score — the exploitability score the
                backend derives deterministically from the qualitative verdict
                ("proven" -> 0.75). It is NOT the agent's confidence in that
                verdict, which is a separate number (0.97 on the finding that
                surfaced the confusion). Labelling it "Confidence" made the
                card understate a verdict the agent held far more firmly. */}
            <span>{t('components.historyTimeline.verdict.exploitabilityScoreLabel')}</span>
            <span className="font-medium">
              {t('components.historyTimeline.verdict.exploitabilityScorePct', { pct: scorePct })}
            </span>
          </div>
          <div className="h-1.5 w-full bg-zinc-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-secondary dark:bg-secondary-light rounded-full transition-all"
              style={{ width: `${scorePct}%` }}
              role="progressbar"
              aria-valuenow={scorePct}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>

        <p className="text-sm italic text-zinc-700 dark:text-zinc-300">
          {t(`components.historyTimeline.verdict.description.${parsed.verdict}`)}
        </p>
      </div>
    );
  };

  // Component for the system agent's pinned messages
  const SystemAgentMessage: React.FC<{ item: HistoryItem }> = ({ item }) => {
    const parsedVerdict = parseExploitabilityVerdict(item.value);

    return (
      <div className="mb-6 relative">
        <div className="bg-gradient-to-r from-secondary/5 to-secondary-light/5 dark:from-secondary/10 dark:to-secondary-light/10 p-4 rounded-xl border border-secondary/15 border-l-2 border-l-secondary dark:border-secondary-light/15 dark:border-l-secondary-light">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <CybeAvatar size="md" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Pin className="w-4 h-4 text-secondary dark:text-secondary-light" />
                <p className="text-sm font-semibold text-primary dark:text-zinc-50">
                  {t('components.historyTimeline.aiAnalysisLabel')}
                </p>
                <span className={`${AS_CHIP} text-secondary dark:text-secondary-light bg-secondary/10 dark:bg-secondary/20`}>
                  {t('components.historyTimeline.pinnedLabel')}
                </span>
              </div>
              <time className="text-xs text-secondary dark:text-secondary-light mb-3 block">
                {new Date(item.date).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              {parsedVerdict ? (
                <VerdictSummary parsed={parsedVerdict} />
              ) : (
                <SafeMarkdown
                  content={sanitizeCommentValue(item.value)}
                  components={markdownComponents}
                  className="prose dark:prose-invert max-w-none text-sm text-primary dark:text-zinc-100 overflow-visible break-words whitespace-normal"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-2 mb-6">
        <MessageCircle className="w-4 h-4 text-secondary dark:text-secondary-light" />
        <h2 className={AS_SECTION_TITLE}>
          {t('components.historyTimeline.title')}
        </h2>
        <span className={`ml-2 ${AS_CHIP} font-mono tabular-nums bg-zinc-100 dark:bg-white/[0.06] text-zinc-600 dark:text-zinc-300`}>
          {regularHistoryItems.length + systemAgentComments.length}
        </span>
      </div>

      {/* The system agent's pinned messages */}
      {systemAgentComments.length > 0 && (
        <div className="mb-8">
          {systemAgentComments.map((item) => (
            <SystemAgentMessage key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Timeline of the other items */}
      {itemsToShow.length > 0 && (
        <div className="relative overflow-visible custom-scrollbar overflow-y-auto">
          <div className="border-l border-zinc-200 dark:border-as-line ml-6">
            {itemsToShow.map((item, index) => {
              const { type, label } = getTypeAndLabel(item);

              if (type === "comment") {
                return (
                  <div key={item.id} className="mb-8 ml-6 relative">
                    {/* The newest entry keeps its glyph on the line; the others need no dot (no decorative dots, one accent per region). */}
                    {index === 0 && (
                      <div className="absolute -left-[33px] top-[50%] -translate-y-[50%]">
                        <div className="p-1 rounded-full bg-white dark:bg-as-bg ring-1 ring-zinc-200 dark:ring-as-line">
                          <RefreshCw className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                        </div>
                      </div>
                    )}

                    <div className="p-3 sm:p-4 rounded-xl bg-white dark:bg-as-surface border border-zinc-200 dark:border-as-line dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.045)]">
                      <div className="flex justify-between items-start">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-secondary/10 dark:bg-secondary/20 flex items-center justify-center">
                              <span className="text-xs font-semibold text-secondary dark:text-secondary-light">
                                {item.user
                                  ? `${item.user.firstName[0]}`
                                  : "SY"}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                              {item.user
                                ? `${item.user.firstName} ${item.user.lastName}`
                                : "System"}
                            </p>
                          </div>
                          <time className="text-xs text-zinc-500 dark:text-zinc-400">
                            {new Date(item.date).toLocaleDateString("fr-FR", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                        </div>
                        <MessageSquare className="w-4 h-4 mt-1 text-zinc-400 dark:text-zinc-500 shrink-0" />
                      </div>
                      <SafeMarkdown
                        content={sanitizeCommentValue(item.value)}
                        components={markdownComponents}
                        className="prose dark:prose-invert max-w-none text-sm mt-2 text-zinc-700 dark:text-zinc-300 break-words overflow-visible whitespace-normal leading-snug"
                      />
                    </div>
                  </div>
                );
              }

              return (
                <div key={item.id} className="mb-6 ml-6 relative">
                  <div className="bg-zinc-50 dark:bg-white/[0.03] px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-as-line">
                    <p className="text-[13px] text-zinc-700 dark:text-zinc-300">
                      <strong>
                        {item.user
                          ? `${item.user.firstName} ${item.user.lastName}`
                          : "System"}
                      </strong>{" "}
                      {t('components.historyTimeline.updatedThe')}{" "}
                      <strong className="font-medium text-zinc-900 dark:text-zinc-100">
                        {type === 'status' ? t('components.historyTimeline.status') : t('components.historyTimeline.priority')}
                      </strong>{" "}
                      {t('common.to')} <span className="font-medium">{label.toLowerCase()}</span>{" "}
                      {t('common.on')}{" "}
                      <time>
                        {new Date(item.date).toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      .
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {regularHistoryItems.length > 3 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-2 ml-6 flex items-center gap-1.5 text-[13px] font-medium text-secondary hover:underline dark:text-secondary-light transition-colors duration-[120ms]"
        >
          {showAll ? (
            <>
              <ChevronUp className="w-4 h-4" />
              <span>{t('common.showLess')}</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              <span>{t('common.showMore')} {regularHistoryItems.length - 3}</span>
            </>
          )}
        </button>
      )}
    </div>
  );
};

export default HistoryTimeline;

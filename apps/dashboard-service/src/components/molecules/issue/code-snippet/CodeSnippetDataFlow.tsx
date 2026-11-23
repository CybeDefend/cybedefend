import { Highlight, Language } from "prism-react-renderer";
import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
// The prism themes without their pink.
import { CODE_THEME_DARK, CODE_THEME_LIGHT } from "./codeThemes";
import { sensitive } from "@/utils/privacy/sensitive";

interface CodeLine {
  line: number;
  content: string;
}

interface CodeSnippetDataFlowProps {
  code: CodeLine[];
  language: string;
  lineToHighlight: number;
  nameHighlight: string;
  showLineNumbers?: boolean;
  customStyle?: React.CSSProperties;
}

// Escape RegExp special characters
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Safely check if a word is present in a string as a full word
function isWordHighlighted(word: string, content: string): boolean {
  if (!word) return false;

  const trimmed = word.trim();

  // Basic length limit to avoid abuse (e.g. ReDoS)
  if (trimmed.length > 100) return false;

  const escaped = escapeRegExp(trimmed);

  try {
    // It's a safe regex since we escaped the word so false positive
    const regex = new RegExp(`\\b${escaped}\\b`, "g"); // cybedefend-ignore[CD-SAST-0434]: the word is escaped by escapeRegExp() just above, so the pattern only matches it literally
    return regex.test(content);
  } catch (err) {
    // In case somehow invalid, fallback safely
    return false;
  }
}

const CodeSnippetDataFlow: React.FC<CodeSnippetDataFlowProps> = ({
  code,
  language,
  lineToHighlight,
  nameHighlight,
  showLineNumbers = true,
  customStyle,
}) => {
  const { t } = useTranslation();
  if (!Array.isArray(code) || code.length === 0) {
    return <div className="text-red-500 p-2">{t('components.dataFlow.noCode')}</div>;
  }

  const codeString = code.map((line) => line.content).join("\n");

  const highlightLineColor = "rgba(232, 73, 42, 0.4)";
  const highlightContentColor = "rgba(232, 73, 42, 0.2)";
  const highlightTextColor = "rgba(255, 235, 59, 0.4)";

  const [currentTheme, setCurrentTheme] = useState(
    document.documentElement.classList.contains("dark") ? CODE_THEME_DARK : CODE_THEME_LIGHT
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setCurrentTheme(
        document.documentElement.classList.contains("dark") ? CODE_THEME_DARK : CODE_THEME_LIGHT
      );
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div
      // The customer's source code: its text is not recorded by anything that observes the page.
      {...sensitive('content')}
      style={{ ...customStyle }}
      className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-as-line dark:bg-as-surface"
    >
      <div
        className="custom-scrollbar overflow-x-auto overflow-y-auto"
        style={{ maxHeight: "400px" }}
      >
        <Highlight
          code={codeString}
          language={language as Language}
          theme={currentTheme}
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={className}
              style={{
                ...style,
                margin: 0,
                padding: "0.5em 0",
                minWidth: "100%",
              }}
            >
              {tokens.map((lineTokens, i) => {
                const lineObj = code[i];
                if (!lineObj || typeof lineObj.line !== 'number') {
                  // Safety: a missing line is rendered as an empty one
                  return (
                    <div key={i} style={{ display: "table-row", width: "100%", backgroundColor: "#ffeaea" }}>
                      <span style={{ display: "table-cell", color: '#b91c1c', paddingLeft: '0.5em' }}>{t('components.dataFlow.invalidLine')}</span>
                    </div>
                  );
                }
                const lineNumber = lineObj.line;
                const lineProps = getLineProps({ line: lineTokens, key: i });
                let highlighted = false;
                return (
                  <div
                    {...lineProps}
                    key={i}
                    style={{
                      ...lineProps.style,
                      display: "table-row",
                      width: "100%",
                      backgroundColor:
                        lineNumber === lineToHighlight
                          ? highlightContentColor
                          : "inherit",
                    }}
                  >
                    {showLineNumbers && (
                      <span
                        style={{
                          display: "table-cell",
                          textAlign: "right",
                          paddingRight: "1em",
                          paddingLeft: "0.5em",
                          userSelect: "none",
                          // Full ink on the flagged line: at 0.8 its number read 3.7:1 on the red band.
                          opacity: lineNumber === lineToHighlight ? 1 : 0.8,
                          backgroundColor:
                            lineNumber === lineToHighlight
                              ? highlightLineColor
                              : "inherit",
                          borderRight: "1px solid rgba(128, 128, 128, 0.3)",
                        }}
                      >
                        {lineNumber}
                      </span>
                    )}
                    <span style={{ display: "table-cell", width: "100%" }}>
                      {lineTokens.map((token, key) => {
                        const tokenProps = getTokenProps({ token, key });
                        const content = token.content;
                        if (
                          lineNumber === lineToHighlight &&
                          !highlighted &&
                          isWordHighlighted(nameHighlight, content)
                        ) {
                          highlighted = true;
                          return (
                            <span
                              {...tokenProps}
                              key={key}
                              style={{
                                ...tokenProps.style,
                                backgroundColor: highlightTextColor,
                                fontWeight: "bold",
                                fontSize: "1.05em",
                                padding: "0 0.1em",
                                borderRadius: "0.2em",
                              }}
                            >
                              {content}
                            </span>
                          );
                        }
                        return <span {...tokenProps} key={key} />;
                      })}
                    </span>
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
};

export default CodeSnippetDataFlow;

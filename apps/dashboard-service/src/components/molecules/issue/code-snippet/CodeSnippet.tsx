import { Highlight, Language } from "prism-react-renderer";
import React, { useEffect, useState } from "react";
// The prism themes without their pink.
import { CODE_THEME_DARK, CODE_THEME_LIGHT } from "./codeThemes";
import { sensitive } from "@/utils/privacy/sensitive";

interface CodeLine {
  line: number;
  content: string;
}

interface CodeSnippetProps {
  code: CodeLine[] | null;
  language: string;
  highlightedLines?: number[];
  showLineNumbers?: boolean;
  nameHighlight?: string;
  customStyle?: React.CSSProperties;
  startingLineNumber?: number;
}

const CodeSnippet: React.FC<CodeSnippetProps> = ({
  code,
  language,
  highlightedLines = [],
  showLineNumbers = true,
  nameHighlight,
  customStyle,
  startingLineNumber = 1,
}) => {
  const codeString = code ? code.map((line) => line.content).join("\n") : "";

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
      // The prism themes' surfaces (github #f6f8fa, dracula #282a36) as classes, so AppSec dark can set its raised surface (gated: another space keeps dracula's).
      className="custom-scrollbar bg-[#f6f8fa] dark:bg-[#282a36] appsec-dark:bg-as-raised"
      style={{
        maxHeight: "400px",
        // Past the cap the lines scroll here: hidden, a long block was cut and a trackpad scroll moved the panel behind.
        overflowY: "auto",
        overflowX: "auto",
        borderRadius: 6,
        // Make the background cover the whole visible width even when the content is narrower
        width: '100%',
        ...customStyle,
      }}
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
              padding: '8px 0',
              // Make the pre transparent so the parent container paints the background (no cut when scrolling sideways)
              background: 'transparent',
              minWidth: '100%',
            }}
          >
            {tokens.map((lineTokens, i) => {
              const lineNumber = startingLineNumber + i;
              const lineProps = getLineProps({ line: lineTokens, key: i });

              const isLineEmpty = lineTokens.every(token => token.content.trim() === '');
              const isHighlighted = !isLineEmpty && highlightedLines.includes(lineNumber);

              if (isHighlighted) {
                lineProps.style = {
                  ...lineProps.style,
                  backgroundColor: highlightContentColor,
                };
              }

              return (
                <div
                  {...lineProps}
                  key={i}
                  style={{
                    ...lineProps.style,
                    display: 'flex',
                    alignItems: 'stretch',
                    // Let the line grow as wide as its content (long code) while covering the horizontal scroll
                    width: 'fit-content',
                    minWidth: '100%',
                  }}
                >
                  {showLineNumbers && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'flex-start',
                        textAlign: "right",
                        paddingRight: "1em",
                        paddingLeft: "0.5em",
                        userSelect: "none",
                        // Full ink on a flagged line: at 0.8 its number read 3.7:1 on the red band.
                        opacity: isHighlighted ? 1 : 0.8,
                        backgroundColor: isHighlighted ? highlightLineColor : "inherit",
                        borderRight: "1px solid rgba(128, 128, 128, 0.3)",
                        minWidth: '3ch',
                      }}
                    >
                      {lineNumber}
                    </span>
                  )}
                  <span style={{ display: 'inline-block', paddingLeft: 8 }}>
                    {lineTokens.map((token, key) => {
                      const tokenProps = getTokenProps({ token, key });

                      if (
                        nameHighlight &&
                        isHighlighted &&
                        token.content.includes(nameHighlight)
                      ) {
                        const parts = token.content.split(nameHighlight);
                        return (
                          <span key={key} {...tokenProps}>
                            {parts.map((part, idx) => (
                              <React.Fragment key={idx}>
                                {idx > 0 && (
                                  <span
                                    style={{
                                      backgroundColor: highlightTextColor,
                                      fontWeight: "bold",
                                      fontSize: "1.05em",
                                      padding: "0 0.1em",
                                      borderRadius: "0.2em",
                                    }}
                                  >
                                    {nameHighlight}
                                  </span>
                                )}
                                {part}
                              </React.Fragment>
                            ))}
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
  );
};

export default CodeSnippet;
import React from "react";
import type { IconType } from "react-icons";
import {
  SiJavascript,
  SiTypescript,
  SiPython,
  SiGo,
  SiPhp,
  SiRuby,
  SiRust,
  SiKotlin,
  SiSwift,
  SiScala,
  SiCplusplus,
  SiC,
  SiSharp,
  SiGnubash,
  SiTerraform,
  SiDocker,
  SiHtml5,
  SiCss,
  SiYaml,
} from "react-icons/si";
import { FaJava } from "react-icons/fa6";
import { Code2 } from '@/components/atoms/icon/icons';
import { cn } from "@/utils/function/utils";

/** Brand logo + colour for a normalized language key. */
const LANGUAGE_ICONS: Record<string, { Icon: IconType; color: string }> = {
  javascript: { Icon: SiJavascript, color: "#F7DF1E" },
  typescript: { Icon: SiTypescript, color: "#3178C6" },
  python: { Icon: SiPython, color: "#3776AB" },
  java: { Icon: FaJava, color: "#E76F00" },
  go: { Icon: SiGo, color: "#00ADD8" },
  php: { Icon: SiPhp, color: "#777BB4" },
  ruby: { Icon: SiRuby, color: "#CC342D" },
  rust: { Icon: SiRust, color: "#D34516" },
  kotlin: { Icon: SiKotlin, color: "#7F52FF" },
  swift: { Icon: SiSwift, color: "#F05138" },
  scala: { Icon: SiScala, color: "#DC322F" },
  cpp: { Icon: SiCplusplus, color: "#00599C" },
  c: { Icon: SiC, color: "#5C6BC0" },
  csharp: { Icon: SiSharp, color: "#512BD4" },
  bash: { Icon: SiGnubash, color: "#4EAA25" },
  terraform: { Icon: SiTerraform, color: "#844FBA" },
  docker: { Icon: SiDocker, color: "#2496ED" },
  html: { Icon: SiHtml5, color: "#E34F26" },
  css: { Icon: SiCss, color: "#1572B6" },
  yaml: { Icon: SiYaml, color: "#CB171E" },
};

const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  node: "javascript",
  nodejs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  golang: "go",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  "c++": "cpp",
  cplusplus: "cpp",
  cxx: "cpp",
  "c#": "csharp",
  cs: "csharp",
  dotnet: "csharp",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  tf: "terraform",
  hcl: "terraform",
  dockerfile: "docker",
  html5: "html",
  css3: "css",
};

/**
 * Resolves a raw language string (scanner output, possibly aliased or with a
 * parenthetical like "JavaScript (React)") to a known icon key, or null when
 * there is no dedicated logo (unknown / "other" / empty) so the caller renders
 * a generic fallback.
 */
export const normalizeLanguageKey = (raw?: string | null): string | null => {
  if (!raw) return null;
  const base = raw.toLowerCase().split("(")[0].trim();
  if (!base || base === "other" || base === "unknown") return null;
  const key = ALIASES[base] ?? base;
  return LANGUAGE_ICONS[key] ? key : null;
};

interface LanguageLogoProps {
  language?: string | null;
  className?: string;
}

/**
 * Small brand logo for a programming language. Falls back to a generic code
 * glyph for languages without a dedicated logo (including "other").
 */
const LanguageLogo: React.FC<LanguageLogoProps> = ({ language, className }) => {
  const key = normalizeLanguageKey(language);
  if (!key) {
    return <Code2 className={cn("text-gray-400 dark:text-gray-500", className)} aria-hidden />;
  }
  const { Icon, color } = LANGUAGE_ICONS[key];
  return <Icon className={className} style={{ color }} aria-hidden title={language ?? undefined} />;
};

export default LanguageLogo;

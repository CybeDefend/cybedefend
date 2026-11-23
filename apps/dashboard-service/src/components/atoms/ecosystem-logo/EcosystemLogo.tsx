import React from "react";
import type { IconType } from "react-icons";
import {
  SiPypi,
  SiNpm,
  SiApachemaven,
  SiGradle,
  SiNuget,
  SiPackagist,
  SiRubygems,
  SiRust,
  SiGo,
  SiElixir,
  SiDart,
  SiCocoapods,
  SiAnaconda,
} from "react-icons/si";
import { Package } from '@/components/atoms/icon/icons';
import { cn } from "@/utils/function/utils";

/** Brand logo + colour for a normalized package-manager / ecosystem key. */
const ECOSYSTEM_ICONS: Record<string, { Icon: IconType; color: string }> = {
  pypi: { Icon: SiPypi, color: "#3775A9" },
  npm: { Icon: SiNpm, color: "#CB3837" },
  maven: { Icon: SiApachemaven, color: "#C71A36" },
  gradle: { Icon: SiGradle, color: "#02303A" },
  nuget: { Icon: SiNuget, color: "#004880" },
  packagist: { Icon: SiPackagist, color: "#F28D1A" },
  rubygems: { Icon: SiRubygems, color: "#E9573F" },
  "crates.io": { Icon: SiRust, color: "#E43717" },
  go: { Icon: SiGo, color: "#00ADD8" },
  hex: { Icon: SiElixir, color: "#4B275F" },
  pub: { Icon: SiDart, color: "#0175C2" },
  cocoapods: { Icon: SiCocoapods, color: "#EE3322" },
  conda: { Icon: SiAnaconda, color: "#44A833" },
};

/** Raw ecosystem strings (lower-cased) that map onto a canonical key above. */
const ECOSYSTEM_ALIASES: Record<string, string> = {
  golang: "go",
  cargo: "crates.io",
  crates: "crates.io",
  composer: "packagist",
  "conda-forge": "conda",
  rubygem: "rubygems",
  "rubygems.org": "rubygems",
};

/**
 * Resolves a raw ecosystem string (OSV "ecosystem" value, e.g. "PyPI", "npm",
 * "crates.io") to a known icon key, or null when there is no dedicated logo so
 * the caller renders a generic package fallback.
 */
export const normalizeEcosystemKey = (raw?: string | null): string | null => {
  if (!raw) return null;
  const base = raw.toLowerCase().trim();
  if (!base) return null;
  const key = ECOSYSTEM_ALIASES[base] ?? base;
  return ECOSYSTEM_ICONS[key] ? key : null;
};

interface EcosystemLogoProps {
  ecosystem?: string | null;
  className?: string;
}

/**
 * Small brand logo for a package-manager ecosystem. Falls back to a generic
 * package glyph for ecosystems without a dedicated logo.
 */
const EcosystemLogo: React.FC<EcosystemLogoProps> = ({ ecosystem, className }) => {
  const key = normalizeEcosystemKey(ecosystem);
  if (!key) {
    return <Package className={cn("text-gray-400 dark:text-gray-500", className)} aria-hidden />;
  }
  const { Icon, color } = ECOSYSTEM_ICONS[key];
  // Decorative: the ecosystem name is always shown alongside this logo, so we
  // keep it aria-hidden and omit a <title> (which would duplicate that label).
  return <Icon className={className} style={{ color }} aria-hidden />;
};

export default EcosystemLogo;

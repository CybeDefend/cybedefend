/**
 * Region runtime config + helpers (env-driven).
 * Uses Vite environment variables for configuration.
 */

import { getApiUrl } from "@/config/runtimeConfig";

export type RegionKey = "eu" | "us";

export interface RegionConfig {
  key: RegionKey;
  label: string;
  appUrl: string;  // SPA host (used for cross-region redirect). Empty string means "no redirect".
  apiUrl: string;  // Gateway/API base URL
  badges: string[]; // Short badges shown in the certifications modal
}

const STORAGE_KEY = "cd:region";

const hostOf = (u?: string): string | undefined => {
  if (!u) return undefined;
  try { return new URL(u).host.toLowerCase(); } catch { return undefined; }
};

function buildRegionConfig(key: RegionKey): RegionConfig {
  // Region-specific app host (for cross-app redirect).
  const appUrl = key === "eu" ? import.meta.env.VITE_APP_URL_EU : import.meta.env.VITE_APP_URL_US;

  // The runtime config.js first (Community image), else the build's VITE_GATEWAY_URL.
  const apiUrl = getApiUrl();

  // Curated badges (unchanged)
  const euBadges = [
    "CISPE",
    "ANSSI SecNumCloud",
    "G-Cloud UK",
    "ACN (Italy)",
    "ENS (Spain)",
    "GDPR",
    "BSI KRITIS",
    "BSI C5",
    "ISO 27001/17/18",
    "ISO 27701",
  ];
  const usBadges = [
    "SOC 2",
    "ISO 27001/17/18",
    "ISO 27701",
    "HIPAA",
    "PCI-DSS",
  ];

  return {
    key,
    label: key === "eu" ? "Europe" : "United States",
    appUrl,
    apiUrl,
    badges: key === "eu" ? euBadges : usBadges,
  };
}

const REGIONS: Record<RegionKey, RegionConfig> = {
  eu: buildRegionConfig("eu"),
  us: buildRegionConfig("us"),
};

export function getRegion(): RegionKey {
  const region = import.meta.env.VITE_REGION as RegionKey;
  // Fallback to 'eu' if VITE_REGION is not defined or invalid
  return (region === "eu" || region === "us") ? region : "eu";
}

export function getRegionConfig(region?: RegionKey): RegionConfig {
  const key = region ?? getRegion();
  // Ensure we always return a valid config
  return REGIONS[key] || REGIONS.eu;
}

/**
 * Persist region and optionally redirect to APP_URL_* while keeping path/query/hash.
 */
export function setRegion(region: RegionKey, withRedirect = true) {
  localStorage.setItem(STORAGE_KEY, region);
  if (!withRedirect) return;

  const target = getRegionConfig(region).appUrl;
  const targetHost = hostOf(target);
  const curHost = window.location.host.toLowerCase();

  if (!target || !targetHost || targetHost === curHost) return;

  const url = `${target}${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.href = url;
}

/** EU first to highlight sovereignty. */
export const REGION_LIST: RegionConfig[] = [REGIONS.eu, REGIONS.us];

/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import svgr from "vite-plugin-svgr";

// Strict Content-Security-Policy applied to dev-server and preview responses.
// The equivalent header is configured for production in `nginx/default.conf`.
//
// Two CSP profiles:
//
// 1. DEV — used by vite dev server (`pnpm start`).
//    Requires 'unsafe-inline' on script-src because @vitejs/plugin-react
//    injects an inline <script type="module"> preamble for React Fast
//    Refresh. This relaxation is acceptable in dev only — never in prod.
//
// 2. PROD — used by vite preview (`pnpm run preview`) AND nginx.
//    Strict script-src (no unsafe-inline).
//
// Common to both:
//   - 'wasm-unsafe-eval' for bundled WASM tooling (parser workers, etc.)
//   - 'unsafe-inline' on style-src for TailwindCSS / inline component styles.
//   - no font host: the fonts are served from /fonts/ (public/fonts), so
//     font-src and style-src stay on 'self'.
//   - worker-src 'self' blob: for web workers instantiated from Blob URLs.
//   - connect-src: the dashboard's own origin, and the local gateway and
//     auth endpoints in dev.
//   - frame-ancestors 'none' protects against clickjacking.

const cspBase = (extraScriptSrc: string[] = []) => [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval'${extraScriptSrc.length ? " " + extraScriptSrc.join(" ") : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "media-src 'self'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' http://localhost:3000 http://localhost:3003 ws://localhost:3002",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const CSP_DEV = cspBase(["'unsafe-inline'"]);
const CSP_PROD_PREVIEW = cspBase();

const securityHeaders = (csp: string) => ({
  "Content-Security-Policy": csp,
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export default defineConfig({
  plugins: [react(), svgr()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 3002,
    open: true,
    headers: securityHeaders(CSP_DEV),
  },
  preview: {
    headers: securityHeaders(CSP_PROD_PREVIEW),
  },
  build: {
    outDir: "build",
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});

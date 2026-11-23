// report-brand.ts
//
// CybeDefend brand band shared by EVERY HTML/PDF report (OWASP, CWE,
// scanner-type, aggregated, EU AI Act). The logo is embedded in base64 (see
// logo-base64.ts) to avoid any IO/network dependency while the PDF is
// generated. 100% inline styles: the helper stays self-contained whatever the
// host header's CSS (every report header has a dark background / white text),
// so no class has to be declared in the template.

import { CYBEDEFEND_LOGO_BASE64, CYBEDEFEND_LOGO_MIME } from './logo-base64';

/**
 * Renders the « logo + CYBEDEFEND wordmark » block meant for the top of a
 * dark report header. The logo sits on a white pill to stay legible whatever
 * its tint. The markup holds no user-controlled data: the source is a base64
 * constant.
 */
export function renderReportBrand(): string {
  return `<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
  <img src="data:${CYBEDEFEND_LOGO_MIME};base64,${CYBEDEFEND_LOGO_BASE64}" alt="CybeDefend" style="width: 40px; height: 40px; background: #fff; padding: 5px; border-radius: 8px;" />
  <div style="font-weight: 700; font-size: 14px; letter-spacing: 1px; color: #fff;">CYBEDEFEND</div>
</div>`;
}

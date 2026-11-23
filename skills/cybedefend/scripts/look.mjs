// The look the two pages of /cybedefend share: the live page of a run
// (watch.mjs) and the audit report it leads to (report.mjs). One palette, one
// type, one frame, written once, so the report opens as the same page the run
// was followed on. Each page adds only what is its own.
//
// It is a dark page, made for a developer's screen: a near-black background
// that runs to the edges of the window, a faint grid and two soft glows behind
// the top of the page, thin lines, white type, and three accents. Violet is
// what runs, mint is what is sound or done, red is kept for what blocks.

/**
 * The colours: the background, a card on it and a raised part of a card, the
 * three greys of the text, the line, and the accents. Every text colour holds
 * WCAG AA on the background and on a card.
 */
export const PALETTE = `:root{--bg:#0A0910;--panel:#13121C;--raise:#1A1826;--ink:#F6F5FB;--body:#B9B6CB;--faint:#908DA6;--line:#24222F;--violet:#8F73FF;--lav:#BDAEFF;--mint:#2FE3B7;--red:#FF5D7C;--gut:clamp(20px,4.2vw,72px)}`;

/**
 * The frame: the page and its width, the header, the title and its lead, the
 * row of large numbers, the footer. The column is fluid: it follows the window
 * up to a wide screen, between two gutters that grow with it.
 */
export const FRAME = `*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--bg);color-scheme:dark}
body{position:relative;font-family:'Rubik',system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact;line-height:1.5;font-size:16px}
/* Behind the top of the page: a grid of dots that fades out, a violet glow on the right, a trace of mint on the left. */
body::before{content:"";position:absolute;inset:0 0 auto 0;height:960px;max-height:100%;pointer-events:none;background:radial-gradient(820px 520px at 96% -6%,rgba(143,115,255,.2),transparent 68%),radial-gradient(640px 420px at -4% -10%,rgba(47,227,183,.08),transparent 66%),radial-gradient(circle at 1px 1px,rgba(255,255,255,.075) 1px,transparent 1.6px) 0 0/26px 26px;-webkit-mask-image:linear-gradient(#000 30%,transparent);mask-image:linear-gradient(#000 30%,transparent)}
header.hd{position:relative;z-index:2;border-bottom:1px solid var(--line)}
header.hd .in,.page{max-width:1760px;margin:0 auto;padding-left:var(--gut);padding-right:var(--gut)}
header.hd .in{display:flex;justify-content:space-between;align-items:center;gap:24px;min-height:76px;padding-top:14px;padding-bottom:14px}
.page{position:relative;z-index:1;padding-bottom:56px}
/* The logo is drawn in ink for a light page: here it is white, and its eye is mint. */
.logo svg{height:54px;width:auto;display:block;margin-left:-10px}
.logo svg .cls-1{fill:var(--ink)}
.logo svg g:first-of-type path:nth-of-type(3){fill:var(--mint)}
header.hd .meta{font:400 12.5px/1.7 'JetBrains Mono',monospace;color:var(--faint);text-align:right}
header.hd .meta b{color:var(--ink);font-weight:400}
.hero{position:relative;padding-top:clamp(36px,5vw,76px)}
/* The colour of the verdict, behind its sentence: red when something blocks, mint when the branch can ship. */
.hero::before{content:"";position:absolute;z-index:-1;left:calc(-1*var(--gut));top:0;width:min(900px,100%);height:420px;pointer-events:none;opacity:0;transition:opacity 1s;background:radial-gradient(closest-side,rgba(255,93,124,.16),transparent)}
.page.no .hero::before{opacity:1}
.page.ok .hero::before{opacity:1;background:radial-gradient(closest-side,rgba(47,227,183,.15),transparent)}
h1{font:800 clamp(38px,5.4vw,88px)/1 'Rubik',sans-serif;letter-spacing:-.045em;max-width:17em;text-wrap:balance}
.lead{font-size:clamp(17px,1.5vw,21px);line-height:1.45;color:var(--body);margin-top:20px;max-width:46em}
.lead b{color:var(--ink);font-weight:600}
.cols{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:44px}
.cols>*{position:relative;overflow:hidden;padding:22px 24px 24px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012))}
.big{font:800 clamp(48px,4.7vw,78px)/.95 'Rubik',sans-serif;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
.big.r{color:var(--red)} .big.m{color:var(--mint)} .big.v{color:var(--violet)} .big.i{color:var(--ink)}
.cap{font-size:15px;line-height:1.4;color:var(--body);margin-top:14px;max-width:26em}
code,.mono{font-family:'JetBrains Mono',monospace;font-size:.88em}
footer.ft{margin-top:88px;padding-top:20px;border-top:1px solid var(--line);font:400 12.5px/1.6 'JetBrains Mono',monospace;color:var(--faint);display:flex;justify-content:space-between;gap:24px}
a{color:var(--lav)}
@media screen and (max-width:900px){.cols{grid-template-columns:repeat(2,minmax(0,1fr))}}`;

/** The two typefaces. `display` says what the browser shows while they load: the report waits for them (it is printed), the live page does not. */
export const fonts = (display = 'swap') =>
  `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&family=Rubik:wght@400;500;600;700;800&display=${display}" rel="stylesheet">`;

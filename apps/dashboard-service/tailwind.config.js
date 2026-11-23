const plugin = require('tailwindcss/plugin');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class", 
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    screens: {
      sm: "480px",
      md: "768px",
      lg: "976px",
      xl: "1440px",
    },
    fontFamily: {
      sans: ["Rubik", "sans-serif"],
    },
    extend: {
      /*
       * Tailwind's spacing scale jumps 3.5 → 4 → 5. Icons needed the step
       * between 4 and 5: at h-4 they read as decoration, at h-5 some rows get
       * noticeably taller. 4.5 is 18px, which is where a row-level pictogram
       * sits comfortably.
       */
      spacing: {
        '4.5': '1.125rem',
      },
      colors: {
        /*
         * The closed product space's tertiary text in dark: between zinc-400 (secondary,
         * 7.7:1 on #09090b) and zinc-500 (4.1:1, below WCAG AA for small
         * text). #8B8B94 reads 5.8:1 on the page and 5.4:1 on a card or a
         * popover, so counts, captions and shortcuts stay legible while
         * still sitting a step below secondary text. Additive: the default
         * zinc ramp is untouched.
         */
        zinc: { 450: '#8b8b94' },
        // The closed product space's signature hints and layered surfaces (the ee styles, scoped to its data-product attribute).
        iris: 'rgb(var(--vd-iris-rgb) / <alpha-value>)',
        mint: 'rgb(var(--vd-mint-rgb) / <alpha-value>)',
        'vd-bg': 'rgb(var(--vd-bg-rgb) / <alpha-value>)',
        'vd-surface': 'rgb(var(--vd-surface-rgb) / <alpha-value>)',
        'vd-raised': 'rgb(var(--vd-raised-rgb) / <alpha-value>)',
        'vd-line': 'var(--vd-line)',
        'vd-line-strong': 'var(--vd-line-strong)',
        // AppSec layered surfaces and hairlines (src/index.css, on :root and .dark).
        'as-bg': 'rgb(var(--as-bg-rgb) / <alpha-value>)',
        'as-surface': 'rgb(var(--as-surface-rgb) / <alpha-value>)',
        'as-raised': 'rgb(var(--as-raised-rgb) / <alpha-value>)',
        'as-line': 'var(--as-line)',
        'as-line-strong': 'var(--as-line-strong)',
        "primary": "#1a1a2e",
        "primary-dark": "#16162a",
        // The accent follows the product space: the values live in src/index.css, keyed by `data-product`.
        "secondary": "rgb(var(--color-secondary-rgb) / <alpha-value>)",
        "secondary-light": "rgb(var(--color-secondary-light-rgb) / <alpha-value>)",
        "alternative": "#FAF7FC",
        "alternative-light": "#fbfafc",
        "alternative-dark": "#130A19",
        "low-risk": "#4a90e2",             
        "low-risk-bg": "#b3d1f2",          

        "medium-risk": "#e6b800",          
        "medium-risk-bg": "#ffed99",       

        "high-risk": "#ff8c4a",            
        "high-risk-bg": "#ffd7c2",         

        "critical-risk": "#ff6659",        
        "critical-risk-bg": "#ffcbc7",     

        "fixed": "#81c784",                
        "fixed-bg": "#d0e9d7",             
        hover: {
          light: "#F1F5F9",
          dark: "#92899c",
        },
      },
      borderRadius: {
        "4xl": "2rem",
      },
      /*
       * Phone sheets (bottom-anchored dialogs, tour panel, persona choices).
       * Transform and colour only — never opacity from 0. If a background tab
       * freezes an animation on its first frame, the sheet then sits a little
       * low instead of being invisible while still trapping the page, which is
       * the failure that got the old fade-in removed (see atoms/modal/Modal.tsx).
       */
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        },
        'sheet-up': {
          from: { transform: 'translateY(28%)' },
          to: { transform: 'translateY(0)' }
        },
        'backdrop-in': {
          from: { backgroundColor: 'transparent', backdropFilter: 'blur(0px)' }
        },
        'rise-in': {
          from: { transform: 'translateY(10px)' },
          to: { transform: 'translateY(0)' }
        },
        'pop-in': {
          '0%': { transform: 'scale(0.6)' },
          '60%': { transform: 'scale(1.12)' },
          '100%': { transform: 'scale(1)' }
        },
        /*
         * The halo of a live dot (atoms/live-dot): a twin of the dot scales
         * out and fades. Only ever behind `motion-safe:`, and stopped by
         * `[data-calm="true"]` in index.css when the viewer chose Calm. The
         * opacity rule above is about overlays; this is a decoration whose
         * dot stays fully visible underneath.
         */
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '.55' },
          '50%': { transform: 'scale(1.6)', opacity: '0' }
        },
        /*
         * The zinc kit (components/atoms/zinc) and the agents ui.
         * Floating layers (menu, popover, tooltip) scale from their origin and
         * fade from .5, never from 0, for the frozen-first-frame reason above.
         * Dialogs, sheets and drawers move by transform only.
         */
        'vd-pop-in': {
          from: { opacity: '.5', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' }
        },
        'vd-pop-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.96)' }
        },
        'vd-dialog-in': {
          from: { transform: 'translateY(8px) scale(0.98)' },
          to: { transform: 'translateY(0) scale(1)' }
        },
        'vd-drawer-in': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' }
        }
      },
      animation: {
        'sheet-up': 'sheet-up 340ms cubic-bezier(0.22, 1, 0.36, 1)',
        'backdrop-in': 'backdrop-in 260ms ease-out',
        'rise-in': 'rise-in 380ms cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'pop-in': 'pop-in 240ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        breathe: 'breathe 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'vd-pop-in': 'vd-pop-in 120ms cubic-bezier(0.22, 1, 0.36, 1)',
        'vd-pop-out': 'vd-pop-out 90ms ease-in',
        'vd-dialog-in': 'vd-dialog-in 160ms cubic-bezier(0.22, 1, 0.36, 1)',
        'vd-drawer-in': 'vd-drawer-in 240ms cubic-bezier(0.22, 1, 0.36, 1)'
      }
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    require('@tailwindcss/typography'),
    function ({ addBase, theme }) {
      addBase({
        ":root": {
          "--color-low-risk": theme("colors.low-risk"),
          "--color-medium-risk": theme("colors.medium-risk"),
          "--color-high-risk": theme("colors.high-risk"),
          "--color-critical-risk": theme("colors.critical-risk"),
          "--color-fixed": theme("colors.fixed"),
        },
      });
    },
    plugin(function ({ addVariant }) {
      // A class only an AppSec page shows: the closed spaces write their own
      // data-product on <html> (useProductAccentRoot). Pages without the
      // attribute (sign-in, integration project creation) count as AppSec.
      addVariant('appsec', ['html[data-product="appsec"] &', 'html:not([data-product]) &']);
      // The same in the dark theme (`.dark` sits on <html> too, so `appsec:dark:` cannot match).
      addVariant('appsec-dark', ['html.dark[data-product="appsec"] &', 'html.dark:not([data-product]) &']);
    }),
  ],
};
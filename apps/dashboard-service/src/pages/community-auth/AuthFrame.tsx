import React from 'react';
import { Link } from 'react-router-dom';
import { CommunityBrand } from './CommunityBrand';

/**
 * The frame of the Community sign-in pages: the brand above one card, centred,
 * in the AppSec accent. No product space, no shell: these pages render before
 * any session exists, so the frame carries `data-product` itself.
 */
export const AuthFrame: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => (
  <main
    data-product="appsec"
    className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-alternative px-4 py-10 sm:py-16 dark:bg-as-bg"
  >
    {/* The accent's light behind the card, as on the cloud sign-in. Decorative. */}
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -right-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-secondary/15 blur-3xl dark:bg-secondary/20" />
      <div className="absolute -bottom-48 -left-32 h-[30rem] w-[30rem] rounded-full bg-secondary/10 blur-3xl dark:bg-secondary/10" />
    </div>
    <div className="w-full max-w-md">
      <CommunityBrand />
      <div className="mt-6 rounded-2xl border border-secondary/10 bg-white p-6 shadow-xl shadow-secondary/10 sm:p-8 dark:border-secondary/25 dark:bg-as-raised dark:shadow-secondary/15">
        <h1 className="text-2xl font-semibold tracking-tight text-primary dark:text-zinc-100">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">{subtitle}</p>}
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </div>
  </main>
);

/** A refusal or a hint: a fixed translated sentence, never a server's text. */
export const AuthAlert: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p
    role="alert"
    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
  >
    {children}
  </p>
);

/** A neutral notice (a sentence that is not a refusal). */
export const AuthNotice: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-as-line-strong dark:bg-white/[0.03] dark:text-zinc-300">
    {children}
  </p>
);

export const AuthLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className="font-medium text-secondary dark:text-secondary-light hover:underline">
    {children}
  </Link>
);

/**
 * The policy the server applies, 12 to 128 code points, checked here as a
 * hint only: the server decides, with PASSWORD_POLICY.
 */
export function passwordFitsPolicy(password: string): boolean {
  const length = [...password].length;
  return length >= 12 && length <= 128;
}

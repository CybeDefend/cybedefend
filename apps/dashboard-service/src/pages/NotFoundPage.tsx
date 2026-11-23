import { EXTERNAL_LINK_PROPS } from '@/utils/constants/support';
import { supportUrl } from '@/edition/support';
import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

import { useTranslation } from 'react-i18next';
import { cn } from '@/utils/function/utils';
import { HelpCircle, Home } from '@/components/atoms/icon/icons';

const NotFoundPage: React.FC = () => {
  const { t } = useTranslation();
  /**
   * No entrance animation on this page, deliberately.
   *
   * The content used to start at `opacity: 0` and be revealed by a staggered
   * framer-motion sequence. That sequence is driven by requestAnimationFrame,
   * which the browser suspends whenever the tab is not visible — restore a
   * backgrounded tab, or land here from a slow redirect, and the animation
   * never advances: the page stays at 16% opacity and the user, who is
   * already lost, gets a blank screen with no way back.
   *
   * An error page is the last place to gate content behind an effect.
   */

  return (
    <div className={cn(
      "min-h-screen relative overflow-hidden",
      "bg-neutral-50 dark:bg-neutral-900"
    )}>
      {/* Decorative background elements */}
      <div className="absolute inset-0">
        <motion.div
          className="absolute w-96 h-96 bg-primary rounded-full blur-3xl opacity-10 -top-48 -right-48"
          animate={{ scale: [1, 1.1, 1], opacity: [0.1, 0.15, 0.1] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute w-96 h-96 bg-secondary rounded-full blur-3xl opacity-10 -bottom-48 -left-48"
          animate={{ scale: [1, 1.15, 1], opacity: [0.1, 0.12, 0.1] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <header className="py-8">
          <Link
            to="/"
            className="inline-block transition-transform hover:scale-105"
          >
            <img
              className={cn(
                "h-24",
                "dark:brightness-0 dark:invert"
              )}
              src="/logo.webp"
              alt="Logo"
            />
          </Link>
        </header>

        <main className="text-center py-16">
          <div className="flex flex-col items-center justify-center">
            {/* 404 Number */}
            <div className="relative">
              {/* A second "404" used to sit on top of the first at 30% opacity,
                  washing the only content on the page down to roughly 1.3:1
                  against white. One number, on a colour that holds. */}
              <h1 className={cn(
                "text-9xl font-bold relative z-10",
                "text-primary dark:text-white"
              )}>
                404
              </h1>
            </div>

            {/* Title and Description */}
            <div className="mt-4 space-y-4">
              <h2 className={cn(
                "text-2xl font-semibold",
                "text-neutral-800 dark:text-white"
              )}>
                {t('pages.notFound.title')}
              </h2>
              <p className={cn(
                "max-w-md mx-auto",
                "text-neutral-600 dark:text-neutral-300"
              )}>
                {t('pages.notFound.subtitle1')}
                <br />
                {t('pages.notFound.subtitle2')}
              </p>
            </div>

            {/* Action Cards */}
            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              <motion.div
                className={cn(
                  "group p-6 backdrop-blur-lg rounded-2xl border transition-all duration-300",
                  "bg-white/80 dark:bg-neutral-800/50",
                  "border-neutral-200 dark:border-neutral-700",
                  "hover:border-secondary/40 hover:shadow-lg hover:shadow-secondary/5"
                )}
                whileHover={{ y: -5, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="flex items-center space-x-4">
                  <div className={cn(
                    "p-3 rounded-xl transition-colors",
                    "bg-secondary/10 group-hover:bg-secondary/20"
                  )}>
                    <Home className="w-5 h-5 text-secondary"  />
                  </div>
                  <div className="text-left">
                    <h3 className={cn(
                      "text-lg font-semibold",
                      "text-neutral-800 dark:text-white"
                    )}>
                      {t('pages.notFound.actions.returnHome.title')}
                    </h3>
                    <p className="text-neutral-600 dark:text-neutral-300">
                      {t('pages.notFound.actions.returnHome.description')}
                    </p>
                  </div>
                </div>
                <Link
                  to="/"
                  className={cn(
                    "mt-4 inline-flex items-center justify-center w-full px-6 py-3",
                    "text-sm font-medium text-white",
                    "bg-secondary rounded-xl",
                    "hover:bg-secondary/90 transition-all duration-200",
                    "shadow-md hover:shadow-lg"
                  )}
                >
                  {t('pages.notFound.actions.returnHome.button')}
                </Link>
              </motion.div>

              <motion.div
                className={cn(
                  "group p-6 backdrop-blur-lg rounded-2xl border transition-all duration-300",
                  "bg-white/80 dark:bg-neutral-800/50",
                  "border-neutral-200 dark:border-neutral-700",
                  "hover:border-secondary/40 hover:shadow-lg hover:shadow-secondary/5"
                )}
                whileHover={{ y: -5, scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <div className="flex items-center space-x-4">
                  <div className={cn(
                    "p-3 rounded-xl transition-colors",
                    "bg-secondary/10 group-hover:bg-secondary/20"
                  )}>
                    <HelpCircle className="w-5 h-5 text-secondary"  />
                  </div>
                  <div className="text-left">
                    <h3 className={cn(
                      "text-lg font-semibold",
                      "text-neutral-800 dark:text-white"
                    )}>
                      {t('pages.notFound.actions.needHelp.title')}
                    </h3>
                    <p className="text-neutral-600 dark:text-neutral-300">
                      {t('pages.notFound.actions.needHelp.description')}
                    </p>
                  </div>
                </div>
                <a
                  href={supportUrl()}
                  {...EXTERNAL_LINK_PROPS}
                  className={cn(
                    "mt-4 inline-flex items-center justify-center w-full px-6 py-3",
                    "text-sm font-medium text-white",
                    "bg-secondary rounded-xl",
                    "hover:bg-secondary/90 transition-all duration-200",
                    "shadow-md hover:shadow-lg"
                  )}
                >
                  {t('pages.notFound.actions.needHelp.button')}
                </a>
              </motion.div>
            </div>

          </div>
        </main>

        <footer className="py-8 text-center">
          <p className={cn(
            "text-sm",
            "text-neutral-500 dark:text-neutral-400"
          )}>
            {t('common.copyright', { year: new Date().getFullYear() })}
          </p>
        </footer>
      </div>
    </div>
  );
};

export default NotFoundPage;
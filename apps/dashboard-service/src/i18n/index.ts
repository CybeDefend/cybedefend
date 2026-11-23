import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import { deepMerge, loadLocale } from './loadLocale';
import { syncDocumentLanguage } from './documentLanguage';

// The translations are split into per-area JSON fragments.

// Static globs (required by Vite) — avoids the "Invalid glob import syntax" error
const splittedLocales = {
  en: import.meta.glob('./locales/en/**/*.json', { eager: true }),
  fr: import.meta.glob('./locales/fr/**/*.json', { eager: true })
};

// The ee fragments (ACTIVE_EXTENSIONS.locales) are merged over the core's;
// in the Community Edition they are empty (EMPTY_EXTENSIONS).
const resources = {
  en: {
    translation: deepMerge(loadLocale(splittedLocales.en, 'en'), loadLocale(ACTIVE_EXTENSIONS.locales.en, 'en'))
  },
  fr: {
    translation: deepMerge(loadLocale(splittedLocales.fr, 'fr'), loadLocale(ACTIVE_EXTENSIONS.locales.fr, 'fr'))
  }
};

if (import.meta.env?.DEV) {
  // Small debug check on a known key
  // eslint-disable-next-line no-console
  console.debug('[i18n] sample key components.historyTimeline.title =>', (resources.en.translation as any)?.components?.historyTimeline?.title);
}

// Reads the language stored in localStorage, else the browser's language
const getStoredLanguage = () => {
  const storedLanguage = localStorage.getItem('language');
  if (storedLanguage && ['en', 'fr'].includes(storedLanguage)) {
    return storedLanguage;
  }
  // Otherwise the browser's language, or English by default
  return navigator.language.split('-')[0] || 'en';
}

/**
 * i18n module configuration and initialisation
 * Supported languages: French and English
 * Default language: English
 */
i18n
  .use(initReactI18next) // hands i18n to react-i18next
  .init({
    resources,
    lng: getStoredLanguage(),
    fallbackLng: 'en', // fallback language when a translation is missing
    
    interpolation: {
      escapeValue: false // no need to escape values: React already does
    },
    
    react: {
      useSuspense: true, // uses React.Suspense while translations load
    }
  });

// `<html lang>` follows the interface's language (screen readers, hyphenation).
syncDocumentLanguage(i18n);

export default i18n; 
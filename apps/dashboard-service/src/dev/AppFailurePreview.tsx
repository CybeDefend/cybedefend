import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AppFailurePage from '@/components/organismes/app-failure/AppFailurePage';
import type { AppFailureVariant } from '@/components/organismes/app-failure/appFailureLogic';
import { Segmented } from '@/components/atoms/zinc/segmented';
import { PRODUCT_SPACES, type Product } from '@/utils/product';

/**
 * Dev only: the page the app shows when it cannot start, without breaking
 * anything to reach it (the profile or session failure, and the render crash
 * the root `AppErrorBoundary` catches). Served at `/__preview/app-error` by `src/index.tsx`
 * behind `import.meta.env.DEV`, so it never reaches a production bundle. Its
 * buttons do nothing here: in the app they restart the sign-in or reload, and
 * « Sign in again » clears the stored session.
 */
type Theme = 'light' | 'dark';

const VARIANTS = [
  { value: 'workspace', label: 'Espace' },
  { value: 'session', label: 'Session' },
  { value: 'crash', label: 'Plantage' },
] as const satisfies ReadonlyArray<{ value: AppFailureVariant; label: string }>;

const PRODUCT_OPTIONS = (t: (key: string) => string): ReadonlyArray<{ value: Product; label: string }> =>
  PRODUCT_SPACES.map((space) => ({ value: space.id as Product, label: t(space.labelKey) }));

const THEMES = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
] as const satisfies ReadonlyArray<{ value: Theme; label: string }>;

const inert = () => undefined;

const AppFailurePreview: React.FC = () => {
  const { t } = useTranslation();
  const [variant, setVariant] = useState<AppFailureVariant>('workspace');
  const [product, setProduct] = useState<Product>('appsec');
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  return (
    <div className="relative min-h-screen">
      <AppFailurePage
        key={`${variant}-${product}-${theme}`}
        variant={variant}
        product={product}
        dark={theme === 'dark'}
        onRetry={inert}
        onSignIn={inert}
      />
      <div className={theme === 'dark' ? 'dark' : undefined}>
        <div data-preview-toolbar="" className="fixed bottom-4 left-1/2 z-[100] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white/90 p-2 backdrop-blur dark:border-white/10 dark:bg-zinc-900/90">
          <Segmented aria-label="Cas" options={VARIANTS} value={variant} onValueChange={setVariant} size="sm" />
          <Segmented aria-label="Produit" options={PRODUCT_OPTIONS(t)} value={product} onValueChange={setProduct} size="sm" />
          <Segmented aria-label="Thème" options={THEMES} value={theme} onValueChange={setTheme} size="sm" />
        </div>
      </div>
    </div>
  );
};

export default AppFailurePreview;

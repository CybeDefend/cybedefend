import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import LoaderHome from '@/components/atoms/loader/LoaderHome';
import type { LoaderSpace } from '@/components/atoms/loader/loaderHomeLogic';
import { Segmented } from '@/components/atoms/zinc/segmented';
import { PRODUCT_SPACES } from '@/utils/product';

/**
 * Dev only: the start loader on a loop, to watch its motion on a local
 * machine where the real loading is too fast to see. Served at
 * `/__preview/loader` by `src/index.tsx` behind `import.meta.env.DEV`, so it
 * never reaches a production bundle. The loader repeats its own 6.4 s cycle;
 * switching the space or the theme starts it again from the first frame.
 */
type Theme = 'light' | 'dark';

const SPACES = (t: (key: string) => string): ReadonlyArray<{ value: LoaderSpace; label: string }> => [
  ...PRODUCT_SPACES.map((space) => ({ value: space.id as LoaderSpace, label: t(space.labelKey) })),
  { value: 'cybedefend', label: 'CybeDefend' },
];

const THEMES = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
] as const satisfies ReadonlyArray<{ value: Theme; label: string }>;

const LoaderPreview: React.FC = () => {
  const { t } = useTranslation();
  const [space, setSpace] = useState<LoaderSpace>('cybedefend');
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  return (
    <div className="relative min-h-screen">
      <LoaderHome key={`${space}-${theme}`} space={space} dark={theme === 'dark'} />
      <div className={theme === 'dark' ? 'dark' : undefined}>
        <div className="fixed right-4 top-4 z-[100] flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white/90 p-2 backdrop-blur dark:border-white/10 dark:bg-zinc-900/90">
          <Segmented aria-label="Espace" options={SPACES(t)} value={space} onValueChange={setSpace} size="sm" />
          <Segmented aria-label="Thème" options={THEMES} value={theme} onValueChange={setTheme} size="sm" />
        </div>
      </div>
    </div>
  );
};

export default LoaderPreview;

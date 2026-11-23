import type { Type } from '@nestjs/common';
import { editionImports, editionImportsFor } from './edition-imports';
// ee-modules.ts assigns EE_CONTEXT_MODULES = EE_FEATURE_MODULES_BY_CONTEXT, so
// this alias is that very object. src/edition/ee-modules.ts is the only core
// file allowed to import src/ee/ (EE_IMPORTERS in edition-boundary.rules.ts),
// so this spec reads the ee constants through it instead of importing ../ee/.
import {
  EE_CONTEXT_MODULES,
  EE_CONTEXT_MODULES as EE_FEATURE_MODULES_BY_CONTEXT,
  EE_MODULES,
} from './ee-modules';
import { editionProtoPaths } from './edition-protos';

/**
 * Each Nest context gets its own ee modules through
 * editionImportsFor('<ArContext>') (filled EE_CONTEXT_MODULES), the API
 * context keeps EE_MODULES (= EE_FEATURE_MODULES_BY_CONTEXT.api), and
 * editionProtoPaths() is empty in the community edition.
 */
describe('edition contexts and proto paths', () => {
  const KEY = 'CYBEDEFEND_EDITION';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[KEY];
    } else {
      process.env[KEY] = saved;
    }
  });

  it('returns no module and no proto path in community', () => {
    process.env[KEY] = 'community';
    expect(editionImportsFor('worker')).toEqual([]);
    expect(editionProtoPaths()).toEqual([]);
  });

  it('returns each context its own ee module in the cloud', () => {
    delete process.env[KEY];
    const [EeWorkerModule] = (EE_CONTEXT_MODULES.worker ??
      []) as Type<unknown>[];
    expect(editionImportsFor('worker')).toEqual([EeWorkerModule]);
    expect(editionImportsFor('api')).toEqual(editionImports());
    expect(editionImportsFor('api')).toEqual(EE_MODULES);
    expect(editionImportsFor('cron-epss')).toEqual([]);
  });

  it('gives the ee-only cron-epss context no ee module', () => {
    expect(
      (EE_FEATURE_MODULES_BY_CONTEXT as Record<string, unknown>)['cron-epss'],
    ).toBeUndefined();
  });
});

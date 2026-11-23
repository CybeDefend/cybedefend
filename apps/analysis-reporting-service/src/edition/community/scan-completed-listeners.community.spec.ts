import type { Provider } from '@nestjs/common';
import { SCAN_COMPLETED_LISTENERS } from '../ports/scan-completed-listeners.port';
import { bindingToken } from '../merge-bindings';

type EditionImportsModule = typeof import('../edition-imports');

async function bindingsFor(edition: string): Promise<Provider[]> {
  const saved = process.env.CYBEDEFEND_EDITION;
  process.env.CYBEDEFEND_EDITION = edition;
  try {
    let mod: EditionImportsModule | undefined;
    await jest.isolateModulesAsync(async () => {
      mod = await import('../edition-imports');
    });
    return (mod as EditionImportsModule).editionBindings();
  } finally {
    if (saved === undefined) {
      delete process.env.CYBEDEFEND_EDITION;
    } else {
      process.env.CYBEDEFEND_EDITION = saved;
    }
  }
}

function listenersBinding(bindings: Provider[]): Provider | undefined {
  return bindings.find(
    (provider) => bindingToken(provider) === SCAN_COMPLETED_LISTENERS,
  );
}

/**
 * SCAN_COMPLETED_LISTENERS is bound in every edition. The Community
 * Edition binds no listener; an edition with listeners replaces that empty
 * list with its own.
 */
describe('SCAN_COMPLETED_LISTENERS bindings', () => {
  it('binds an empty list in the Community Edition', async () => {
    const binding = listenersBinding(await bindingsFor('community'));

    expect(binding).toEqual({
      provide: SCAN_COMPLETED_LISTENERS,
      useValue: [],
    });
  });

  // An edition with listeners binding its own list is tested by a closed
  // spec.
});

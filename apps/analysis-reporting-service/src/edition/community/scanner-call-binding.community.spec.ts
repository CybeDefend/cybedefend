import type { Provider } from '@nestjs/common';
import { bindingToken } from '../merge-bindings';
import {
  SCANNER_CALL_BINDING,
  type ScannerCallBinding,
} from '../ports/scanner-call-binding.port';
import { CommunityScannerCallBinding } from './scanner-call-binding.community';

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
    if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
    else process.env.CYBEDEFEND_EDITION = saved;
  }
}

const IDENTITY = {
  pod: 'scanner-pod-1',
  podUid: 'uid-1',
  namespace: 'scanners-namespace',
  scanId: 'scan-1',
  projectId: 'project-1',
};

/**
 * The Community Edition admits no scanner token, so a call that reached the
 * binding is never bound: the binding refuses it, whatever the request.
 */
describe('SCANNER_CALL_BINDING in the Community Edition', () => {
  it('community binding refuses every scanner call', async () => {
    const binding: ScannerCallBinding = new CommunityScannerCallBinding();
    for (const request of [
      { projectId: 'project-1', scanId: 'scan-1' },
      { projectId: 'project-1' },
      {},
      null,
    ]) {
      await expect(
        binding.bind({
          method: '/cybedefend.analysis_reporting.ResultService/AddScanResult',
          identity: IDENTITY,
          request,
        }),
      ).resolves.toBe('not-bound');
    }
  });

  it('is the binding of the Community Edition', async () => {
    const binding = (await bindingsFor('community')).find(
      (provider) => bindingToken(provider) === SCANNER_CALL_BINDING,
    );
    // The bindings come from an isolated module registry: compare the class
    // by name, then prove its answer.
    const useClass = (binding as { useClass: new () => ScannerCallBinding })
      .useClass;
    expect(useClass.name).toBe(CommunityScannerCallBinding.name);
    await expect(
      new useClass().bind({
        method: '/cybedefend.analysis_reporting.ResultService/StoreSbom',
        identity: IDENTITY,
        request: { projectId: 'project-1' },
      }),
    ).resolves.toBe('not-bound');
  });
});

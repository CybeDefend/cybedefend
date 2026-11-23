import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import {
  IMPORT_DOWNLOAD_TTL_SECONDS,
  IMPORT_MAX_UPLOAD_BYTES,
  IMPORT_UPLOAD_TTL_SECONDS,
  assertImportContainerId,
  assertImportKind,
  assertImportObjectKey,
  importContentType,
  importObjectKey,
  importSbomObjectKey,
} from './import-object';

const P = '0b6f3c1e-7d2a-4c8e-9f10-2a3b4c5d6e7f';
const S = '1c7a4d2f-8e3b-4d9f-a021-3b4c5d6e7f80';
const OTHER = '2d8b5e30-9f4c-4ea0-b132-4c5d6e7f8091';
const C = '3e9c6f41-a05d-4fb1-8243-5d6e7f8091a2';
const D = '4fad7052-b16e-40c2-9354-6e7f8091a2b3';

function rpcErrorOf(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe('import-object', () => {
  it('builds one key whatever the compression', () => {
    expect(importObjectKey(P, S)).toBe(`import/${P}/${S}.sarif`);
  });

  it('types each encoding', () => {
    expect(importContentType('identity')).toBe('application/sarif+json');
    expect(importContentType('gzip')).toBe('application/gzip');
  });

  it('exposes the R15 limits and TTLs', () => {
    expect(IMPORT_MAX_UPLOAD_BYTES).toBe(52_428_800);
    expect(IMPORT_UPLOAD_TTL_SECONDS).toBe(300);
    expect(IMPORT_DOWNLOAD_TTL_SECONDS).toBe(1_200);
  });

  it('accepts its own key', () => {
    expect(() => assertImportObjectKey(P, importObjectKey(P, S))).not.toThrow();
    // The caller project id is compared lower-cased.
    expect(() =>
      assertImportObjectKey(P.toUpperCase(), importObjectKey(P, S)),
    ).not.toThrow();
  });

  it.each([
    `scan/${P}/${S}.zip`,
    `import/${OTHER}/${S}.sarif`,
    `import/${P}/../x.sarif`,
    `import/${P}/${S}.json`,
    `import/${P}/${S}.sarif.gz`,
    '',
    `import//${S}.sarif`,
  ])('refuses the key %s', (key) => {
    let err: unknown;
    try {
      assertImportObjectKey(P, key);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RpcException);
    expect((err as RpcException).getError()).toEqual(
      expect.objectContaining({ code: status.INVALID_ARGUMENT }),
    );
  });

  describe('per-container key (Community cluster scans)', () => {
    it('builds import/<p>/<s>/<c>.sarif with a container id', () => {
      expect(importObjectKey(P, S, C)).toBe(`import/${P}/${S}/${C}.sarif`);
    });

    it('builds the scan key, as today, without a container id', () => {
      expect(importObjectKey(P, S, undefined)).toBe(`import/${P}/${S}.sarif`);
      expect(importObjectKey(P, S, null)).toBe(`import/${P}/${S}.sarif`);
    });

    it('accepts its own per-container key', () => {
      expect(() =>
        assertImportObjectKey(P, importObjectKey(P, S, C)),
      ).not.toThrow();
      expect(() =>
        assertImportObjectKey(P.toUpperCase(), importObjectKey(P, S, C)),
      ).not.toThrow();
    });

    it.each([
      `import/${P}/${S}/../x.sarif`,
      `import/${P}/${S}/${C}/${D}.sarif`,
      `import/${OTHER}/${S}/${C}.sarif`,
      `import/${P}/${S}/.sarif`,
      `import/${P}/${S}/${C}.sarif.gz`,
      `import/${P}/${S}/${C.toUpperCase()}.sarif`,
      `import/${P}/${S}/not-a-uuid.sarif`,
      `import/${P}//${C}.sarif`,
      `import/${P}/${S}/`,
    ])('refuses the key %s', (key) => {
      const err = rpcErrorOf(() => assertImportObjectKey(P, key));
      expect(err).toBeInstanceOf(RpcException);
      expect((err as RpcException).getError()).toEqual(
        expect.objectContaining({ code: status.INVALID_ARGUMENT }),
      );
    });

    it('accepts a uuid container id and an absent one', () => {
      expect(() => assertImportContainerId(C)).not.toThrow();
      expect(() => assertImportContainerId(undefined)).not.toThrow();
      expect(() => assertImportContainerId(null)).not.toThrow();
    });

    it.each(['', ' ', 'not-a-uuid', '../x', `${C}/${D}`, C.toUpperCase()])(
      'refuses the container id %j before any key is built',
      (containerId) => {
        const err = rpcErrorOf(() => assertImportContainerId(containerId));
        expect(err).toBeInstanceOf(RpcException);
        expect((err as RpcException).getError()).toEqual(
          expect.objectContaining({ code: status.INVALID_ARGUMENT }),
        );
      },
    );
  });

  describe('the SBOM of an sca import', () => {
    it('builds import/<p>/<s>.sbom and accepts it', () => {
      expect(importSbomObjectKey(P, S)).toBe(`import/${P}/${S}.sbom`);
      expect(() =>
        assertImportObjectKey(P, importSbomObjectKey(P, S)),
      ).not.toThrow();
    });

    it('types it as CycloneDX JSON, or gzip', () => {
      expect(importContentType('identity', 'sbom')).toBe(
        'application/vnd.cyclonedx+json',
      );
      expect(importContentType('gzip', 'sbom')).toBe('application/gzip');
    });

    it.each([
      `import/${OTHER}/${S}.sbom`,
      `import/${P}/${S}/${C}/${D}.sbom`,
      `import/${OTHER}/${S}/${C}.sbom`,
      `import/${P}/${S}/${C}.sbom.gz`,
      `import/${P}/${S}/not-a-uuid.sbom`,
      `import/${P}/${S}.sbom.gz`,
      `import/${P}/${S}.cdx.json`,
    ])('refuses the key %s', (key) => {
      const err = rpcErrorOf(() => assertImportObjectKey(P, key));
      expect(err).toBeInstanceOf(RpcException);
    });

    it('builds and accepts the per-container SBOM of a cluster sca container, import/<p>/<s>/<c>.sbom', () => {
      expect(importSbomObjectKey(P, S, C)).toBe(`import/${P}/${S}/${C}.sbom`);
      expect(importSbomObjectKey(P, S, undefined)).toBe(
        `import/${P}/${S}.sbom`,
      );
      expect(importSbomObjectKey(P, S, null)).toBe(`import/${P}/${S}.sbom`);
      expect(() =>
        assertImportObjectKey(P, importSbomObjectKey(P, S, C)),
      ).not.toThrow();
    });

    it('takes the kinds sarif and sbom, with or without a container, and nothing else', () => {
      expect(() => assertImportKind(undefined)).not.toThrow();
      expect(() => assertImportKind(null)).not.toThrow();
      expect(() => assertImportKind('sarif')).not.toThrow();
      expect(() => assertImportKind('sbom')).not.toThrow();
      for (const kind of ['', 'spdx', 'SBOM', 'sbom ']) {
        const err = rpcErrorOf(() => assertImportKind(kind));
        expect(err).toBeInstanceOf(RpcException);
        expect((err as RpcException).getError()).toEqual(
          expect.objectContaining({ code: status.INVALID_ARGUMENT }),
        );
      }
    });
  });
});

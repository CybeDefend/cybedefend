import { readFileSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { createGzip, gzipSync } from 'zlib';
import { finished } from 'stream';
import type { Library } from '@grpc/analysis-reporting/result';
import { ImportError, SarifSource } from '../sarif/import-limits';
import { SBOM_IMPORT_LIMITS, SbomLimits, readCycloneDx } from './cyclonedx';

const FIXTURES = join(__dirname, '../../../../../../libs/test-fixtures/sbom');
const fixture = (name: string): Buffer => readFileSync(join(FIXTURES, name));

const sourceOf =
  (...chunks: Buffer[]): SarifSource =>
  async () =>
    Readable.from(chunks);

const byName = (packages: Library[]): Map<string, Library> =>
  new Map(packages.map((library) => [library.name, library]));

const failureOf = async (
  source: SarifSource,
  limits: SbomLimits = SBOM_IMPORT_LIMITS,
): Promise<ImportError> => {
  try {
    await readCycloneDx(source, limits);
  } catch (error) {
    if (error instanceof ImportError) return error;
    throw error;
  }
  throw new Error('the SBOM was accepted');
};

const bomOf = (doc: Record<string, unknown>): Buffer =>
  Buffer.from(
    JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6', ...doc }),
  );

describe('readCycloneDx', () => {
  describe('a Trivy SBOM (trivy fs --format cyclonedx)', () => {
    let packages: Map<string, Library>;
    let skipped: Map<string, number>;

    beforeAll(async () => {
      const inventory = await readCycloneDx(
        sourceOf(fixture('trivy-fs.cdx.json')),
      );
      packages = byName(inventory.packages);
      skipped = inventory.skipped;
    });

    it('takes every library and skips the application nodes', () => {
      expect([...packages.keys()].sort()).toEqual([
        '@babel/code-frame',
        'express',
        'lodash',
        'qs',
        'request',
        'requests',
        'tough-cookie',
        'typing_extensions',
      ]);
      expect(Object.fromEntries(skipped)).toEqual({ not_a_package: 2 });
    });

    it('marks what an application node depends on as direct, its file the node name', () => {
      expect(packages.get('express')).toEqual({
        name: 'express',
        version: '4.17.1',
        file: 'package-lock.json',
        ecosystem: 'npm',
        isTransitive: false,
        isDev: false,
        path: ['express@4.17.1', 'package-lock.json'],
        dependencyInfoAvailable: true,
        importLocations: [],
        licenses: ['MIT'],
      });
      expect(packages.get('requests')).toMatchObject({
        file: 'requirements.txt',
        ecosystem: 'PyPI',
        isTransitive: false,
        licenses: [],
      });
    });

    it('marks everything else reachable as transitive, with its shortest path', () => {
      expect(packages.get('qs')).toMatchObject({
        isTransitive: true,
        dependencyInfoAvailable: true,
        file: 'package-lock.json',
        path: ['qs@6.5.2', 'express@4.17.1', 'package-lock.json'],
        licenses: ['BSD-3-Clause'],
      });
      expect(packages.get('@babel/code-frame')).toMatchObject({
        ecosystem: 'npm',
        version: '7.12.13',
        isTransitive: true,
        path: [
          '@babel/code-frame@7.12.13',
          'tough-cookie@2.5.0',
          'request@2.88.2',
          'package-lock.json',
        ],
      });
    });

    it('keeps a license name when the license has no id', () => {
      expect(packages.get('tough-cookie')?.licenses).toEqual(['BSD-3-Clause']);
    });

    it("keeps a Python package's own spelling when it is the purl's name", () => {
      expect(packages.get('typing_extensions')).toMatchObject({
        version: '4.7.1',
        ecosystem: 'PyPI',
        licenseExpression: 'PSF-2.0',
        licenses: ['PSF-2.0'],
      });
    });
  });

  describe('a Syft SBOM without dependencies', () => {
    let packages: Map<string, Library>;
    let skipped: Map<string, number>;

    beforeAll(async () => {
      const inventory = await readCycloneDx(
        sourceOf(fixture('syft-flat.cdx.json')),
      );
      packages = byName(inventory.packages);
      skipped = inventory.skipped;
    });

    it('takes the packages with a purl and counts the rest', () => {
      expect([...packages.keys()].sort()).toEqual([
        '@types/node',
        'github.com/gin-gonic/gin',
        'org.apache.commons:commons-lang3',
        'rack',
        'serde',
      ]);
      expect(Object.fromEntries(skipped)).toEqual({
        no_purl: 1,
        not_a_package: 2,
      });
    });

    it('says nothing of direct or transitive without a dependency graph', () => {
      for (const library of packages.values()) {
        expect(library.dependencyInfoAvailable).toBe(false);
        expect(library.isTransitive).toBe(false);
        expect(library.path).toEqual([]);
      }
    });

    it("takes the file from Syft's location, relative", () => {
      expect(packages.get('github.com/gin-gonic/gin')).toMatchObject({
        file: 'go.mod',
        ecosystem: 'Go',
        version: 'v1.9.1',
      });
      expect(packages.get('org.apache.commons:commons-lang3')).toMatchObject({
        file: 'libs/commons-lang3-3.12.0.jar',
        ecosystem: 'Maven',
      });
      expect(packages.get('serde')).toMatchObject({
        file: 'Cargo.lock',
        ecosystem: 'crates.io',
        version: '1.0.193',
      });
    });

    it('splits a plain expression into its ids, and keeps several licenses', () => {
      expect(packages.get('@types/node')).toMatchObject({
        licenseExpression: 'MIT OR Apache-2.0',
        licenses: ['MIT', 'Apache-2.0'],
      });
      expect(packages.get('rack')).toMatchObject({
        licenses: ['MIT', 'Ruby License'],
      });
      expect(packages.get('rack')?.licenseExpression).toBeUndefined();
    });
  });

  describe('a cdxgen SBOM with nested components', () => {
    let packages: Map<string, Library>;

    beforeAll(async () => {
      const inventory = await readCycloneDx(
        sourceOf(fixture('cdxgen-nested.cdx.json')),
      );
      packages = byName(inventory.packages);
    });

    it('takes the nested components and the frameworks', () => {
      expect([...packages.keys()].sort()).toEqual([
        'fsevents',
        'jest',
        'koa',
        'koa-compose',
        'mocha',
        'pg',
      ]);
      expect(packages.get('koa')).toMatchObject({
        isTransitive: false,
        file: 'package-lock.json',
        path: ['koa@2.15.3', 'shop-api'],
      });
      expect(packages.get('koa-compose')).toMatchObject({
        isTransitive: true,
        file: 'package-lock.json',
      });
    });

    it('marks a package dev only on a clear signal, never on scope optional alone', () => {
      expect(packages.get('jest')?.isDev).toBe(true);
      expect(packages.get('mocha')?.isDev).toBe(true);
      expect(packages.get('fsevents')?.isDev).toBe(false);
      expect(packages.get('koa')?.isDev).toBe(false);
    });

    it('splits a parenthesised expression of ids', () => {
      expect(packages.get('pg')).toMatchObject({
        licenseExpression: '(MIT AND BSD-2-Clause)',
        licenses: ['MIT', 'BSD-2-Clause'],
      });
    });
  });

  it('reads a gzip SBOM', async () => {
    const inventory = await readCycloneDx(
      sourceOf(gzipSync(fixture('trivy-fs.cdx.json'))),
    );
    expect(inventory.packages).toHaveLength(8);
  });

  it('reads an SBOM cut into small chunks', async () => {
    const bytes = fixture('cdxgen-nested.cdx.json');
    const chunks: Buffer[] = [];
    for (let i = 0; i < bytes.length; i += 7) {
      chunks.push(bytes.subarray(i, i + 7));
    }
    const inventory = await readCycloneDx(sourceOf(...chunks));
    expect(inventory.packages).toHaveLength(6);
  });

  it('keeps one package per name and version: direct wins, dev only if every copy is', async () => {
    const component = (bomRef: string, scope?: string) => ({
      'bom-ref': bomRef,
      type: 'library',
      name: 'lodash',
      version: '4.17.21',
      purl: 'pkg:npm/lodash@4.17.21',
      ...(scope ? { scope } : {}),
    });
    const inventory = await readCycloneDx(
      sourceOf(
        bomOf({
          metadata: { component: { 'bom-ref': 'root', name: 'repo' } },
          components: [
            {
              'bom-ref': 'a',
              type: 'application',
              name: 'a/package-lock.json',
            },
            {
              'bom-ref': 'b',
              type: 'application',
              name: 'b/package-lock.json',
            },
            {
              'bom-ref': 'x',
              type: 'library',
              name: 'x',
              version: '1.0.0',
              purl: 'pkg:npm/x@1.0.0',
            },
            component('lodash-1', 'excluded'),
            component('lodash-2'),
          ],
          dependencies: [
            { ref: 'root', dependsOn: ['a', 'b'] },
            { ref: 'a', dependsOn: ['x'] },
            { ref: 'x', dependsOn: ['lodash-1'] },
            { ref: 'b', dependsOn: ['lodash-2'] },
          ],
        }),
      ),
    );
    const lodash = inventory.packages.filter((p) => p.name === 'lodash');
    expect(lodash).toHaveLength(1);
    expect(lodash[0]).toMatchObject({
      isTransitive: false,
      isDev: false,
      file: 'a/package-lock.json',
    });
  });

  it('marks a package no node reaches as of unknown dependency information', async () => {
    const inventory = await readCycloneDx(
      sourceOf(
        bomOf({
          metadata: { component: { 'bom-ref': 'root', name: 'repo' } },
          components: [
            {
              'bom-ref': 'x',
              type: 'library',
              name: 'x',
              version: '1.0.0',
              purl: 'pkg:npm/x@1.0.0',
            },
            {
              'bom-ref': 'y',
              type: 'library',
              name: 'y',
              version: '1.0.0',
              purl: 'pkg:npm/y@1.0.0',
            },
          ],
          dependencies: [{ ref: 'root', dependsOn: ['x'] }],
        }),
      ),
    );
    const packages = byName(inventory.packages);
    expect(packages.get('x')).toMatchObject({
      dependencyInfoAvailable: true,
      isTransitive: false,
      path: ['x@1.0.0', 'repo'],
    });
    expect(packages.get('y')).toMatchObject({
      dependencyInfoAvailable: false,
      isTransitive: false,
      path: [],
    });
  });

  it('skips a component whose purl cannot be read, or that has no version', async () => {
    const inventory = await readCycloneDx(
      sourceOf(
        bomOf({
          components: [
            { type: 'library', name: 'a', purl: 'npm/a@1.0.0' },
            { type: 'library', name: 'b', purl: 'pkg:npm/b' },
            { type: 'library', name: 'c', version: '2.0.0', purl: 'pkg:npm/c' },
            { name: 'd', purl: 'pkg:npm/d@1.0.0' },
          ],
        }),
      ),
    );
    expect(inventory.packages.map((p) => `${p.name}@${p.version}`)).toEqual([
      'c@2.0.0',
    ]);
    expect(Object.fromEntries(inventory.skipped)).toEqual({
      invalid_purl: 1,
      no_version: 1,
      not_a_package: 1,
    });
  });

  it('drops licenses it cannot store and bounds their count', async () => {
    const licenses = [
      { license: { id: 'X'.repeat(200) } },
      { license: { id: 'bad\nid' } },
      ...Array.from({ length: 40 }, (_, i) => ({ license: { id: `L-${i}` } })),
      { expression: 'Y'.repeat(600) },
    ];
    const inventory = await readCycloneDx(
      sourceOf(
        bomOf({
          components: [
            {
              type: 'library',
              name: 'a',
              version: '1.0.0',
              purl: 'pkg:npm/a@1.0.0',
              licenses,
            },
          ],
        }),
      ),
    );
    const [library] = inventory.packages;
    expect(library.licenses).toHaveLength(32);
    expect(library.licenses[0]).toBe('L-0');
    expect(library.licenseExpression).toBeUndefined();
  });

  describe('refusals, before anything is returned', () => {
    it('refuses a document that is not CycloneDX', async () => {
      const error = await failureOf(sourceOf(fixture('spdx.json')));
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
    });

    // CycloneDX 1.7 (2025) only adds to 1.6 (citations, patents,
    // distribution constraints): what the reader takes is unchanged, and the
    // producers move to it, so a 1.7 SBOM is read as a 1.6 one.
    it('reads a 1.7 document as a 1.6 one', async () => {
      const doc = {
        components: [
          {
            type: 'library',
            'bom-ref': 'pkg:npm/lodash@4.17.20',
            purl: 'pkg:npm/lodash@4.17.20',
            licenses: [{ license: { id: 'MIT' } }],
          },
        ],
      };
      const read = (specVersion: string) =>
        readCycloneDx(sourceOf(bomOf({ ...doc, specVersion })));
      const [v16, v17] = await Promise.all([read('1.6'), read('1.7')]);
      expect(v17.packages).toEqual(v16.packages);
      expect(v17.packages.map((p) => p.name)).toEqual(['lodash']);
    });

    it('refuses a specVersion it does not read', async () => {
      const error = await failureOf(sourceOf(fixture('spec-1.2.cdx.json')));
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
    });

    it('refuses a truncated document', async () => {
      const error = await failureOf(sourceOf(fixture('malformed.cdx.json')));
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
    });

    it('accepts components nested 64 levels deep', async () => {
      // root (1) > components (2) > component (3) > properties (4) > 60
      // nested arrays: 64 open values at the deepest point.
      const nested = '['.repeat(60) + ']'.repeat(60);
      const body = `{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"type":"library","name":"lodash","version":"4.17.20","purl":"pkg:npm/lodash@4.17.20","x":[${nested}]}]}`;
      const inventory = await readCycloneDx(sourceOf(Buffer.from(body)));
      expect(inventory.packages.map((p) => p.name)).toEqual(['lodash']);
    });

    it('refuses a document nested deeper than 64 levels, fast', async () => {
      const shallow = '['.repeat(61) + ']'.repeat(61);
      const justOver = `{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"x":[${shallow}]}]}`;
      expect((await failureOf(sourceOf(Buffer.from(justOver)))).code).toBe(
        'IMPORT_INVALID_SBOM',
      );
      const depth = 40_000;
      const deep = `{"bomFormat":"CycloneDX","specVersion":"1.6","x":${'['.repeat(depth)}${']'.repeat(depth)}}`;
      const started = Date.now();
      expect((await failureOf(sourceOf(Buffer.from(deep)))).code).toBe(
        'IMPORT_INVALID_SBOM',
      );
      expect(Date.now() - started).toBeLessThan(1_000);
    });

    it('refuses a root that is not an object', async () => {
      const error = await failureOf(sourceOf(Buffer.from('[]')));
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
    });

    it('refuses a name or version no registry uses, and never quotes it', async () => {
      const error = await failureOf(
        sourceOf(fixture('bad-coordinates.cdx.json')),
      );
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
      expect(error.message).not.toContain('evil');
      expect(error.message).not.toContain('rm -rf');
    });

    it('accepts an epoch or a tilde in a distribution version only', async () => {
      const inventory = await readCycloneDx(
        sourceOf(
          bomOf({
            components: [
              {
                type: 'library',
                name: 'curl',
                purl: 'pkg:deb/debian/curl@1:7.88.1~deb12u1',
              },
            ],
          }),
        ),
      );
      expect(inventory.packages[0].version).toBe('1:7.88.1~deb12u1');
      const error = await failureOf(
        sourceOf(
          bomOf({
            components: [
              { type: 'library', name: 'x', purl: 'pkg:npm/x@1:2.0.0' },
            ],
          }),
        ),
      );
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
    });

    it('refuses more components than the limit, nested ones counted', async () => {
      const error = await failureOf(
        sourceOf(
          bomOf({
            components: [
              {
                type: 'library',
                name: 'a',
                version: '1.0.0',
                purl: 'pkg:npm/a@1.0.0',
                components: [
                  {
                    type: 'library',
                    name: 'b',
                    version: '1.0.0',
                    purl: 'pkg:npm/b@1.0.0',
                  },
                  {
                    type: 'library',
                    name: 'c',
                    version: '1.0.0',
                    purl: 'pkg:npm/c@1.0.0',
                  },
                ],
              },
            ],
          }),
        ),
        { ...SBOM_IMPORT_LIMITS, maxComponents: 2 },
      );
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
    });

    it('refuses more dependency edges than the limit', async () => {
      const error = await failureOf(
        sourceOf(
          bomOf({
            components: [],
            dependencies: [{ ref: 'a', dependsOn: ['b', 'c', 'd'] }],
          }),
        ),
        { ...SBOM_IMPORT_LIMITS, maxDependencyEdges: 2 },
      );
      expect(error.code).toBe('IMPORT_INVALID_SBOM');
    });

    it('refuses a file over the size limits with IMPORT_TOO_LARGE', async () => {
      const bytes = fixture('trivy-fs.cdx.json');
      const stored = await failureOf(sourceOf(bytes), {
        ...SBOM_IMPORT_LIMITS,
        maxUploadedBytes: 100,
      });
      expect(stored.code).toBe('IMPORT_TOO_LARGE');
      const decoded = await failureOf(sourceOf(gzipSync(bytes)), {
        ...SBOM_IMPORT_LIMITS,
        maxDecompressedBytes: 1000,
      });
      expect(decoded.code).toBe('IMPORT_TOO_LARGE');
    });

    it('passes a storage failure through', async () => {
      const error = await failureOf(async () => {
        throw new ImportError('IMPORT_STORAGE_UNAVAILABLE', 'down');
      });
      expect(error.code).toBe('IMPORT_STORAGE_UNAVAILABLE');
    });
  });

  describe('bounded memory on hostile input', () => {
    const MB = 1024 * 1024;

    /** `head`, `body` × `times`, `tail`, gzipped without the expanded text. */
    const gzipOf = async (
      head: string,
      body: string,
      times: number,
      tail: string,
    ): Promise<Buffer> => {
      const gzip = createGzip({ level: 9 });
      const out: Buffer[] = [];
      gzip.on('data', (chunk: Buffer) => out.push(chunk));
      const perChunk = Math.max(1, Math.floor(MB / body.length));
      const block = body.repeat(perChunk);
      gzip.write(head);
      let left = times;
      while (left >= perChunk) {
        if (!gzip.write(block)) {
          await new Promise((resolve) => gzip.once('drain', resolve));
        }
        left -= perChunk;
      }
      gzip.write(body.repeat(left));
      gzip.end(tail);
      await new Promise<void>((resolve, reject) => {
        finished(gzip, (err) => (err ? reject(err) : resolve()));
      });
      return Buffer.concat(out);
    };

    const peakHeapOf = async <T>(
      work: () => Promise<T>,
    ): Promise<{ value?: T; error?: unknown; peak: number }> => {
      const base = process.memoryUsage().heapUsed;
      let peak = 0;
      const timer = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage().heapUsed - base);
      }, 5);
      try {
        return { value: await work(), peak };
      } catch (error) {
        return { error, peak };
      } finally {
        clearInterval(timer);
      }
    };

    const COMPONENT_HEAD =
      '{"bomFormat":"CycloneDX","specVersion":"1.6","components":[{"type":"library","name":"a","version":"1.0.0","purl":"pkg:npm/a@1.0.0",';

    it('refuses a gzip bomb of empty license entries with IMPORT_TOO_LARGE, heap bounded', async () => {
      // About 180 MB of `{},` once expanded, a few hundred KB stored.
      const bomb = await gzipOf(
        `${COMPONENT_HEAD}"licenses":[`,
        '{},',
        60_000_000,
        '{}]}]}',
      );
      const { error, peak } = await peakHeapOf(() =>
        readCycloneDx(sourceOf(bomb)),
      );
      expect(error).toBeInstanceOf(ImportError);
      expect((error as ImportError).code).toBe('IMPORT_TOO_LARGE');
      expect(peak).toBeLessThan(200 * MB);
    }, 120_000);

    it('refuses more license entries than the limit', async () => {
      const doc = bomOf({
        components: [
          {
            type: 'library',
            name: 'a',
            version: '1.0.0',
            purl: 'pkg:npm/a@1.0.0',
            licenses: [
              { license: { id: 'MIT' } },
              { license: { id: 'ISC' } },
              { license: { id: 'BSD-3-Clause' } },
            ],
          },
        ],
      });
      const error = await failureOf(sourceOf(doc), {
        ...SBOM_IMPORT_LIMITS,
        maxLicenses: 2,
      });
      expect(error.code).toBe('IMPORT_TOO_LARGE');
      const inventory = await readCycloneDx(sourceOf(doc), {
        ...SBOM_IMPORT_LIMITS,
        maxLicenses: 3,
      });
      expect(inventory.packages[0].licenses).toHaveLength(3);
    });

    it('reads a component with a million occurrences and properties, keeping the first file it names', async () => {
      // Heap use is not asserted here: the short-lived values of a read are
      // garbage the collector frees at its own pace, and only the license
      // entries above build kept objects without limit.
      const doc = await gzipOf(
        `${COMPONENT_HEAD}"properties":[{"name":"aquasecurity:trivy:FilePath","value":"/package-lock.json"},`,
        '{"name":"p","value":"v"},',
        1_000_000,
        '{"name":"q","value":"w"}],"evidence":{"occurrences":[' +
          '{"location":"other.json"},'.repeat(1_000_000) +
          '{"location":"last.json"}]}}]}',
      );
      const inventory = await readCycloneDx(sourceOf(doc));
      expect(inventory.packages).toHaveLength(1);
      expect(inventory.packages[0].file).toBe('package-lock.json');
    }, 120_000);

    it('takes the file from the first occurrence, and a dev flag among unrelated properties', async () => {
      const inventory = await readCycloneDx(
        sourceOf(
          bomOf({
            components: [
              {
                type: 'library',
                name: 'a',
                version: '1.0.0',
                purl: 'pkg:npm/a@1.0.0',
                properties: [
                  ...Array.from({ length: 50 }, (_, i) => ({
                    name: `unrelated:${i}`,
                    value: 'x',
                  })),
                  { name: 'cdx:npm:package:development', value: 'true' },
                ],
                evidence: {
                  occurrences: [
                    { location: '/first/package.json' },
                    { location: '/second/package.json' },
                  ],
                },
              },
            ],
          }),
        ),
      );
      const [library] = inventory.packages;
      expect(library.file).toBe('first/package.json');
      expect(library.isDev).toBe(true);
    });

    it('still reads a large realistic SBOM with the default limits', async () => {
      const components = Array.from({ length: 20_000 }, (_, i) => ({
        type: 'library',
        name: `pkg-${i}`,
        version: '1.0.0',
        purl: `pkg:npm/pkg-${i}@1.0.0`,
        'bom-ref': `pkg:npm/pkg-${i}@1.0.0`,
        licenses: [{ license: { id: 'MIT' } }, { expression: 'MIT OR ISC' }],
        hashes: [{ alg: 'SHA-256', content: 'ab'.repeat(32) }],
        properties: [
          { name: 'aquasecurity:trivy:FilePath', value: 'package-lock.json' },
          { name: 'aquasecurity:trivy:PkgID', value: `pkg-${i}@1.0.0` },
        ],
      }));
      const dependencies = components.map((c, i) => ({
        ref: c['bom-ref'],
        dependsOn:
          i + 1 < components.length ? [components[i + 1]['bom-ref']] : [],
      }));
      const inventory = await readCycloneDx(
        sourceOf(bomOf({ components, dependencies })),
      );
      expect(inventory.packages).toHaveLength(20_000);
      expect(inventory.packages[5].file).toBe('package-lock.json');
      expect(inventory.packages[5].licenses).toEqual(['MIT', 'ISC']);
    }, 120_000);
  });
});

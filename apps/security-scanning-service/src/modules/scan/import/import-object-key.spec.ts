import {
  importObjectKey,
  importObjectKeysOf,
  importSbomObjectKey,
} from './import-object-key';

describe('importObjectKey', () => {
  it('builds import/<projectId>/<scanId>.sarif, whatever the compression', () => {
    expect(importObjectKey('p', 's')).toBe('import/p/s.sarif');
  });

  it('is the key file-management signs and analysis-reporting reads', () => {
    expect(importObjectKey('project-1', 'scan-9')).toBe(
      'import/project-1/scan-9.sarif',
    );
  });
});

describe('importObjectKey of a Community cluster container', () => {
  it('builds import/<projectId>/<scanId>/<containerId>.sarif when a container is set', () => {
    expect(importObjectKey('p', 's', 'c')).toBe('import/p/s/c.sarif');
  });

  it('gives exactly the scan key without a container, or with an empty one', () => {
    expect(importObjectKey('p', 's', undefined)).toBe('import/p/s.sarif');
    expect(importObjectKey('p', 's', '')).toBe('import/p/s.sarif');
  });
});

describe('the SBOM of an sca import', () => {
  it('is import/<projectId>/<scanId>.sbom, the key file-management signs with kind sbom', () => {
    expect(importSbomObjectKey('p', 's')).toBe('import/p/s.sbom');
  });

  it('is one of the import objects of a scan that stored one', () => {
    expect(
      importObjectKeysOf({ projectId: 'p', id: 's', metadata: null }),
    ).toEqual(['import/p/s.sarif']);
    expect(
      importObjectKeysOf({
        projectId: 'p',
        id: 's',
        metadata: { importSbom: true },
      }),
    ).toEqual(['import/p/s.sarif', 'import/p/s.sbom']);
    expect(
      importObjectKeysOf({
        projectId: 'p',
        id: 's',
        metadata: { importSbom: 'true' },
      }),
    ).toEqual(['import/p/s.sarif']);
  });
});

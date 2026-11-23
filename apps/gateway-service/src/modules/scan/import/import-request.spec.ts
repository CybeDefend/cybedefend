import { HttpException } from '@nestjs/common';
import {
  checkImportFile,
  checkImportSbom,
  IMPORT_IMAGE_MAX_LENGTH,
  IMPORT_TYPES,
  ImportType,
  importSourceType,
  parseImportFields,
} from './import-request';
import { IMPORT_REQUEST_CODES } from './import-errors';

/** The HTTP status and body code of what `fn` throws. */
function refusal(fn: () => unknown): { status: number; code: unknown } {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const http = error as HttpException;
    const body = http.getResponse() as { code?: unknown; message?: unknown };
    return { status: http.getStatus(), code: body.code };
  }
  throw new Error('expected a refusal');
}

const refusedWith = (fn: () => unknown, code: string) =>
  expect(refusal(fn)).toEqual({ status: 400, code });

describe('import-errors', () => {
  it('lists the twelve route codes of the contract', () => {
    expect([...IMPORT_REQUEST_CODES]).toEqual([
      'IMPORT_INVALID_REQUEST',
      'IMPORT_UNSUPPORTED_FORMAT',
      'IMPORT_UNSUPPORTED_FILE',
      'IMPORT_INVALID_SARIF',
      'IMPORT_UPLOAD_TOO_LARGE',
      'IMPORT_BUSY',
      'IMPORT_STORAGE_UNAVAILABLE',
      'IMPORT_UNAVAILABLE',
      'IMPORT_IMAGE_REQUIRED',
      'IMPORT_IMAGE_INVALID',
      'IMPORT_TYPE_NOT_AVAILABLE',
      'IMPORT_INVALID_SBOM',
    ]);
  });
});

describe('parseImportFields', () => {
  const C = 'community' as const;

  it('accepts a valid request and drops refs/heads/', () => {
    expect(
      parseImportFields({ type: 'iac', branch: 'refs/heads/main' }, C),
    ).toEqual({ type: 'iac', branch: 'main', format: 'sarif' });
  });

  it('trims the branch', () => {
    expect(parseImportFields({ type: 'sast', branch: '  dev ' }, C)).toEqual({
      type: 'sast',
      branch: 'dev',
      format: 'sarif',
    });
  });

  it('refuses a missing or unknown type', () => {
    refusedWith(
      () => parseImportFields({ branch: 'main' }, C),
      'IMPORT_INVALID_REQUEST',
    );
    refusedWith(
      () => parseImportFields({ type: 'dast', branch: 'main' }, C),
      'IMPORT_INVALID_REQUEST',
    );
    refusedWith(
      () => parseImportFields({ type: 'SAST', branch: 'main' }, C),
      'IMPORT_INVALID_REQUEST',
    );
    refusedWith(
      () => parseImportFields({ type: 'constructor', branch: 'main' }, C),
      'IMPORT_INVALID_REQUEST',
    );
  });

  it('requires a branch of 1 to 255 characters without control characters', () => {
    refusedWith(
      () => parseImportFields({ type: 'sast' }, C),
      'IMPORT_INVALID_REQUEST',
    );
    refusedWith(
      () => parseImportFields({ type: 'sast', branch: '   ' }, C),
      'IMPORT_INVALID_REQUEST',
    );
    refusedWith(
      () => parseImportFields({ type: 'sast', branch: 'refs/heads/' }, C),
      'IMPORT_INVALID_REQUEST',
    );
    refusedWith(
      () => parseImportFields({ type: 'sast', branch: 'a'.repeat(256) }, C),
      'IMPORT_INVALID_REQUEST',
    );
    expect(
      parseImportFields({ type: 'sast', branch: 'a'.repeat(255) }, C).branch,
    ).toBe('a'.repeat(255));
    refusedWith(
      () => parseImportFields({ type: 'sast', branch: 'ma\u0000in' }, C),
      'IMPORT_INVALID_REQUEST',
    );
    refusedWith(
      () => parseImportFields({ type: 'sast', branch: 'ma\u001fin' }, C),
      'IMPORT_INVALID_REQUEST',
    );
  });

  it('validates the commit, then drops it', () => {
    const fields = parseImportFields(
      { type: 'sast', branch: 'main', commit: 'ABCDEF1' },
      C,
    );
    expect(fields).toEqual({ type: 'sast', branch: 'main', format: 'sarif' });
    expect('commit' in fields).toBe(false);
    expect(
      parseImportFields(
        { type: 'sast', branch: 'main', commit: 'a'.repeat(40) },
        C,
      ),
    ).toEqual({ type: 'sast', branch: 'main', format: 'sarif' });
    for (const commit of ['abc12', 'a'.repeat(41), 'zzzzzzz', '', ' abcdef1']) {
      refusedWith(
        () => parseImportFields({ type: 'sast', branch: 'main', commit }, C),
        'IMPORT_INVALID_REQUEST',
      );
    }
  });

  it('accepts no format or sarif, and refuses any other', () => {
    expect(
      parseImportFields({ type: 'sast', branch: 'main', format: 'sarif' }, C)
        .format,
    ).toBe('sarif');
    for (const format of ['cyclonedx', 'SARIF', '']) {
      refusedWith(
        () => parseImportFields({ type: 'sast', branch: 'main', format }, C),
        'IMPORT_UNSUPPORTED_FORMAT',
      );
    }
  });

  it('refuses any other field name', () => {
    for (const name of ['extra', 'file', 'tool', '__proto__']) {
      refusedWith(
        () =>
          parseImportFields(
            Object.assign(Object.create(null), {
              type: 'sast',
              branch: 'main',
              [name]: 'x',
            }),
            C,
          ),
        'IMPORT_INVALID_REQUEST',
      );
    }
  });

  describe('types and edition', () => {
    const imageFor = (type: ImportType) =>
      type === 'container' ? { image: 'alpine:3.18' } : {};

    it('accepts the six types in the Community Edition', () => {
      for (const type of IMPORT_TYPES) {
        expect(
          parseImportFields({ type, branch: 'main', ...imageFor(type) }, C)
            .type,
        ).toBe(type);
      }
    });

    // The SARIF import is a Community Edition feature.
    // Every other edition refuses every request, whatever it holds.
    it('refuses the six types outside the Community Edition', () => {
      for (const edition of ['cloud', 'enterprise'] as const) {
        for (const type of IMPORT_TYPES) {
          refusedWith(
            () =>
              parseImportFields(
                { type, branch: 'main', ...imageFor(type) },
                edition,
              ),
            'IMPORT_TYPE_NOT_AVAILABLE',
          );
          refusedWith(
            () => parseImportFields({ type, branch: 'main' }, edition),
            'IMPORT_TYPE_NOT_AVAILABLE',
          );
        }
      }
    });

    it('checks the edition before any other field outside the Community Edition', () => {
      for (const edition of ['cloud', 'enterprise'] as const) {
        refusedWith(
          () => parseImportFields({}, edition),
          'IMPORT_TYPE_NOT_AVAILABLE',
        );
        refusedWith(
          () => parseImportFields({ type: 'dast', branch: '' }, edition),
          'IMPORT_TYPE_NOT_AVAILABLE',
        );
      }
    });

    // The unset-edition case (cloud) is tested by the cloud edition: the
    // Community tree fixes the edition to community.
    describe('defaults to currentEdition()', () => {
      const saved = process.env.CYBEDEFEND_EDITION;
      afterEach(() => {
        if (saved === undefined) delete process.env.CYBEDEFEND_EDITION;
        else process.env.CYBEDEFEND_EDITION = saved;
      });

      it('accepts sca when CYBEDEFEND_EDITION is community', () => {
        process.env.CYBEDEFEND_EDITION = 'community';
        expect(parseImportFields({ type: 'sca', branch: 'main' }).type).toBe(
          'sca',
        );
      });
    });
  });

  describe('image', () => {
    it('requires the image for a container import', () => {
      refusedWith(
        () => parseImportFields({ type: 'container', branch: 'main' }, C),
        'IMPORT_IMAGE_REQUIRED',
      );
      refusedWith(
        () =>
          parseImportFields(
            { type: 'container', branch: 'main', image: '' },
            C,
          ),
        'IMPORT_IMAGE_REQUIRED',
      );
    });

    it('refuses an image with any other type', () => {
      for (const type of ['sca', 'sast']) {
        refusedWith(
          () =>
            parseImportFields(
              { type, branch: 'main', image: 'alpine:3.18' },
              C,
            ),
          'IMPORT_INVALID_REQUEST',
        );
        refusedWith(
          () => parseImportFields({ type, branch: 'main', image: '' }, C),
          'IMPORT_INVALID_REQUEST',
        );
      }
    });

    it('accepts the image references of the contract', () => {
      for (const image of [
        'alpine',
        'alpine:3.18.0',
        'ghcr.io/example/api:2.0.1',
        'localhost:5000/team/app:v1',
        'registry.example.com/app@sha256:' + 'a'.repeat(64),
        'nginx:1.25@sha256:' + 'b'.repeat(64),
      ]) {
        expect(
          parseImportFields({ type: 'container', branch: 'main', image }, C),
        ).toEqual({
          type: 'container',
          branch: 'main',
          format: 'sarif',
          image,
        });
      }
    });

    it('refuses an invalid image', () => {
      for (const image of [
        'Alpine:3.18',
        'alpine:',
        ' alpine',
        'alpine:3.18 ',
        'alpine@sha256:abc',
        'http://x/y',
        'alpine\n',
      ]) {
        refusedWith(
          () =>
            parseImportFields({ type: 'container', branch: 'main', image }, C),
          'IMPORT_IMAGE_INVALID',
        );
      }
    });

    it('refuses an image longer than 255 characters', () => {
      expect(IMPORT_IMAGE_MAX_LENGTH).toBe(255);
      refusedWith(
        () =>
          parseImportFields(
            { type: 'container', branch: 'main', image: 'a'.repeat(256) },
            C,
          ),
        'IMPORT_IMAGE_INVALID',
      );
      expect(
        parseImportFields(
          { type: 'container', branch: 'main', image: 'a'.repeat(255) },
          C,
        ).image,
      ).toBe('a'.repeat(255));
    });

    it('checks the edition before the image', () => {
      refusedWith(
        () => parseImportFields({ type: 'container', branch: 'main' }, 'cloud'),
        'IMPORT_TYPE_NOT_AVAILABLE',
      );
    });
  });
});

describe('checkImportFile', () => {
  const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);

  it('takes a .sarif.gz file whose bytes are gzip, whatever the case', () => {
    expect(checkImportFile('r.SARIF.GZ', gz)).toEqual({ gzip: true });
  });

  it('refuses a .sarif.gz file whose bytes are not gzip', () => {
    refusedWith(
      () => checkImportFile('r.sarif.gz', Buffer.from('{')),
      'IMPORT_INVALID_SARIF',
    );
    refusedWith(
      () => checkImportFile('r.sarif.gz', Buffer.from([0x1f])),
      'IMPORT_INVALID_SARIF',
    );
  });

  it('takes a .json or .sarif file starting with { after a BOM and whitespace', () => {
    expect(
      checkImportFile(
        'r.json',
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\n {')]),
      ),
    ).toEqual({ gzip: false });
    expect(checkImportFile('results.sarif', Buffer.from('{"a"'))).toEqual({
      gzip: false,
    });
    expect(checkImportFile('R.Sarif', Buffer.from('\t\r\n{'))).toEqual({
      gzip: false,
    });
  });

  it('refuses a plain file that does not start with {', () => {
    refusedWith(
      () => checkImportFile('r.sarif', Buffer.from('[{}]')),
      'IMPORT_INVALID_SARIF',
    );
    refusedWith(() => checkImportFile('r.sarif', gz), 'IMPORT_INVALID_SARIF');
    refusedWith(
      () => checkImportFile('r.json', Buffer.from('   ')),
      'IMPORT_INVALID_SARIF',
    );
  });

  it('refuses any other extension', () => {
    for (const name of [
      'r.txt',
      'r.gz',
      'r.sarif.zip',
      'sarif',
      '',
      'r.json.gz',
    ]) {
      refusedWith(
        () => checkImportFile(name, Buffer.from('{')),
        'IMPORT_UNSUPPORTED_FILE',
      );
    }
  });

  it('refuses an empty file', () => {
    refusedWith(
      () => checkImportFile('r.sarif', Buffer.alloc(0)),
      'IMPORT_INVALID_SARIF',
    );
    refusedWith(
      () => checkImportFile('r.sarif.gz', Buffer.alloc(0)),
      'IMPORT_INVALID_SARIF',
    );
  });
});

describe('checkImportSbom', () => {
  const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00]);

  it('takes a CycloneDX JSON file of an sca import, gzip or not', () => {
    expect(checkImportSbom('sca', 'bom.cdx.json', Buffer.from(' {'))).toEqual({
      gzip: false,
    });
    expect(checkImportSbom('sca', 'BOM.JSON', Buffer.from('{'))).toEqual({
      gzip: false,
    });
    expect(checkImportSbom('sca', 'bom.cdx.json.gz', gz)).toEqual({
      gzip: true,
    });
  });

  it('refuses an SBOM with any other import type, before reading it', () => {
    for (const type of [
      'sast',
      'iac',
      'secret',
      'cicd',
      'container',
    ] as const) {
      refusedWith(
        () => checkImportSbom(type, 'bom.cdx.json', Buffer.from('{')),
        'IMPORT_INVALID_REQUEST',
      );
    }
  });

  it('refuses another name, a JSON file that is no object, an empty or a mislabelled gzip one', () => {
    for (const [name, head] of [
      ['bom.xml', Buffer.from('<bom/>')],
      ['bom.spdx', Buffer.from('{')],
      ['bom.sarif', Buffer.from('{')],
      ['bom.json', Buffer.from('[]')],
      ['bom.json', Buffer.alloc(0)],
      ['bom.json.gz', Buffer.from('{')],
      ['bom.json', gz],
    ] as const) {
      refusedWith(
        () => checkImportSbom('sca', name, head),
        'IMPORT_INVALID_SBOM',
      );
    }
  });
});

describe('importSourceType', () => {
  it('reads the CLI and the scanner images as cli', () => {
    expect(importSourceType('cybedefend-cli/1.2.0')).toBe('cli');
    expect(importSourceType('cybedefend-scanner/1.0.0')).toBe('cli');
  });

  it('reads a browser, anything else or nothing as manual', () => {
    expect(
      importSourceType(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      ),
    ).toBe('manual');
    expect(importSourceType('curl/8.4.0 cybedefend-cli/1.2.0')).toBe('manual');
    expect(importSourceType(undefined)).toBe('manual');
    expect(importSourceType('')).toBe('manual');
  });
});

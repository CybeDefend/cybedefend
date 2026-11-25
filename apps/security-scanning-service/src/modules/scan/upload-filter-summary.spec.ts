import {
  MAX_STORED_EXCLUDED_FOLDERS,
  MAX_STORED_FOLDER_NAME_LENGTH,
  boundUploadFilterSummary,
} from './upload-filter-summary';

const VALID = {
  scannerConfiguration: 1,
  excludedPath: 5,
  excludedType: 2,
  unsafeName: 0,
  gitMetadata: 0,
  excludedFolders: [
    { name: 'build', count: 3 },
    { name: 'web/dist', count: 1 },
  ],
};

describe('boundUploadFilterSummary', () => {
  it('keeps a well-formed summary as sent', () => {
    expect(boundUploadFilterSummary(VALID)).toEqual(VALID);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['not an object', 'build'],
    ['an array', [VALID]],
  ])('records no summary when it is %s', (_label, input) => {
    expect(boundUploadFilterSummary(input)).toBeNull();
  });

  it.each([
    ['a negative count', { ...VALID, excludedPath: -1 }],
    ['a fractional count', { ...VALID, excludedType: 1.5 }],
    ['a count that is not a number', { ...VALID, unsafeName: '3' }],
    ['an infinite count', { ...VALID, gitMetadata: Infinity }],
    ['a count past the int32 range', { ...VALID, excludedPath: 2 ** 31 }],
  ])('refuses a summary with %s', (_label, input) => {
    expect(boundUploadFilterSummary(input)).toBeNull();
  });

  it('reads a missing count as zero and a missing folder list as empty', () => {
    expect(boundUploadFilterSummary({ excludedPath: 2 })).toEqual({
      scannerConfiguration: 0,
      excludedPath: 2,
      excludedType: 0,
      unsafeName: 0,
      gitMetadata: 0,
      excludedFolders: [],
    });
  });

  it('keeps the 20 largest folders of a list too long, the largest first', () => {
    const excludedFolders = Array.from({ length: 500 }, (_, i) => ({
      name: `pkg${i}/build`,
      count: i + 1,
    }));
    const bounded = boundUploadFilterSummary({ ...VALID, excludedFolders });
    expect(MAX_STORED_EXCLUDED_FOLDERS).toBe(20);
    expect(bounded?.excludedFolders).toHaveLength(20);
    expect(bounded?.excludedFolders[0]).toEqual({
      name: 'pkg499/build',
      count: 500,
    });
    expect(bounded?.excludedFolders[19].count).toBe(481);
  });

  it('cuts a folder name too long to 200 characters', () => {
    const bounded = boundUploadFilterSummary({
      ...VALID,
      excludedFolders: [{ name: 'a'.repeat(100_000), count: 1 }],
    });
    expect(MAX_STORED_FOLDER_NAME_LENGTH).toBe(200);
    expect(bounded?.excludedFolders[0].name).toBe('a'.repeat(200));
  });

  it('removes control characters, NUL included, from folder names', () => {
    const bounded = boundUploadFilterSummary({
      ...VALID,
      excludedFolders: [
        { name: 'a\u0000b/build', count: 2 },
        { name: 'line\nbreak\r\t/dist\u007f\u0085', count: 1 },
      ],
    });
    expect(bounded?.excludedFolders).toEqual([
      { name: 'ab/build', count: 2 },
      { name: 'linebreak/dist', count: 1 },
    ]);
  });

  it('removes bidirectional control characters from folder names', () => {
    const bounded = boundUploadFilterSummary({
      ...VALID,
      excludedFolders: [
        {
          name: '\u202Eevil\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069\u200E\u200F\u061C/build',
          count: 1,
        },
      ],
    });
    expect(bounded?.excludedFolders).toEqual([
      { name: 'evil/build', count: 1 },
    ]);
  });

  it('drops a folder whose name holds only control characters', () => {
    const bounded = boundUploadFilterSummary({
      ...VALID,
      excludedFolders: [
        { name: '\u0000\u202E', count: 4 },
        { name: 'build', count: 1 },
      ],
    });
    expect(bounded?.excludedFolders).toEqual([{ name: 'build', count: 1 }]);
  });

  it('drops a folder entry that is malformed, keeping the others', () => {
    const bounded = boundUploadFilterSummary({
      ...VALID,
      excludedFolders: [
        { name: 'build', count: 3 },
        { name: '', count: 2 },
        { name: 'dist', count: -4 },
        { name: 42, count: 1 },
        null,
        'out',
        { name: 'out', count: 1, content: 'not stored' },
      ],
    });
    expect(bounded?.excludedFolders).toEqual([
      { name: 'build', count: 3 },
      { name: 'out', count: 1 },
    ]);
  });

  it('stores no field the summary does not define', () => {
    const bounded = boundUploadFilterSummary({
      ...VALID,
      files: ['build/app.js'],
    }) as unknown as Record<string, unknown>;
    expect(Object.keys(bounded).sort()).toEqual([
      'excludedFolders',
      'excludedPath',
      'excludedType',
      'gitMetadata',
      'scannerConfiguration',
      'unsafeName',
    ]);
  });
});

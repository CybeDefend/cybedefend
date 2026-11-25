import {
  MAX_EXCLUDED_FOLDERS,
  MAX_FOLDER_NAME_LENGTH,
  UploadFilterSummaryBuilder,
  excludedFolderOf,
} from './upload-filter-summary';

describe('excludedFolderOf', () => {
  it.each([
    ['build/app.js', 'build'],
    ['dist/a/b/c.js', 'dist'],
    ['web/build/app.js', 'web/build'],
    ['apps/api/node_modules/dep/index.js', 'apps/api/node_modules'],
    ['app/env/handlers.py', 'app/env'],
    ['src/Build/app.js', 'src/Build'],
    ['node_modules/a/node_modules/b.js', 'node_modules'],
  ])('names the outermost excluded folder of %s', (entry, folder) => {
    expect(excludedFolderOf(entry)).toBe(folder);
  });

  it.each([['deploy/prod.log'], ['static/jquery.min.js'], ['build']])(
    'names no folder for %s, left out for its name or type',
    (entry) => {
      expect(excludedFolderOf(entry)).toBeNull();
    },
  );
});

describe('UploadFilterSummaryBuilder', () => {
  it('counts each reason and the files of each excluded folder', () => {
    const builder = new UploadFilterSummaryBuilder();
    builder.excludedPath('build/a.js');
    builder.excludedPath('build/b.js');
    builder.excludedPath('dist/c.js');
    builder.excludedPath('deploy/prod.log');
    builder.excludedType();
    builder.scannerConfiguration();
    builder.scannerConfiguration();
    builder.unsafeName();
    builder.gitMetadata();

    expect(builder.summary()).toEqual({
      scannerConfiguration: 2,
      excludedPath: 4,
      excludedType: 1,
      unsafeName: 1,
      gitMetadata: 1,
      excludedFolders: [
        { name: 'build', count: 2 },
        { name: 'dist', count: 1 },
      ],
    });
  });

  it('keeps the 20 folders that hold the most files, the largest first', () => {
    const builder = new UploadFilterSummaryBuilder();
    for (let i = 0; i < 30; i++) {
      for (let n = 0; n <= i; n++) {
        builder.excludedPath(`pkg${String(i).padStart(2, '0')}/build/f${n}.js`);
      }
    }
    const summary = builder.summary();

    expect(MAX_EXCLUDED_FOLDERS).toBe(20);
    expect(summary.excludedFolders).toHaveLength(20);
    expect(summary.excludedFolders[0]).toEqual({
      name: 'pkg29/build',
      count: 30,
    });
    expect(summary.excludedFolders[19]).toEqual({
      name: 'pkg10/build',
      count: 11,
    });
    // Every file left out is still counted, its folder listed or not.
    expect(summary.excludedPath).toBe((30 * 31) / 2);
  });

  it('orders folders of the same count by name', () => {
    const builder = new UploadFilterSummaryBuilder();
    builder.excludedPath('b/dist/x.js');
    builder.excludedPath('a/dist/x.js');
    expect(builder.summary().excludedFolders.map((f) => f.name)).toEqual([
      'a/dist',
      'b/dist',
    ]);
  });

  it('cuts a folder name to 200 characters', () => {
    const builder = new UploadFilterSummaryBuilder();
    const deep = `${'x'.repeat(150)}/${'y'.repeat(150)}`;
    builder.excludedPath(`${deep}/build/a.js`);
    builder.excludedPath(`${deep}/build/b.js`);
    const [folder] = builder.summary().excludedFolders;

    expect(MAX_FOLDER_NAME_LENGTH).toBe(200);
    expect(folder.name).toHaveLength(200);
    expect(deep.startsWith(folder.name)).toBe(true);
    expect(folder.count).toBe(2);
  });

  it('never cuts a character in two', () => {
    const builder = new UploadFilterSummaryBuilder();
    builder.excludedPath(`${'é'.repeat(199)}😀😀/build/a.js`);
    const [folder] = builder.summary().excludedFolders;
    expect([...folder.name]).toHaveLength(200);
    expect(folder.name.endsWith('😀')).toBe(true);
  });

  it('says nothing was left out when nothing was', () => {
    expect(new UploadFilterSummaryBuilder().summary()).toEqual({
      scannerConfiguration: 0,
      excludedPath: 0,
      excludedType: 0,
      unsafeName: 0,
      gitMetadata: 0,
      excludedFolders: [],
    });
  });
});

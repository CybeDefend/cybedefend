// Jest transformer for the specs: ts-jest, after making the ESM files of
// node_modules that Jest transforms (the @nestjs/* packages, see
// transformIgnorePatterns) valid once turned into CommonJS.
//
// The NestJS packages ship as ESM only. Jest runs the specs as CommonJS, so
// they are transformed like the sources. Two ESM forms have no CommonJS
// meaning and are rewritten first:
//   - `const require = createRequire(import.meta.url)` rebuilds the module's
//     own require, which CommonJS already has (and would declare twice);
//   - any other `import.meta.url` is the module's file URL.
// Node's VM modules (--experimental-vm-modules) would load the ESM as is, but
// keep every module of every spec file alive until the heap runs out.
//
// The same file sits in every NestJS service (scripts/tests/nest-jest-esm.bats).
const { TsJestTransformer } = require('ts-jest');

const OWN_REQUIRE =
  /^\s*(?:const|let|var)\s+require\s*=\s*createRequire\(\s*import\.meta\.url\s*\)\s*;?\s*$/gm;
const IMPORT_META_URL = /\bimport\.meta\.url\b/g;
const FILE_URL = "require('node:url').pathToFileURL(__filename).href";

class EsmNodeModulesTransformer extends TsJestTransformer {
  rewrite(source, filePath) {
    if (!filePath.includes('/node_modules/')) return source;
    return source.replace(OWN_REQUIRE, '').replace(IMPORT_META_URL, FILE_URL);
  }

  process(source, filePath, options) {
    return super.process(this.rewrite(source, filePath), filePath, options);
  }

  processAsync(source, filePath, options) {
    return super.processAsync(this.rewrite(source, filePath), filePath, options);
  }

  getCacheKey(source, filePath, options) {
    return super.getCacheKey(this.rewrite(source, filePath), filePath, options);
  }
}

module.exports = {
  createTransformer: (config) => new EsmNodeModulesTransformer(config),
};

/**
 * Unit tests for the file filtering system
 */

import { shouldExcludeFile, getFilterStatistics } from './filter-patterns';

describe('Filter Patterns', () => {
  describe('shouldExcludeFile', () => {
    // Tests for important files that should always be kept
    it('should KEEP important lock files', () => {
      expect(shouldExcludeFile('package-lock.json')).toBe(false);
      expect(shouldExcludeFile('yarn.lock')).toBe(false);
      expect(shouldExcludeFile('composer.lock')).toBe(false);
      expect(shouldExcludeFile('go.mod')).toBe(false);
      expect(shouldExcludeFile('Cargo.lock')).toBe(false);
    });

    // Tests for directories to exclude
    it('should EXCLUDE dependency directories', () => {
      expect(
        shouldExcludeFile('project/node_modules/some-package/index.js'),
      ).toBe(true);
      expect(shouldExcludeFile('app/vendor/symfony/component.php')).toBe(true);
      expect(shouldExcludeFile('src/__pycache__/module.pyc')).toBe(true);
      expect(
        shouldExcludeFile('.venv/lib/python3.9/site-packages/package'),
      ).toBe(true);
    });

    // Tests for build directories
    it('should EXCLUDE build directories and outputs', () => {
      expect(shouldExcludeFile('project/dist/bundle.js')).toBe(true);
      expect(shouldExcludeFile('app/build/main.js')).toBe(true);
      expect(shouldExcludeFile('target/classes/Main.class')).toBe(true);
      expect(shouldExcludeFile('.next/static/chunks/main.js')).toBe(true);
    });

    // Tests for system files
    it('should EXCLUDE system files', () => {
      expect(shouldExcludeFile('.DS_Store')).toBe(true);
      expect(shouldExcludeFile('Thumbs.db')).toBe(true);
    });

    // .vscode and .idea are NOT excluded (kept for secret scanning)
    it('should KEEP .vscode and .idea files', () => {
      expect(shouldExcludeFile('project/.vscode/settings.json')).toBe(false);
      expect(shouldExcludeFile('app/.idea/workspace.xml')).toBe(false);
    });

    // Tests for extensions to exclude
    it('should EXCLUDE compiled and temporary files', () => {
      expect(shouldExcludeFile('module.pyc')).toBe(true);
      expect(shouldExcludeFile('Main.class')).toBe(true);
      expect(shouldExcludeFile('app.log')).toBe(true);
      expect(shouldExcludeFile('temp.tmp')).toBe(true);
    });

    // Tests for source code files that should be kept
    it('should KEEP source code files', () => {
      expect(shouldExcludeFile('src/main.js')).toBe(false);
      expect(shouldExcludeFile('app/controller.php')).toBe(false);
      expect(shouldExcludeFile('lib/module.py')).toBe(false);
      expect(shouldExcludeFile('Main.java')).toBe(false);
      expect(shouldExcludeFile('component.ts')).toBe(false);
    });

    // Tests for edge cases with lock files in subdirectories
    it('should KEEP lock files even in subdirectories', () => {
      expect(shouldExcludeFile('frontend/package-lock.json')).toBe(false);
      expect(shouldExcludeFile('backend/composer.lock')).toBe(false);
    });

    // Regression: monorepos (Goatlin, Lerna, Yarn workspaces, npm workspaces,
    // pnpm workspaces) commonly use a top-level `packages/` directory for
    // source code. The previous `packages` directory exclusion (originally for
    // .NET NuGet caches) wrongly nuked the entire source tree of every Kotlin /
    // Android / multi-package JS monorepo. .NET binary noise from NuGet caches
    // is already handled by binary extension filters.
    it('should KEEP source files inside top-level packages/ monorepo dir', () => {
      // Goatlin Kotlin sources
      expect(
        shouldExcludeFile(
          'packages/clients/android/app/src/main/java/com/cx/goatlin/MainActivity.kt',
        ),
      ).toBe(false);
      // Goatlin Node.js services
      expect(shouldExcludeFile('packages/services/index.js')).toBe(false);
      // Lerna / Yarn workspaces style
      expect(shouldExcludeFile('packages/web/src/App.tsx')).toBe(false);
      expect(shouldExcludeFile('packages/api/src/main.py')).toBe(false);
    });
  });

  describe('getFilterStatistics', () => {
    it('should correctly calculate filtering statistics', () => {
      const testFiles = [
        'src/main.js', // KEEP - source code
        'package-lock.json', // KEEP - important file
        'node_modules/react/index.js', // EXCLUDE - dependency
        'dist/bundle.js', // EXCLUDE - build
        'app.log', // EXCLUDE - log
        'lib/utils.ts', // KEEP - source code
        '.DS_Store', // EXCLUDE - system
      ];

      const stats = getFilterStatistics(testFiles);

      expect(stats.total).toBe(7);
      expect(stats.kept).toBe(3);
      expect(stats.excluded).toBe(4);
      expect(Object.keys(stats.excludedByCategory).length).toBeGreaterThan(0);
    });
  });
});

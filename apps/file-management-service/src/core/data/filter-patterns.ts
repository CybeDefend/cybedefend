/**
 * File filtering patterns for security scanning
 *
 * SIMPLE PRINCIPLE:
 * 1. KEEP all source code (already handled by extensionToLanguageMap + validFilesWithoutExtension)
 * 2. EXCLUDE only temporary files, dependencies and build outputs
 * 3. KEEP important configuration files (lock files, etc.)
 */

export interface FilterPattern {
  pattern: string;
  type: 'directory' | 'file' | 'extension';
  description: string;
}

/**
 * Patterns for directories and files to EXCLUDE from scanning
 * These are typically temporary files, dependencies, or build outputs
 */
export const excludePatterns: FilterPattern[] = [
  // DEPENDENCIES - DIRECTORIES
  {
    pattern: 'node_modules',
    type: 'directory',
    description: 'Node.js dependencies',
  },
  {
    pattern: 'vendor',
    type: 'directory',
    description: 'PHP/Ruby/Go dependencies',
  },
  // NOTE: Do NOT exclude `packages/` as a directory pattern.
  // It was originally added for .NET NuGet caches, but `packages/` is also a
  // common top-level directory for monorepos (Goatlin, Lerna, Yarn workspaces,
  // npm workspaces, pnpm workspaces) where it holds source code, not deps.
  // NuGet binary noise (.dll, .exe, .pdb) is already handled by the binary
  // extension filters; legitimate source under `packages/<workspace>/` must
  // pass through for parsing and the Code Knowledge Graph to work.
  {
    pattern: '.gradle',
    type: 'directory',
    description: 'Gradle cache and wrapper',
  },
  { pattern: '.mvn', type: 'directory', description: 'Maven wrapper' },
  {
    pattern: '__pycache__',
    type: 'directory',
    description: 'Python bytecode cache',
  },
  {
    pattern: '.venv',
    type: 'directory',
    description: 'Python virtual environment',
  },
  {
    pattern: 'venv',
    type: 'directory',
    description: 'Python virtual environment',
  },
  {
    pattern: 'env',
    type: 'directory',
    description: 'Python virtual environment',
  },

  // BUILD AND COMPILATION OUTPUTS
  {
    pattern: 'dist',
    type: 'directory',
    description: 'Distribution/build output',
  },
  { pattern: 'build', type: 'directory', description: 'Build output' },
  { pattern: 'out', type: 'directory', description: 'Output directory' },
  { pattern: 'bin', type: 'directory', description: 'Binary output' },
  { pattern: 'obj', type: 'directory', description: '.NET object files' },
  { pattern: 'target', type: 'directory', description: 'Maven/Rust output' },
  { pattern: '.next', type: 'directory', description: 'Next.js build' },
  { pattern: '.nuxt', type: 'directory', description: 'Nuxt.js build' },

  // VERSION CONTROL
  // NOTE: .git is intentionally NOT excluded here — it must pass through so that
  // gitleaks can run in --log-opts=--all mode for history-based secret scanning.
  {
    pattern: '.svn',
    type: 'directory',
    description: 'Subversion repository data',
  },
  {
    pattern: '.hg',
    type: 'directory',
    description: 'Mercurial repository data',
  },

  // IDE AND EDITORS
  {
    pattern: '.vs',
    type: 'directory',
    description: 'Visual Studio settings',
  },

  // TESTS AND COVERAGE
  {
    pattern: 'coverage',
    type: 'directory',
    description: 'Test coverage reports',
  },
  {
    pattern: '.nyc_output',
    type: 'directory',
    description: 'NYC coverage output',
  },
  { pattern: '.pytest_cache', type: 'directory', description: 'Pytest cache' },

  // CACHE AND TEMPORARY
  { pattern: '.cache', type: 'directory', description: 'Cache directory' },
  { pattern: 'tmp', type: 'directory', description: 'Temporary files' },
  { pattern: 'temp', type: 'directory', description: 'Temporary files' },

  // FILE EXTENSIONS TO EXCLUDE
  { pattern: '.log', type: 'extension', description: 'Log files' },
  { pattern: '.tmp', type: 'extension', description: 'Temporary files' },
  { pattern: '.cache', type: 'extension', description: 'Cache files' },
  {
    pattern: '.pyc',
    type: 'extension',
    description: 'Compiled Python files',
  },
  {
    pattern: '.pyo',
    type: 'extension',
    description: 'Optimized Python files',
  },
  {
    pattern: '.class',
    type: 'extension',
    description: 'Compiled Java files',
  },
  { pattern: '.o', type: 'extension', description: 'C/C++ object files' },
  { pattern: '.obj', type: 'extension', description: 'Object files' },

  // MINIFIED/BUNDLED JAVASCRIPT LIBRARIES
  // These are pre-built libraries, not source code we need to scan
  { pattern: 'preline.js', type: 'file', description: 'Preline UI bundle' },
  {
    pattern: 'preline.min.js',
    type: 'file',
    description: 'Preline UI minified bundle',
  },
  { pattern: 'flowbite.js', type: 'file', description: 'Flowbite UI bundle' },
  {
    pattern: 'flowbite.min.js',
    type: 'file',
    description: 'Flowbite UI minified bundle',
  },
  {
    pattern: 'tailwind.min.js',
    type: 'file',
    description: 'Tailwind minified bundle',
  },
  { pattern: 'alpine.js', type: 'file', description: 'Alpine.js bundle' },
  {
    pattern: 'alpine.min.js',
    type: 'file',
    description: 'Alpine.js minified bundle',
  },
  { pattern: 'htmx.js', type: 'file', description: 'HTMX bundle' },
  { pattern: 'htmx.min.js', type: 'file', description: 'HTMX minified bundle' },
  { pattern: 'jquery.js', type: 'file', description: 'jQuery bundle' },
  {
    pattern: 'jquery.min.js',
    type: 'file',
    description: 'jQuery minified bundle',
  },
  { pattern: 'bootstrap.js', type: 'file', description: 'Bootstrap bundle' },
  {
    pattern: 'bootstrap.min.js',
    type: 'file',
    description: 'Bootstrap minified bundle',
  },
  {
    pattern: 'bootstrap.bundle.js',
    type: 'file',
    description: 'Bootstrap bundle with Popper',
  },
  {
    pattern: 'bootstrap.bundle.min.js',
    type: 'file',
    description: 'Bootstrap minified bundle with Popper',
  },
  { pattern: 'popper.js', type: 'file', description: 'Popper.js bundle' },
  {
    pattern: 'popper.min.js',
    type: 'file',
    description: 'Popper.js minified bundle',
  },
  { pattern: 'vue.js', type: 'file', description: 'Vue.js bundle' },
  {
    pattern: 'vue.min.js',
    type: 'file',
    description: 'Vue.js minified bundle',
  },
  {
    pattern: 'vue.global.js',
    type: 'file',
    description: 'Vue.js global bundle',
  },
  {
    pattern: 'vue.global.min.js',
    type: 'file',
    description: 'Vue.js global minified bundle',
  },
  { pattern: 'react.js', type: 'file', description: 'React bundle' },
  {
    pattern: 'react.min.js',
    type: 'file',
    description: 'React minified bundle',
  },
  {
    pattern: 'react.production.min.js',
    type: 'file',
    description: 'React production bundle',
  },
  { pattern: 'react-dom.js', type: 'file', description: 'React DOM bundle' },
  {
    pattern: 'react-dom.min.js',
    type: 'file',
    description: 'React DOM minified bundle',
  },
  {
    pattern: 'react-dom.production.min.js',
    type: 'file',
    description: 'React DOM production bundle',
  },
  { pattern: 'angular.js', type: 'file', description: 'Angular.js bundle' },
  {
    pattern: 'angular.min.js',
    type: 'file',
    description: 'Angular.js minified bundle',
  },
  { pattern: 'lodash.js', type: 'file', description: 'Lodash bundle' },
  {
    pattern: 'lodash.min.js',
    type: 'file',
    description: 'Lodash minified bundle',
  },
  {
    pattern: 'underscore.js',
    type: 'file',
    description: 'Underscore.js bundle',
  },
  {
    pattern: 'underscore.min.js',
    type: 'file',
    description: 'Underscore.js minified bundle',
  },
  { pattern: 'moment.js', type: 'file', description: 'Moment.js bundle' },
  {
    pattern: 'moment.min.js',
    type: 'file',
    description: 'Moment.js minified bundle',
  },
  { pattern: 'axios.js', type: 'file', description: 'Axios bundle' },
  {
    pattern: 'axios.min.js',
    type: 'file',
    description: 'Axios minified bundle',
  },
  { pattern: 'd3.js', type: 'file', description: 'D3.js bundle' },
  { pattern: 'd3.min.js', type: 'file', description: 'D3.js minified bundle' },
  { pattern: 'chart.js', type: 'file', description: 'Chart.js bundle' },
  {
    pattern: 'chart.min.js',
    type: 'file',
    description: 'Chart.js minified bundle',
  },
  { pattern: 'three.js', type: 'file', description: 'Three.js bundle' },
  {
    pattern: 'three.min.js',
    type: 'file',
    description: 'Three.js minified bundle',
  },
  { pattern: 'socket.io.js', type: 'file', description: 'Socket.IO bundle' },
  {
    pattern: 'socket.io.min.js',
    type: 'file',
    description: 'Socket.IO minified bundle',
  },

  // SYSTEM FILES
  { pattern: '.DS_Store', type: 'file', description: 'macOS system file' },
  {
    pattern: 'Thumbs.db',
    type: 'file',
    description: 'Windows thumbnail cache',
  },
  {
    pattern: 'desktop.ini',
    type: 'file',
    description: 'Windows folder settings',
  },
];

/**
 * Important files to ALWAYS KEEP even if they match an exclusion pattern
 * These files contain dependency information useful for security analysis
 */
export const importantFiles: Set<string> = new Set([
  // Lock files - contain exact dependency versions
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'composer.lock',
  'Pipfile.lock',
  'poetry.lock',
  'Gemfile.lock',
  'go.sum',
  'go.mod',
  'Cargo.lock',
  'Cargo.toml',

  // Dependency configuration files
  'requirements.txt',
  'setup.py',
  'pyproject.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'project.json',
  'packages.config',

  // CybeDefend configuration
  '.cybedefend',
]);

/**
 * Checks if a file should be excluded from scanning
 *
 * LOGIC:
 * 1. If it's an important file -> KEEP (return false)
 * 2. Otherwise, check against exclusion patterns -> EXCLUDE if match (return true)
 * 3. Otherwise -> KEEP (return false)
 *
 * @param filePath - The file path to check
 * @returns true if the file should be excluded, false if it should be kept
 */
export function shouldExcludeFile(filePath: string): boolean {
  const normalizedPath = filePath.replaceAll('\\', '/');
  const pathParts = normalizedPath.split('/');
  const fileName = pathParts.pop() || '';
  const fileExtension = fileName.includes('.')
    ? '.' + fileName.split('.').pop()
    : '';

  // 1. First, check if it's an important file to always keep
  if (importantFiles.has(fileName)) {
    return false; // KEEP this important file
  }

  // 2. Then, check against exclusion patterns
  for (const excludePattern of excludePatterns) {
    switch (excludePattern.type) {
      case 'directory':
        // Check if any part of the path matches the directory pattern
        if (pathParts.includes(excludePattern.pattern)) {
          return true; // EXCLUDE
        }
        break;
      case 'file':
        if (fileName === excludePattern.pattern) {
          return true; // EXCLUDE
        }
        break;
      case 'extension':
        if (fileExtension === excludePattern.pattern) {
          return true; // EXCLUDE
        }
        break;
    }
  }

  // 3. By default, keep the file
  return false;
}

/**
 * Gets statistics on what would be filtered
 * @param filePaths - Array of file paths to analyze
 * @returns Filtering statistics
 */
export function getFilterStatistics(filePaths: string[]): {
  total: number;
  kept: number;
  excluded: number;
  excludedByCategory: Record<string, number>;
} {
  const stats = {
    total: filePaths.length,
    kept: 0,
    excluded: 0,
    excludedByCategory: {} as Record<string, number>,
  };

  for (const filePath of filePaths) {
    if (shouldExcludeFile(filePath)) {
      stats.excluded++;

      // Find which pattern caused the exclusion
      const normalizedPath = filePath.replaceAll('\\', '/');
      const pathParts = normalizedPath.split('/');
      const fileName = pathParts.pop() || '';
      const fileExtension = fileName.includes('.')
        ? '.' + fileName.split('.').pop()
        : '';

      for (const excludePattern of excludePatterns) {
        let matched = false;
        switch (excludePattern.type) {
          case 'directory':
            if (pathParts.includes(excludePattern.pattern)) {
              matched = true;
            }
            break;
          case 'file':
            if (fileName === excludePattern.pattern) {
              matched = true;
            }
            break;
          case 'extension':
            if (fileExtension === excludePattern.pattern) {
              matched = true;
            }
            break;
        }

        if (matched) {
          const category = excludePattern.description;
          stats.excludedByCategory[category] =
            (stats.excludedByCategory[category] || 0) + 1;
          break;
        }
      }
    } else {
      stats.kept++;
    }
  }

  return stats;
}

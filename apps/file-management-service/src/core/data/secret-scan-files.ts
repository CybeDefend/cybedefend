/**
 * Files the uploaded-archive filter keeps for the secret scanner.
 *
 * The filter forwards source code and build files and drops what no scanner
 * reads. Credentials are committed just as often in configuration and data
 * files that no programming language claims (Java `.properties`, Python
 * `setup.cfg`, a `.csv` export, a `notes.txt` in a sub-folder, a `.env.*`
 * variant, a `*.example` copy of a config). Dropped, they are never scanned
 * while the scan still reports success, so they are kept at any depth.
 *
 * The other filters still apply first: media and binary extensions,
 * dependency and build-output directories, logs and caches are dropped.
 */

/** Extensions of configuration and data files where secrets are committed. */
export const SECRET_SCAN_EXTENSIONS: ReadonlySet<string> = new Set([
  '.properties',
  '.cfg',
  '.cnf',
  '.csv',
  '.tsv',
  '.txt',
  '.env',
  '.tfvars',
  '.sql',
  '.xcconfig',
  '.plist',
  '.ovpn',
  '.secret',
  '.secrets',
  '.credentials',
  '.bak',
]);

/**
 * Suffixes of a configuration template kept beside the real file
 * (`database.yml.example`, `settings.ini.dist`): it is often a copy of the
 * real configuration, credentials included.
 */
export const CONFIG_TEMPLATE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.dist',
  '.example',
  '.sample',
  '.template',
  '.tpl',
]);

/** Prefix of the environment files (`.env`, `.env.docker`, `.envrc`…). */
const ENV_FILE_PREFIX = '.env';

/**
 * Whether the secret scanner needs the file named `base` (lower-cased
 * basename) whose last extension is `ext` (lower-cased, with its dot).
 */
export function isSecretScanFile(base: string, ext: string): boolean {
  return (
    base.startsWith(ENV_FILE_PREFIX) ||
    SECRET_SCAN_EXTENSIONS.has(ext) ||
    CONFIG_TEMPLATE_EXTENSIONS.has(ext)
  );
}

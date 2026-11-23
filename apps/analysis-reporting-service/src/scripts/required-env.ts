/**
 * Reads an environment variable a maintenance script cannot run without.
 * Credentials have no fallback: a missing one stops the script with a clear
 * message instead of trying a well-known default password.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set: export it before running this script`);
  }
  return value;
}

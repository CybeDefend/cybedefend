import { ScaDetectedLibrary } from '../../server/interfaces/Vulnerability';
import { BoxOpen, CodeBranch, Link, QuestionCircle } from '@/components/atoms/icon/icons';

/**
 * Determines the package type(s) based on library information
 * @param library - The SCA detected library object
 * @returns Array of package type strings
 */
export function getPackageTypes(library: ScaDetectedLibrary | undefined): string[] {
  if (!library) return ["unknown"];
  
  // If dependencyInfoAvailable is false, we don't have accurate dependency info
  // so don't show any badge
  if (library.dependencyInfoAvailable === false) {
    return [];
  }
  
  const types: string[] = [];
  
  // A package can be both dev AND transitive
  if (library.isDev) {
    types.push("dev");
  }
  
  if (library.isTransitive) {
    types.push("transitive");
  }
  
  // If neither dev nor transitive, it's direct
  if (types.length === 0) {
    types.push("direct");
  }
  
  return types;
}

/**
 * Determines the package type based on library information (legacy - returns first type only)
 * @param library - The SCA detected library object
 * @returns The package type string
 * @deprecated Use getPackageTypes instead for full type support
 */
export function getPackageType(library: ScaDetectedLibrary | undefined): string {
  const types = getPackageTypes(library);
  return types[0];
}

/**
 * Gets the translation key for a package type
 * @param packageType - The package type string
 * @returns The translation key
 */
export function getPackageTypeTranslationKey(packageType: string): string {
  switch (packageType) {
    case "dev":
      return "scaDependencies.dev";
    case "transitive":
      return "scaDependencies.transitive";
    case "direct":
      return "scaDependencies.direct";
    default:
      return "common.unknown";
  }
}

/**
 * Gets the FontAwesome icon name for a package type
 * @param packageType - The package type string
 * @returns The FontAwesome icon name
 */
export function getPackageTypeIcon(packageType: string): string {
  switch (packageType) {
    case "dev":
      return "CodeBranch";
    case "transitive":
      return "Link";
    case "direct":
      return "BoxOpen";
    default:
      return "QuestionCircle";
  }
}

/**
 * Gets the badge styling classes for a package type
 * @param packageType - The package type string
 * @returns The CSS classes for badge styling
 */
export function getPackageTypeBadgeStyle(packageType: string): string {
  switch (packageType) {
    case "dev":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "transitive":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300";
    case "direct":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  }
}

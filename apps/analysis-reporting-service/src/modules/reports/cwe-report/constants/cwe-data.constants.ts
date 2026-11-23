/**
 * CWE Top 25 Most Dangerous Software Weaknesses (2024)
 * Source: https://cwe.mitre.org/top25/
 *
 * This data includes the ranking, KEV (Known Exploited Vulnerabilities) count,
 * and trend information for each CWE.
 */

export interface CweData {
  id: string; // e.g., "CWE-79"
  rank: number; // Current rank (1-25)
  name: string; // Full name
  /** Plain-words name for charts and summaries (e.g. "Path traversal"). */
  shortName?: string;
  description: string; // Short description
  kevCount: number; // Number of CVEs in KEV catalog
  rankLastYear: number; // Previous year's rank
  trend: 'up' | 'down' | 'stable'; // Trend compared to last year
  trendChange: number; // Number of positions moved (positive = up, negative = down)
  /** Short "how to prevent" guidance, condensed from MITRE's mitigations. */
  mitigations?: string[];
}

/**
 * CWE Top 25 2024 data indexed by CWE ID
 */
export const CWE_TOP_25_2024_DATA: Record<string, CweData> = {
  'CWE-79': {
    id: 'CWE-79',
    rank: 1,
    name: "Improper Neutralization of Input During Web Page Generation ('Cross-site Scripting')",
    shortName: 'Cross-site scripting',
    description:
      "The product does not neutralize or incorrectly neutralizes user-controllable input before it is placed in output that is used as a web page served to other users. The injected script then runs in the victim's browser.",
    kevCount: 3,
    rankLastYear: 2,
    trend: 'up',
    trendChange: 1,
    mitigations: [
      'Encode output for its context (HTML, attribute, URL, JavaScript) with a template engine that escapes by default.',
      'Validate input against an allow-list of expected formats.',
      'Set a Content-Security-Policy and mark session cookies HttpOnly.',
    ],
  },
  'CWE-787': {
    id: 'CWE-787',
    rank: 2,
    name: 'Out-of-bounds Write',
    shortName: 'Out-of-bounds write',
    description:
      'The product writes data past the end, or before the beginning, of the intended buffer. This can corrupt data, crash the process or lead to code execution, especially in memory-unsafe languages such as C and C++.',
    kevCount: 18,
    rankLastYear: 1,
    trend: 'down',
    trendChange: -1,
    mitigations: [
      'Prefer memory-safe languages or bounds-checked containers and APIs.',
      'Check lengths and indexes before every write to a buffer.',
      'Build with compiler hardening and fuzz the input parsers.',
    ],
  },
  'CWE-89': {
    id: 'CWE-89',
    rank: 3,
    name: "Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')",
    shortName: 'SQL injection',
    description:
      'The product constructs all or part of an SQL command using externally-influenced input, but does not neutralize or incorrectly neutralizes special elements that could modify the intended SQL command.',
    kevCount: 4,
    rankLastYear: 3,
    trend: 'stable',
    trendChange: 0,
    mitigations: [
      'Use parameterized queries or prepared statements; never build SQL by concatenation.',
      'Allow-list dynamic identifiers such as column names and sort orders.',
      'Run the database account with least privilege.',
    ],
  },
  'CWE-352': {
    id: 'CWE-352',
    rank: 4,
    name: 'Cross-Site Request Forgery (CSRF)',
    shortName: 'CSRF',
    description:
      "The product does not, or cannot, sufficiently verify whether a request was intentionally provided by the user who sent it. An attacker can make the victim's browser perform actions the user did not intend.",
    kevCount: 0,
    rankLastYear: 9,
    trend: 'up',
    trendChange: 5,
    mitigations: [
      'Require an anti-CSRF token on every state-changing request.',
      'Set SameSite on session cookies and check the Origin header.',
      'Never change state on GET requests.',
    ],
  },
  'CWE-22': {
    id: 'CWE-22',
    rank: 5,
    name: "Improper Limitation of a Pathname to a Restricted Directory ('Path Traversal')",
    shortName: 'Path traversal',
    description:
      'The product uses external input to construct a pathname under a restricted parent directory, but does not neutralize special elements such as ../ that can make the pathname resolve outside that directory.',
    kevCount: 4,
    rankLastYear: 8,
    trend: 'up',
    trendChange: 3,
    mitigations: [
      'Resolve the canonical path and check that it stays inside the allowed directory.',
      'Map user input to an allow-list of file identifiers instead of raw paths.',
      'Give the process read access to the files it needs only.',
    ],
  },
  'CWE-125': {
    id: 'CWE-125',
    rank: 6,
    name: 'Out-of-bounds Read',
    shortName: 'Out-of-bounds read',
    description:
      'The product reads data past the end, or before the beginning, of the intended buffer. This can expose sensitive memory or crash the process.',
    kevCount: 3,
    rankLastYear: 7,
    trend: 'up',
    trendChange: 1,
    mitigations: [
      'Check indexes and lengths against the buffer size before every read.',
      'Prefer memory-safe languages or bounds-checked APIs.',
      'Fuzz input parsers and run the tests with memory sanitizers.',
    ],
  },
  'CWE-78': {
    id: 'CWE-78',
    rank: 7,
    name: "Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')",
    shortName: 'OS command injection',
    description:
      'The product constructs all or part of an OS command using externally-influenced input, but does not neutralize or incorrectly neutralizes special elements that could modify the intended OS command.',
    kevCount: 5,
    rankLastYear: 5,
    trend: 'down',
    trendChange: -2,
    mitigations: [
      'Avoid the shell: pass arguments as an array to the program you call.',
      'Allow-list the values accepted for any user-controlled argument.',
      'Run the process with least privilege.',
    ],
  },
  'CWE-416': {
    id: 'CWE-416',
    rank: 8,
    name: 'Use After Free',
    shortName: 'Use after free',
    description:
      'The product reuses or references memory after it has been freed. The memory may have been allocated again, so the stale pointer can crash the program, return unexpected values or lead to code execution.',
    kevCount: 5,
    rankLastYear: 4,
    trend: 'down',
    trendChange: -4,
    mitigations: [
      'Use ownership patterns or smart pointers, and clear pointers after freeing them.',
      'Prefer memory-safe languages for new components.',
      'Run the tests with AddressSanitizer and fuzzing.',
    ],
  },
  'CWE-862': {
    id: 'CWE-862',
    rank: 9,
    name: 'Missing Authorization',
    shortName: 'Missing authorization',
    description:
      'The product does not perform an authorization check when an actor attempts to access a resource or perform an action, so attackers can read data or run actions they are not entitled to.',
    kevCount: 0,
    rankLastYear: 11,
    trend: 'up',
    trendChange: 2,
    mitigations: [
      'Check authorization on the server for every endpoint and every object access.',
      'Deny by default and centralize access control in shared middleware.',
      'Test each resource with users of different roles.',
    ],
  },
  'CWE-434': {
    id: 'CWE-434',
    rank: 10,
    name: 'Unrestricted Upload of File with Dangerous Type',
    shortName: 'Dangerous file upload',
    description:
      'The product allows an attacker to upload or transfer files of dangerous types that can be automatically processed within its environment, which can lead to code execution or system compromise.',
    kevCount: 0,
    rankLastYear: 10,
    trend: 'stable',
    trendChange: 0,
    mitigations: [
      'Allow-list file extensions and verify the actual content type.',
      'Store uploads outside the web root under generated names, and never execute them.',
      'Limit the file size and scan uploaded files.',
    ],
  },
  'CWE-94': {
    id: 'CWE-94',
    rank: 11,
    name: "Improper Control of Generation of Code ('Code Injection')",
    shortName: 'Code injection',
    description:
      'The product constructs all or part of a code segment using externally-influenced input, but does not neutralize or incorrectly neutralizes special elements that could modify the syntax or behavior of the intended code.',
    kevCount: 7,
    rankLastYear: 23,
    trend: 'up',
    trendChange: 12,
    mitigations: [
      'Never pass user input to eval, Function or dynamic code loading.',
      'Parse data with safe parsers (JSON.parse) instead of evaluating it.',
      'Run interpreters with least privilege, in a sandbox where possible.',
    ],
  },
  'CWE-20': {
    id: 'CWE-20',
    rank: 12,
    name: 'Improper Input Validation',
    shortName: 'Input validation',
    description:
      'The product receives input or data, but does not validate or incorrectly validates that the input has the properties required to process the data safely and correctly.',
    kevCount: 1,
    rankLastYear: 6,
    trend: 'down',
    trendChange: -6,
    mitigations: [
      'Validate every input on the server against a strict schema: type, length, range and format.',
      'Prefer allow-lists to deny-lists.',
      'Reject invalid input instead of trying to repair it.',
    ],
  },
  'CWE-77': {
    id: 'CWE-77',
    rank: 13,
    name: "Improper Neutralization of Special Elements used in a Command ('Command Injection')",
    shortName: 'Command injection',
    description:
      'The product constructs all or part of a command using externally-influenced input, but does not neutralize or incorrectly neutralizes special elements that could modify the intended command when it is sent to a downstream component.',
    kevCount: 4,
    rankLastYear: 16,
    trend: 'up',
    trendChange: 3,
    mitigations: [
      'Do not build commands from strings; pass arguments separately to an API that bypasses the shell.',
      'Allow-list commands and argument values.',
      'Run the process with least privilege.',
    ],
  },
  'CWE-287': {
    id: 'CWE-287',
    rank: 14,
    name: 'Improper Authentication',
    shortName: 'Improper authentication',
    description:
      'When an actor claims to have a given identity, the product does not prove or insufficiently proves that the claim is correct, which lets attackers impersonate users or bypass authentication.',
    kevCount: 4,
    rankLastYear: 13,
    trend: 'down',
    trendChange: -1,
    mitigations: [
      'Use a proven authentication framework or identity provider instead of custom code.',
      'Enforce multi-factor authentication, rate limiting and lockout.',
      'Verify the session or token on every request.',
    ],
  },
  'CWE-269': {
    id: 'CWE-269',
    rank: 15,
    name: 'Improper Privilege Management',
    shortName: 'Privilege management',
    description:
      'The product does not properly assign, modify, track, or check privileges for an actor, creating an unintended sphere of control for that actor.',
    kevCount: 0,
    rankLastYear: 22,
    trend: 'up',
    trendChange: 7,
    mitigations: [
      'Apply least privilege to users, services and containers.',
      'Drop elevated privileges as soon as they are no longer needed.',
      'Separate administrative functions and review role assignments.',
    ],
  },
  'CWE-502': {
    id: 'CWE-502',
    rank: 16,
    name: 'Deserialization of Untrusted Data',
    shortName: 'Unsafe deserialization',
    description:
      'The product deserializes untrusted data without sufficiently ensuring that the resulting data will be valid. Crafted input can lead to code execution, denial of service or tampered objects.',
    kevCount: 5,
    rankLastYear: 15,
    trend: 'down',
    trendChange: -1,
    mitigations: [
      'Do not deserialize untrusted data with native object serializers; use data-only formats such as JSON.',
      'Restrict deserialization to an allow-list of types.',
      'Sign serialized data and verify the signature before deserializing.',
    ],
  },
  'CWE-200': {
    id: 'CWE-200',
    rank: 17,
    name: 'Exposure of Sensitive Information to an Unauthorized Actor',
    shortName: 'Information exposure',
    description:
      'The product exposes sensitive information, such as personal data, credentials or system details, to an actor that is not explicitly authorized to have access to it.',
    kevCount: 0,
    rankLastYear: 30,
    trend: 'up',
    trendChange: 13,
    mitigations: [
      'Return generic error messages and keep details in server-side logs.',
      'Disable debug output, stack traces and verbose headers in production.',
      'Return only the fields the caller is authorized to see.',
    ],
  },
  'CWE-863': {
    id: 'CWE-863',
    rank: 18,
    name: 'Incorrect Authorization',
    shortName: 'Incorrect authorization',
    description:
      'The product performs an authorization check when an actor attempts to access a resource or perform an action, but does not correctly perform the check, so the restriction can be bypassed.',
    kevCount: 2,
    rankLastYear: 24,
    trend: 'up',
    trendChange: 6,
    mitigations: [
      'Check authorization against the specific resource and action, not only the role.',
      'Centralize authorization logic and deny by default.',
      'Test horizontal and cross-tenant access.',
    ],
  },
  'CWE-918': {
    id: 'CWE-918',
    rank: 19,
    name: 'Server-Side Request Forgery (SSRF)',
    shortName: 'SSRF',
    description:
      'The product retrieves the contents of a URL received from an upstream component, but does not sufficiently ensure that the request is sent to the expected destination. Attackers can use it to reach internal systems.',
    kevCount: 2,
    rankLastYear: 19,
    trend: 'stable',
    trendChange: 0,
    mitigations: [
      'Allow-list the hosts and schemes the server may call.',
      'Block internal, loopback and cloud metadata addresses after DNS resolution.',
      'Do not return raw responses of fetched URLs to the client.',
    ],
  },
  'CWE-119': {
    id: 'CWE-119',
    rank: 20,
    name: 'Improper Restriction of Operations within the Bounds of a Memory Buffer',
    shortName: 'Memory buffer overflow',
    description:
      'The product performs operations on a memory buffer, but it can read from or write to a memory location outside of the intended boundary of the buffer.',
    kevCount: 2,
    rankLastYear: 17,
    trend: 'down',
    trendChange: -3,
    mitigations: [
      'Use bounds-checked APIs and memory-safe languages where possible.',
      'Check sizes before every copy into a buffer.',
      'Enable compiler and operating system hardening (ASLR, DEP, stack canaries).',
    ],
  },
  'CWE-476': {
    id: 'CWE-476',
    rank: 21,
    name: 'NULL Pointer Dereference',
    shortName: 'NULL pointer dereference',
    description:
      'The product dereferences a pointer that it expects to be valid but is NULL, which typically causes a crash or an exit.',
    kevCount: 0,
    rankLastYear: 12,
    trend: 'down',
    trendChange: -9,
    mitigations: [
      'Check pointers and return values for NULL before use.',
      'Initialize pointers and prefer non-nullable types.',
      'Use static analysis to find unchecked paths.',
    ],
  },
  'CWE-798': {
    id: 'CWE-798',
    rank: 22,
    name: 'Use of Hard-coded Credentials',
    shortName: 'Hard-coded credentials',
    description:
      'The product contains hard-coded credentials, such as a password or cryptographic key, that it uses for its own inbound authentication, outbound communication to external components, or encryption of internal data.',
    kevCount: 2,
    rankLastYear: 18,
    trend: 'down',
    trendChange: -4,
    mitigations: [
      'Remove credentials from the source code and rotate any that were committed.',
      'Load secrets at runtime from a secrets manager.',
      'Scan commits for secrets before they reach the repository.',
    ],
  },
  'CWE-190': {
    id: 'CWE-190',
    rank: 23,
    name: 'Integer Overflow or Wraparound',
    shortName: 'Integer overflow',
    description:
      'The product performs a calculation that can produce an integer overflow or wraparound when the logic assumes that the result will always be larger than the original value. This can lead to buffer overflows or wrong results.',
    kevCount: 3,
    rankLastYear: 14,
    trend: 'down',
    trendChange: -9,
    mitigations: [
      'Check operands against type limits before arithmetic, or use checked arithmetic.',
      'Use wide enough types for sizes and counters.',
      'Validate the range of numeric input.',
    ],
  },
  'CWE-400': {
    id: 'CWE-400',
    rank: 24,
    name: 'Uncontrolled Resource Consumption',
    shortName: 'Resource exhaustion',
    description:
      'The product does not properly control the allocation and maintenance of a limited resource, so an actor can influence the resources consumed and eventually exhaust them, causing a denial of service.',
    kevCount: 0,
    rankLastYear: 37,
    trend: 'up',
    trendChange: 13,
    mitigations: [
      'Limit request size, rate, execution time, memory and CPU.',
      'Set resource quotas on containers and services.',
      'Avoid algorithms whose cost explodes with input size, such as backtracking regular expressions.',
    ],
  },
  'CWE-306': {
    id: 'CWE-306',
    rank: 25,
    name: 'Missing Authentication for Critical Function',
    shortName: 'Missing authentication',
    description:
      'The product does not perform any authentication for functionality that requires a provable user identity or consumes a significant amount of resources.',
    kevCount: 5,
    rankLastYear: 20,
    trend: 'down',
    trendChange: -5,
    mitigations: [
      'Require authentication on every critical function, including internal and admin endpoints.',
      'Deny by default and authenticate in shared middleware or at the gateway.',
      'Inventory exposed endpoints and test them without credentials.',
    ],
  },
};

/**
 * Get CWE data sorted by rank
 */
export function getCweTop25Sorted(): CweData[] {
  return Object.values(CWE_TOP_25_2024_DATA).sort((a, b) => a.rank - b.rank);
}

/**
 * Get CWE IDs only (e.g., ["CWE-79", "CWE-787", ...])
 */
export function getCweIds(): string[] {
  return Object.keys(CWE_TOP_25_2024_DATA);
}

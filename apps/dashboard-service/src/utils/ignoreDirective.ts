/**
 * Builds the inline directive that neutralises ONE CybeDefend rule,
 * e.g. `# cybedefend-ignore[CD-IAC-0123]: <reason>`, written in the comment
 * syntax of the file it goes into. The customer pastes it on the flagged line
 * or on the line directly above it, then replaces `<reason>`.
 *
 * A YAML file under a `templates/` directory is taken for a Helm template and
 * gets a Go-template comment, which Helm strips at render time; a `#` line
 * would be copied into every rendered manifest instead.
 */
const HELM_TEMPLATE_EXTENSIONS = new Set(["yaml", "yml", "tpl"]);

const HASH_EXTENSIONS = new Set([
  "yaml", "yml", "tf", "tfvars", "hcl", "py", "rb", "sh", "bash", "zsh", "toml",
  "ini", "cfg", "conf", "properties", "ps1", "pl", "r", "nix", "cmake", "env",
  "dockerfile",
]);
const HASH_FILE_NAMES = new Set([
  "dockerfile", "containerfile", "makefile", "gemfile", "rakefile", "cmakelists.txt", ".envrc",
]);
const DOUBLE_DASH_EXTENSIONS = new Set(["sql", "lua", "hs"]);
const MARKUP_EXTENSIONS = new Set(["html", "htm", "xml", "svg", "md"]);
const BLOCK_EXTENSIONS = new Set(["css"]);

function usesHashComments(fileName: string, extension: string): boolean {
  return (
    HASH_EXTENSIONS.has(extension) ||
    HASH_FILE_NAMES.has(fileName) ||
    fileName.startsWith("dockerfile.") ||
    // `.env.local`, `.env.production`, `.env.example`…
    fileName.startsWith(".env.") ||
    (fileName.startsWith("requirements") && extension === "txt")
  );
}

export function buildIgnoreDirective(code: string, filePath?: string): string {
  const body = `cybedefend-ignore[${code}]: <reason>`;

  const segments = (filePath ?? "").replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? "";
  const dot = fileName.lastIndexOf(".");
  const extension = dot >= 0 ? fileName.slice(dot + 1) : "";
  const directories = segments.slice(0, -1);

  if (directories.includes("templates") && HELM_TEMPLATE_EXTENSIONS.has(extension)) {
    return `{{- /* ${body} */}}`;
  }
  if (usesHashComments(fileName, extension)) return `# ${body}`;
  if (DOUBLE_DASH_EXTENSIONS.has(extension)) return `-- ${body}`;
  if (MARKUP_EXTENSIONS.has(extension)) return `<!-- ${body} -->`;
  if (BLOCK_EXTENSIONS.has(extension)) return `/* ${body} */`;
  return `// ${body}`;
}

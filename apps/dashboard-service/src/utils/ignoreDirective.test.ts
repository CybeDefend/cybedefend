import { describe, it, expect } from "vitest";
import { buildIgnoreDirective } from "./ignoreDirective";

/**
 * The directive a customer pastes on the flagged line (or the line
 * above) to neutralise ONE CybeDefend rule. It has to be a comment in the
 * language of the file it goes into, or it breaks the file it silences.
 */
const CODE = "CD-IAC-0123";
const BODY = `cybedefend-ignore[${CODE}]: <reason>`;

const FAMILIES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  [
    // Rendered by Helm: a `#` line would leak into every manifest.
    "Helm template",
    `{{- /* ${BODY} */}}`,
    [
      "charts/cybedefend/templates/deployment.yaml",
      "charts/app/templates/configmap.yml",
      "charts/app/templates/_helpers.tpl",
      "templates/job.yaml",
    ],
  ],
  [
    "#",
    `# ${BODY}`,
    [
      "charts/cybedefend/values.yaml",
      ".github/workflows/ci.yml",
      "terraform/modules/storage/main.tf",
      "env/prod.tfvars",
      "packer/image.hcl",
      "app/main.py",
      "lib/task.rb",
      "scripts/deploy.sh",
      "scripts/setup.bash",
      "scripts/prompt.zsh",
      "pyproject.toml",
      "php.ini",
      "setup.cfg",
      "nginx/nginx.conf",
      "src/main/resources/application.properties",
      "tools/build.ps1",
      "tools/report.pl",
      "stats/model.r",
      "shell.nix",
      "cmake/deps.cmake",
      "CMakeLists.txt",
      "native/lib/CMakeLists.txt",
      ".env",
      ".env.local",
      ".env.development.local",
      "config/.env.production",
      ".env.example",
      ".envrc",
      "services/api/.envrc",
      "gateway-service/Dockerfile",
      "analysis-reporting-service/Dockerfile.worker-autofix",
      "docker/api.dockerfile",
      "Containerfile",
      "Makefile",
      "Gemfile",
      "Rakefile",
      "requirements.txt",
      "requirements-dev.txt",
      // `templates` must be a directory, not part of a file or dir name.
      "src/templates.yaml",
      "mytemplates/job.yaml",
    ],
  ],
  ["--", `-- ${BODY}`, ["db/schema.sql", "scripts/init.lua", "app/Main.hs"]],
  [
    "<!-- -->",
    `<!-- ${BODY} -->`,
    ["public/index.html", "legacy/page.htm", "pom.xml", "assets/logo.svg", "README.md"],
  ],
  ["/* */", `/* ${BODY} */`, ["styles/app.css"]],
  [
    "//",
    `// ${BODY}`,
    [
      "src/app.js",
      "src/app.ts",
      "src/App.jsx",
      "src/App.tsx",
      "cmd/main.go",
      "src/Main.java",
      "app/Main.kt",
      "native/main.c",
      "native/main.cpp",
      "Api/Program.cs",
      "ios/App.swift",
      "src/main.rs",
      "public/index.php",
      "src/App.scala",
      "lib/main.dart",
      "ci/build.groovy",
      "build.gradle",
      "notes.unknownext",
      "LICENSE",
      // Only the file names above take `#`, not every `.txt` or `env` file.
      "docs/notes.txt",
      "src/config/env.local.ts",
    ],
  ],
];

describe("buildIgnoreDirective", () => {
  describe.each(FAMILIES)("%s comments", (_family, expected, paths) => {
    it.each(paths)("%s", (path) => {
      expect(buildIgnoreDirective(CODE, path)).toBe(expected);
    });
  });

  it.each([
    ["no path", undefined],
    ["an empty path", ""],
  ])("falls back to // with %s", (_label, path) => {
    expect(buildIgnoreDirective(CODE, path)).toBe(`// ${BODY}`);
  });

  it.each([
    ["INFRA/MAIN.TF", `# ${BODY}`],
    ["charts/app/values.YAML", `# ${BODY}`],
    ["build/DOCKERFILE", `# ${BODY}`],
    ["native/CMAKELISTS.TXT", `# ${BODY}`],
    [".ENV.Local", `# ${BODY}`],
    [".EnvRC", `# ${BODY}`],
    ["db/Query.SQL", `-- ${BODY}`],
    ["public/INDEX.HTML", `<!-- ${BODY} -->`],
    ["styles/Theme.CSS", `/* ${BODY} */`],
    ["charts/app/templates/Deployment.YML", `{{- /* ${BODY} */}}`],
  ])("matches extensions and file names case-insensitively: %s", (path, expected) => {
    expect(buildIgnoreDirective(CODE, path)).toBe(expected);
  });

  it.each([
    ["charts\\cybedefend\\templates\\deployment.yaml", `{{- /* ${BODY} */}}`],
    ["C:\\repo\\iac\\main.tf", `# ${BODY}`],
    ["services\\api\\Dockerfile", `# ${BODY}`],
    ["src\\app\\index.ts", `// ${BODY}`],
  ])("understands Windows separators: %s", (path, expected) => {
    expect(buildIgnoreDirective(CODE, path)).toBe(expected);
  });

  it("writes the given code verbatim between the brackets", () => {
    expect(buildIgnoreDirective("CD-SAST-0042", "src/db.ts")).toBe(
      "// cybedefend-ignore[CD-SAST-0042]: <reason>",
    );
  });
});

# Import

Send a SARIF file from another tool to the dashboard: a scanner the team already runs, or another security review once written as SARIF.

## 1. The type

The type says which page of the dashboard the findings go to. Ask the user if the tool is not in this table.

| The file comes from | Type |
|---|---|
| Semgrep, CodeQL, SonarQube, Snyk Code, Bandit, gosec, Brakeman, ESLint security rules, a security review | `sast` |
| Trivy fs, Grype, osv-scanner, Snyk Open Source, OWASP Dependency-Check | `sca` |
| Checkov, KICS, tfsec, Terrascan, Kubescape | `iac` |
| Gitleaks, TruffleHog, detect-secrets | `secret` |
| zizmor, poutine, actionlint, a review of CI workflows | `cicd` |
| Trivy image, Grype on an image, Snyk Container | `container`, with the image reference |

## 2. Send it

```bash
node <skill>/scripts/cybedefend.mjs check <file> --type <type>
node <skill>/scripts/cybedefend.mjs import <file> --type <type>
```

- `container`: add `--image <the image reference>`.
- `sca`: when the tool also wrote a CycloneDX SBOM of the same scan, add `--sbom <file>`: the dashboard then lists every package, with its licenses.
- A file over 50 MB: gzip it and send `<file>.sarif.gz`.

## 3. What the user should know

- Each import is the whole picture of its tool (`tool.driver.name` in the file) on the branch: findings that tool reported before and no longer reports are resolved. Send the full result of a scan of the whole repository, never a partial one.
- An `sca` import replaces the branch's whole dependency picture: keep one SCA tool per branch.
- Results marked as suppressed in the file are skipped.

## 4. A review written in another format

When the user has a security review as text (a report another agent wrote, a penetration test report on their own code), turn each finding they confirm into a SARIF result as in [audit.md](audit.md), step 4, with the review's own tool name (for example `security-review`), and the same name at each later import. Keep only findings that point to a file and a line. Show the user the list before you send it.

# Scan

The scanners run on the current branch and their results go to the dashboard. `<skill>` is the folder that holds this file; run every command from the repository.

## Where the scanners come from

The scanners are open source tools, and the open source project [`CybeDefend/cybedefend-scanners`](https://github.com/CybeDefend/cybedefend-scanners) is the integration layer with them: one pinned image per tool, which runs it, cleans its SARIF and sends it to the dashboard, the same images as the CybeDefend cluster and the CI action (`CybeDefend/cybedefend-scanners@v1`). They start with `docker run`, the GitHub Action or the GitLab CI template; that project has no compose file (the compose is the dashboard's). The user chooses the scanners: they keep the ones they want, and a tool from elsewhere that writes SARIF comes in through `/cybedefend import`.

This is the static base of the check. It finds the known patterns: a vulnerable package, a leaked key, an injection a rule describes. What depends on the code's intent is the audit's job ([audit.md](audit.md)), which comes after the scan in `/cybedefend`.

## What the user sees of it

`start.mjs` ends the scan on a block, `THE SCAN, TOOL BY TOOL`: one line per tool that ran (what it reads, how many results, in how many seconds), one per tool that did not finish, with the cause read in its log and what it changes for the audit, and one per tool that stayed out with the reason (no Go file here, no workflow, an image nobody named). `node <skill>/scripts/cybedefend.mjs board` prints it again. Its last line, `START: ...`, gives the message to write to the user: the same scan as one sentence, then what the triage does in this run. The same lines fill the run's live page as each tool starts and ends.

## Where the scanners run

Run `node <skill>/scripts/cybedefend.mjs doctor` if you have not in this session.

- **`clusterScans: true`**: the instance runs five core scanners on its own cluster (all but Trivy image). Run `node <skill>/scripts/cybedefend.mjs instance-scan`. It sends the working tree (tracked and new files, never the ignored ones) as a ZIP archive to the instance storage, starts the scan and waits for it. Then run `node <skill>/scripts/scan.mjs --plan` and, when the plan shows deep tools for this stack, run them here too: `node <skill>/scripts/scan.mjs --only <the deep and context tools of the plan>` then `node <skill>/scripts/cybedefend.mjs send --add-to-run`, so they join the cluster's run.
- **Otherwise**, everything runs here. `node <skill>/scripts/start.mjs` does it in one command, after the setup: the plan, the scan, the send, then the digest. The same steps, one by one, when you need one alone:

  ```bash
  node <skill>/scripts/scan.mjs --plan
  node <skill>/scripts/scan.mjs
  node <skill>/scripts/cybedefend.mjs send
  node <skill>/scripts/cybedefend.mjs digest
  ```

  Tell the user in one line what the plan runs. `scan.mjs` writes one file per tool in `.cybedefend/out/` (kept out of git by `.cybedefend/.gitignore`) and a manifest. `send` imports each SARIF with its type, waits for each scan and writes `.cybedefend/out/run.json`. Context files are not sent.

  **Secrets.** When Gitleaks finds secrets, `scan.mjs` ends by saying where each one is (file, line, kind) and masks their values in every tool's results, so nothing that is sent, merged or shown carries them. Never print those lines yourself: read such a file with `node <skill>/scripts/cybedefend.mjs show <file>`.

Each tool runs in Docker when Docker runs and `scanners.lock` has an image for it (the same pinned images as the cluster for the core six), otherwise from its binary when it is installed. When a CybeDefend image cannot be had (not published yet, no network), the same tool runs from its own project's pinned image (`scanners.upstream.lock`), else from its binary, and `scan.mjs` says so in one line: it is the same tool, and nothing to report to the user unless a tool does not finish. A Python tool marked `uvx:` runs pinned through `uvx`, in a throwaway environment, nothing installed. The first run pulls each image and shows it. A deep or context tool that cannot run is skipped; never install a tool yourself.

Opengrep names its rules after the path of its rules folder; `scan.mjs` strips that path, so the rule ids are the same on every machine and in the CybeDefend image, and no home path reaches the dashboard. The dashboard keeps the first title it saw for a rule, for good.

## The tools

| Tier | Tool | Runs when the repository has | Import type |
|---|---|---|---|
| core | Opengrep | always | `sast` |
| core | Trivy fs, with the full package list (SBOM) | always | `sca` |
| core | Trivy config | always | `iac` |
| core | Gitleaks | always | `secret` |
| core | zizmor | `.github/workflows` | `cicd` |
| core | Trivy image | an image the user names | `container` |
| deep | Bandit | Python files | `sast` |
| deep | gosec | a `go.mod` | `sast` |
| deep | Brakeman | a Rails app (`config/routes.rb`) | `sast` |
| deep | Checkov | Terraform, Dockerfile, Kubernetes, Helm, Bicep, Serverless | `iac` |
| deep | poutine | GitHub Actions, GitLab CI, Azure Pipelines, Tekton | `cicd` |
| context | OWASP Noir | always: the endpoints, read by the audit | not sent |
| context | govulncheck | a `go.mod`: which vulnerable Go dependencies the code really calls, read by the fix | not sent |

`node <skill>/scripts/scan.mjs --depth quick` (or `/cybedefend scan --quick`) runs the core only.

For a container scan, ask the user which image this repository builds (for example the tag in their compose file or Makefile). Then `node <skill>/scripts/start.mjs --image <ref>` (or `node <skill>/scripts/scan.mjs --image <ref>` and `node <skill>/scripts/cybedefend.mjs send --image <ref>`). Never pull or build an image the user did not name.

## When it goes wrong

| What you see | What to do |
|---|---|
| `scan.mjs` exit 3 | No core scanner can run here: Docker is not running and the tools are not installed. Tell the user to start Docker (Docker Desktop or OrbStack). Do not install anything. |
| A tool did not finish (exit 2) | The others still ran: send them. `scan.mjs` already read the tool's log and says the cause and what it changes in one line (a Go version the tool does not have, an image that is not on this machine, a database it could not download, no network, no memory left): tell the user that line. When it only quotes the tool's last message, read `.cybedefend/out/<tool>.log` and say the cause in your own words. Say "did not finish" and the cause, never "failed" or "error" alone. Do not retry more than once. A core scanner that did not finish prevents SHIP: say what was not read and the one thing to do; a deep tool that did not finish is named in the report, and the audit goes on without it. |
| An image cannot be pulled | Say which one. The images are pinned in `scanners.lock`; do not replace them with another version. |
| `send` refused a file (`IMPORT_...`) | The code says why: `IMPORT_INVALID_SARIF` (not SARIF 2.1.0), `IMPORT_TOO_LARGE`, `IMPORT_TOO_MANY_RESULTS`, `IMPORT_UNSUPPORTED_RESULT` (an SCA result without package and version). Tell the user. Do not edit a tool's SARIF to make it pass. |
| A scan stays `queued` or `running` past 15 minutes | Stop waiting and give the user the scan link. |
| Exit 3, token refused | The token is wrong, expired or revoked: the user creates a new one. |

## Good to know

- Each import is the whole picture of one tool on this branch: a finding the tool no longer reports is resolved, a resolved finding that comes back reopens. So scan the whole repository, every time, never a subfolder. A tool that did not run this time keeps its findings as they were.
- Several tools of one type sit side by side (Opengrep, Bandit and the audit in `sast`): each keeps its own findings.
- One SCA tool per branch: an `sca` import replaces the branch's whole dependency picture, so Trivy fs is the only one.
- The first scan of a branch creates it in the dashboard.

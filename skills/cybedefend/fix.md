# Fix

For each finding that blocks, prove it with a test, then fix the code until the test passes. The proof stays in the repository's test suite. Work on one finding at a time, the most severe first.

## 1. Read the finding

- The findings to fix: `node <skill>/scripts/cybedefend.mjs blocks` prints what blocks, a few lines each: where it is, who found it, its proof test and its fix when the AI scanner found it, your assessment when you made one, its id in the dashboard; then the packages to upgrade and the dependency of the project that brings them in. Or the ones the user names. `.cybedefend/out/verdict.json` holds the same in full, and `.cybedefend/out/triage.md` every finding, blocking or not: open them for one finding, never whole.
- That list is enough to work from, in the session that ran `/cybedefend` too: the dashboard's MCP server loads only at the next session. When this session has it, a finding's full detail is one call away: `get_vulnerability_sast`, `get_vulnerability_sca`, `get_vulnerability_iac`, `get_vulnerability_secret`, `get_vulnerability_cicd` or `get_vulnerability_container`, with the `projectId` of `.cybedefend/config.json` and the finding's id. To list them: `list_vulnerabilities_<type>` with `projectId`, `branch` and one status at a time, as text (`status: "to_verify"`, then `status: "confirmed"`; the same for `severity`). The tool's schema says a list, but version 0.4.0 of the server ignores a list without a word and answers every finding.
- Start with what a test already proves (the AI scanner's findings), then the scanners' findings, the most severe first. What the triage set aside is not in that list: it no longer blocks.
- Open the file at the line. Read enough of the code around it to know where the input comes from and where it goes.

## 2. Prove it, then fix it

**An audit finding** (`cybedefend-audit`) comes with its proof test and its fix: `proofTest` and `fix` in `.cybedefend/audit/last.sarif`. Fix the code at the root (the missing check, at the place the sibling handlers have it; the field taken out of what the caller may set; the bound on the amount), remove the test's expected-failure mark (when the mark is a wrapper such as `proof(...)`, that proof now calls the runner's own `test(...)`), and run the test, then the whole suite, as in steps 4 and 5 below. When the fix refuses something, keep or add one test of the path that must still work (the owner still reads their own file): in a repository that had no suite, it is the only guard against a fix that closes too much. A test kept in `.cybedefend/audit/tests/` moves into the suite with the fix ([proofs.md](proofs.md) says how, for each stack). A proof that compared with the flaw itself (the stored password equals the one typed, the answer is 403 where the right fix answers 400) is rewritten to assert the guarantee: what was true before the request is still true after it, and the request is refused.

When the right fix needs something the code does not have yet (roles, a mail channel, a store for one-time tokens), fix it closed: the handler refuses the action until that piece exists, with an answer that says so (501, or the framework's own "not available"). Tell the user what now refuses and what is left to build. A fix never invents a feature to keep an unsafe path open.

When the fixes of a round are in, the audit file, the scan and the verdict follow, in the order of step 6.

**Code flaws (sast).**

1. Write a test in the repository's own test framework and folder, next to the existing tests, named after the flaw (for example `test_search_rejects_sql_injection`). It calls the vulnerable function or route the way the application does, with an input that shows the flaw: a quote that changes the SQL, a path with `../`, a script tag that comes back unescaped. It runs against the code in the repository only, never against a running server or a third party.
2. Run it. It must **fail**, and fail because of the flaw. If it passes, or fails for another reason, the flaw is not reproduced: go to step 3.
3. Fix the code at the root: a parameterized query, an allowlist, an escape at output, a check of the path after it is resolved. No fix that only defeats your test input.
4. Run the test again: it must pass. Then run the whole suite. If a test that passed before now fails, your fix changed behavior: undo it and try another (tests that already failed before the audit are listed in the map under "Baseline": they are not yours to fix here). After three attempts, stop and tell the user what you tried.
5. Keep the test.

**Dependencies (sca, container).** The proof is the version. When `broughtInBy` shows one dependency of the project behind many of the vulnerable packages, upgrade that one first and scan again: it often clears the list. Otherwise raise each package to the version the triage gives ("Upgrade to"), with the package manager of the repository, so the lock file changes too. Run the whole suite. A package the project's own code does not import is never added to its dependencies to raise it: go through the dependency that brings it in, or the package manager's override (`overrides` in npm, `resolutions` in Yarn, `pnpm.overrides`). When a framework pins the package, only the framework's own upgrade clears it: say so and leave it. When the modules are not installed, `npm update <names> --package-lock-only` changes the lockfile alone: say in the report that the change was neither installed nor built. An upgrade can raise the language version the manifest declares (`go` in `go.mod`, `engines` in `package.json`): check the images and the CI that build the project, and say it in your report. If no fixed version exists, or the fix is a major version that breaks the suite, stop and tell the user. When the fixed version needs a newer language toolchain than this machine has, never let the package manager download one (Go: `GOTOOLCHAIN=local`): upgrade as far as the toolchain allows, and tell the user what is left and what it needs. For a Go module, `.cybedefend/out/govulncheck.sarif`, when the scan wrote it, says whether the code calls the vulnerable function: when it does not and the upgrade cannot be made, tell the user so and call `set_exploitability` with `theoretical` and that reason.

**Infrastructure (iac) and workflows (cicd).** Change the configuration as the finding describes: pin the action to a commit, move `${{ github.event... }}` into an `env:` variable, drop `pull_request_target` or the checkout of the pull request's head, narrow `permissions`, set the resource's secure value. A workflow, a Dockerfile or a Terraform change can break a build or a deployment: show the user the diff before you write it. With nobody there to answer, leave the file as it is and put the diff in your report.

**Secrets.** The fix is not in the code alone: the secret is exposed and must be revoked by its owner. Tell the user which file and line, and what kind of secret, never its value. Propose to replace it with a read from an environment variable or the secret manager the repository already uses. Do not rewrite git history.

## 3. A flaw you cannot reproduce

The scanner may be wrong, or the code may be safe for a reason it cannot see (the input never comes from a user, a check upstream). Then:

1. Write an entry with the verdict `not_exploitable` and your reason (what you tried, why it does not reproduce, the file and line of the check that protects it) to a file of your own outside `.cybedefend`, and save it with `node <skill>/scripts/cybedefend.mjs assess --save <that file> --part fix`: [assess.md](assess.md) has the format. The next `finish` sets it aside in the dashboard with that reason, and the policies stop counting it.
2. Tell the user in one line which finding you set aside and why: they can open it again from the dashboard's "ignored" list.

## 4. Ignore a finding, only on the user's yes

When the user says a finding is acceptable, ask for the reason in their words, then:

1. `node <skill>/scripts/cybedefend.mjs ignore <finding id> --reason "<their reason>"` (512 characters at most; the id is the one `blocks` prints). Over MCP, when this session has it: `update_vulnerability` with `status: "ignored"` and `dismissalReason`. The reason shows in the dashboard's audit trail.
2. Propose the scanner's own ignore comment, so the next scan does not raise it again, with the reason in it. Write it only after the user's yes:

| Scanner | Ignore |
|---|---|
| Opengrep | `// nosemgrep: <rule-id> -- <reason>` on the line, in the file's comment syntax |
| Gitleaks | `gitleaks:allow` in a comment on the line, or the finding's fingerprint in `.gitleaksignore` |
| Trivy (sca, iac, container) | the id (CVE or AVD) in `.trivyignore`, the reason on the line above as `# <reason>`. For Terraform, `#trivy:ignore:<AVD-id>` above the resource |
| zizmor | `# zizmor: ignore[<rule>] <reason>` on the line |
| Bandit | `# nosec <test-id>  <reason>` on the line |
| gosec | `// #nosec <rule-id> -- <reason>` on the line |
| Checkov | `# checkov:skip=<check-id>: <reason>` in the resource |
| poutine | the rule in the `skip` list of `.poutine.yml`, with the reason as a comment |
| Brakeman | the warning's fingerprint in `config/brakeman.ignore`, with the reason in its `note` |
| cybedefend-audit | no comment: keep the result in the next audit files, unchanged, so the dashboard keeps the user's decision on it, and write the reason in `.cybedefend/audit/map.md` under "Accepted" |

An ignore comment hides a finding for good and shows in the code review. Never write one without the user's yes, never for a secret that is real, and never several at once on one yes.

## 5. Keep a log

Append one line per finding to `.cybedefend/out/fix-log.jsonl`:

```json
{"id": "<finding id>", "type": "sast", "rule": "<rule>", "file": "app/search.py", "line": 42, "outcome": "fixed", "test": "tests/test_search.py::test_search_rejects_sql_injection", "note": "parameterized query"}
```

`outcome` is `fixed`, `not_reproduced`, `ignored` or `left` (with the reason in `note`). The report reads it.

## 6. The audit file, the scan, the verdict

Once the fixes of the round are in and the suite passes, in this order:

1. `node <skill>/scripts/cybedefend.mjs keep --fixed <the proof test of each fixed finding, separated by commas>` writes `.cybedefend/out/audit.sarif`: the last audit without them. A finding is named by its test (`test_security_login_is_not_sql_injectable`), or by `file:line` when it is alone on its line. The findings that stay follow their line when the fix moved it, and the command names the ones it could not follow, for you to correct. Never `keep --reviewed` here: it belongs to a review ([audit.md](audit.md), step 5).
2. In the map, give each row you fixed the verdict `ok`, with the check that now protects it.
3. Read your own diff once as a reviewer: a check added in one handler and not in its sibling, a new path the fix opened. A new flaw is a new finding, with its test: put it alone in a file of its own, in the format of [audit.md](audit.md), step 4, and run `node <skill>/scripts/cybedefend.mjs write-audit .cybedefend/out/new-findings.json --add`, which adds it to the audit file.
4. `node <skill>/scripts/start.mjs`, then `node <skill>/scripts/cybedefend.mjs finish --no-open`: the scan resolves what is fixed. Never set `resolved` yourself. The triage of the last run is kept ([assess.md](assess.md), "From one run to the next"): a finding in a file you did not change and a package still at its version keep their verdict, and `start.mjs` removes the triage file the last `finish` already kept. `finish` names what has no verdict now: a finding in a file your fix changed, a package you upgraded that still has advisories at its new version. Judge those in `.cybedefend/out/assessments.json` (when your reason still holds for the new version, write it again), then run `finish` once more. A live replay made before the fix is no longer shown as current: `/cybedefend live` replays the findings on the fixed code, when the user wants to see it.
5. Still NOT YET: another round on what blocks now, three rounds at most. Stop before that when everything left is out of your hands: a finding that waits for the user's answer, a version this machine's toolchain cannot reach, a package with no fixed version.

## 7. Tell the user

What you fixed, each with the test that proves it (it failed before, it passes now), what you could not reproduce and why, what you left and why, and the new verdict. The diff is theirs to read: commit nothing unless they ask.

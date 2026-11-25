<p align="center">
  <a href="https://cybedefend.com"><img src="assets/banner.jpg" alt="CybeDefend: put your coding agent on defense. The open source Snyk alternative." width="100%"></a>
</p>

<p align="center"><strong>One command in your coding agent. A full security audit. Every flaw proven with an exploit.</strong><br>
The open source Snyk alternative: self-hosted agentic AppSec, with an AI scanner your coding agent runs.</p>

<p align="center">
  <a href="https://github.com/CybeDefend/cybedefend/stargazers"><img src="https://img.shields.io/badge/Star%20on%20GitHub-7B5BFF?logo=github&logoColor=white" alt="Star CybeDefend on GitHub"></a>
  <a href="https://github.com/CybeDefend/cybedefend/tags"><img src="https://img.shields.io/github/v/tag/CybeDefend/cybedefend?sort=semver&label=release&color=7B5BFF" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-7B5BFF" alt="License: AGPL-3.0"></a>
  <a href="https://discord.gg/UPzm4n6SAJ"><img src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://www.linkedin.com/company/101144768"><img src="https://img.shields.io/badge/LinkedIn-follow-0A66C2" alt="Follow CybeDefend on LinkedIn"></a>
</p>

<p align="center"><a href="#quick-start">Install</a> &bull; <a href="deploy/community/README.md">Docs</a> &bull; <a href="https://cybedefend.com">Website</a> &bull; <a href="https://discord.gg/UPzm4n6SAJ">Discord</a></p>

<p align="center"><a href="README.md">English</a> &bull; <a href="README.fr.md">Français</a> &bull; <a href="README.zh-CN.md">中文</a> &bull; <a href="README.ja.md">日本語</a> &bull; <a href="README.ko.md">한국어</a> &bull; <a href="README.es.md">Español</a> &bull; <a href="README.pt-BR.md">Português</a></p>

> [!NOTE]
> A star is how other developers find this repository. We launch on Product Hunt on December 4, 2026. Come and talk with us on [Discord](https://discord.gg/UPzm4n6SAJ).

**① A full audit in one command.**
Type `/cybedefend` in your coding agent. Open source scanners run, the AI scanner hunts what they cannot see, and your agent judges every finding against your code. It answers **SHIP**, or **NOT YET** with what blocks and the fix for each.

**② Every flaw proven.**
The AI scanner writes each exploit as a test in your repository's own test suite. A finding is a fact, not a guess.

**③ A whole open source AppSec platform behind it.**
You host it: a dashboard for your team, policies that decide what blocks, integrations with your stack, and an MCP server your coding agent reads.

<p align="center"><img src="assets/audit-run.gif" alt="A real run of /cybedefend in a coding agent's terminal, sped up. The command is typed, the five steps appear (scanners, AI scanner, triage, dashboard, report), the audit runs, the verdict is NOT YET, then the report lists the proven flaws that block, each with its exploit test and its fix." width="100%"></p>

<p align="center">If it proves a flaw in your code, a star helps other developers find it.</p>

<br>

# Quick start

```bash
npx skills add CybeDefend/cybedefend -g
```

Open your coding agent in the repository to audit, and type:

```text
/cybedefend
```

That is the whole install. No token to copy, no file to edit, no server to start.

- **Works with** Claude Code, Codex, Cursor and every coding agent that reads skills.
- **Needs** Docker running, with Docker Compose 2.24.4 or later, about 4 GB of memory, git and Node.js.
- **Answers** **SHIP**, or **NOT YET** with what blocks and the fix for each.

<details>
<summary><b>What the first run sets up by itself</b></summary>

<br>

It asks nothing:

1. It starts the dashboard on your machine with Docker Compose, on the first open port from 8080, bound to `127.0.0.1`. The first time, Docker downloads the images (about 6 GB, a few minutes). Later runs take seconds and change nothing.
2. It creates the first administrator and a personal access token, saved in `~/.cybedefend/appsec/credentials.json` (mode 600, never printed).
3. It creates the project of your repository, and a default policy when your team has none: critical and high findings block, so does any secret in the code, medium findings warn.
4. It connects the MCP server to Claude Code. For another agent, it prints the address to add.

When the published images cannot be pulled, the first run builds them from the source and says so (15 to 30 minutes, once).

</details>

<br>

# How it works

One command. Five steps. One verdict.

| Step | What happens |
|---|---|
| **1.&nbsp;Scanners** | Open source scanners find the known patterns. |
| **2.&nbsp;AI&nbsp;scanner** | Your coding agent maps every entry point, writes down what the code must never allow, hunts business logic, access rights, tenants, identity and races, and proves each flaw with an exploit written as a test in your own suite. |
| **3.&nbsp;Triage** | Your agent judges every scanner finding against your code. |
| **4.&nbsp;Dashboard** | Your policies give the verdict: **SHIP** or **NOT YET**. |
| **5.&nbsp;Report** | What blocks, and the fix for each. |

**Your own coding agent runs the AI scanner.** No extra model, no API key.

**Safe to run.** The audit changes no application code. The AI scanner sends no request to a deployed system or a third party, and uses no real credentials or personal data.

<details>
<summary><b>What the AI scanner does, exactly</b></summary>

<br>

It lists every entry point of the code (routes, message consumers, scheduled jobs, webhooks), one row each, with who may call it and the check that enforces it. It writes the guarantees of the code as plain sentences: a member sees only their own team's documents, a transfer never takes a balance below zero.

The first run reviews the whole repository. Later runs review what the branch changed and the entry points that reach it. Every row in that scope is reviewed, role by role.

A lead becomes a finding when a test in your own test framework fails for the reason it claims. Every other lead goes to the dashboard as a note that cannot block.

The report counts the entry points reviewed, the findings kept and the findings set aside, with the reasons.

</details>

<details>
<summary><b>What blocks, exactly</b></summary>

<br>

Policies apply to an organization, a team or a project. They are written in YAML, which you import and export. Each rule matches findings on severity, CVSS score, CWE, OWASP category, scanner type, age or branch, alone or combined.

A Block rule makes the verdict NOT YET, and `/cybedefend` exits with code 1. A Warn rule records the violation. The policies judge again at the end of every scan and every import.

</details>

<br>

# The platform

Behind the command, a complete open source AppSec platform. You host it, your team works in it, and your coding agent reads it through the MCP server.

### The whole organization in one view

<p align="center"><img src="assets/screens/overview.jpg" alt="The organization overview of the dashboard: 34 projects in 1 team, 2,939 open findings, what was resolved and what is new, the open findings by severity and by scanner" width="100%"></p>

### Every finding, branch by branch

<p align="center"><img src="assets/screens/findings.jpg" alt="The findings of a project in the dashboard: severity, file and line, CVSS score and status, on the main branch" width="100%"></p>

### Your policies decide what blocks

<p align="center"><img src="assets/screens/policies.jpg" alt="The policy a project follows: two Block rules and a Warn rule" width="100%"></p>

<details>
<summary><b>Everything in the open source edition</b></summary>

<br>

| Feature | What you get |
|---|---|
| **Findings that follow the code** | Resolved when the scan is clean, reopened when they come back |
| **Security policies** | Block and Warn rules, in YAML |
| **Organizations, teams, roles** | Four organization roles, four team roles |
| **Risk score per project** | A CybeRisk level, the riskiest first |
| **Reports** | OWASP Top 10 and CWE Top 25, in PDF, HTML or JSON |
| **MCP server** | 21 tools for your coding agent |
| **Personal access tokens** | For your CI, the import API and the MCP server |
| **Self-hosted** | Docker Compose and PostgreSQL 18, on your servers |
| **No seat limit, no telemetry** | No scan quota, reports kept with no expiry |

</details>

<br>

# Integrations

Plugged into your stack.

<p align="center"><img src="assets/integrations.jpg" alt="Plugged into your stack, in the open source edition: GitHub, GitLab and self-managed GitLab, GitHub Actions, GitLab CI, Jira, Linear, Slack, e-mail, an MCP server with 21 tools, the import API, Docker Compose, Kubernetes" width="100%"></p>

<details>
<summary><b>What each integration does</b></summary>

<br>

| Integration | What it does |
|---|---|
| **GitHub** | A GitHub App you create. Linked repositories, issues opened at the end of a scan and closed when every finding in them is resolved, a scan on every push with a cluster. |
| **GitLab** | GitLab.com or your own GitLab, with the same features as GitHub. |
| **Jira and Linear** | Tickets from a finding, or at the end of each scan. |
| **Slack and e-mail** | A message when a scan completes, every week and every month. |
| **GitHub Actions and GitLab CI** | The scanners on every pull request, results in your dashboard. Any other CI runs them with `docker run`. |
| **Coding agents** | Two skills for any agent that reads skills, and an MCP server with 21 tools. |
| **Any other scanner** | Any SARIF 2.1.0 file through the import API or `/cybedefend import`, with a CycloneDX SBOM for the full list of packages. |
| **Docker Compose and Kubernetes** | The platform runs with Docker Compose. Connect a Kubernetes cluster and it runs the scans itself, one pod per scanner. |

You switch each integration on with its settings: [deploy/community/README.md](deploy/community/README.md) lists them, with the callback address of each provider.

</details>

<br>

# Commands

Type `/cybedefend` before each deploy. The other commands run one step of it, or go further.

| Command | What it does |
|---|---|
| `/cybedefend` | The full audit: the whole repository on the first run, what the branch changed after. |
| `/cybedefend deep` | The heavy audit, for a release: a verdict on every function. |
| `/cybedefend fix` | Fixes what blocks, each fix proven by a test. |
| `/cybedefend audit` | The whole repository again, then two agents that did not write the review check it. |
| `/cybedefend scan` | The scanners and the verdict. `--quick` runs the core scanners. |
| `/cybedefend triage` | Every scanner finding judged against your code. |
| `/cybedefend live` | Replays the proven flaws on your application, on your machine, with throwaway data. |
| `/cybedefend import <file>` | Sends the SARIF file of another tool to your dashboard. |
| `/cybedefend report` | The report of the last run. |
| `/cybedefend open` | Opens the dashboard and the audit page of the last run. |
| `/cybedefend replay` | Plays the page of the last run again, as it happened. |
| `/cybedefend setup` | The setup alone. |
| `/cybedefend-setup` | The second skill: a server, HTTPS, or scans on a Kubernetes cluster. |

<br>

# Scanners

Every scanner a team needs. The stack of your repository decides which ones run.

<p align="center"><img src="assets/scanners.png" alt="Recommended open source scanners: Opengrep for code, Trivy for dependencies and infrastructure as code, Gitleaks for secrets, zizmor for CI/CD, Bandit for Python, gosec for Go, Brakeman for Ruby, Checkov for infrastructure as code, poutine for CI/CD. Or bring your own through SARIF: Semgrep, CodeQL, Grype, TruffleHog and any tool that writes SARIF 2.1.0" width="100%"></p>

These are the scanners we recommend, and any other scanner works.

| Area | Tools, for example |
|---|---|
| **Code** | Opengrep, Bandit, gosec, Brakeman<br><sub>The source files</sub> |
| **Dependencies** | Trivy, with the full package list (SBOM)<br><sub>A lockfile or pinned versions</sub> |
| **Secrets** | Gitleaks<br><sub>The files git sees</sub> |
| **Infrastructure as code** | Trivy, Checkov<br><sub>Terraform, Kubernetes, Helm, Dockerfile, CloudFormation</sub> |
| **CI/CD** | zizmor, poutine<br><sub>GitHub Actions, GitLab CI, Azure Pipelines, Tekton</sub> |
| **Containers** | Trivy<br><sub>An image you name</sub> |

- **Open source, your choice**, one image per tool in [`CybeDefend/cybedefend-scanners`](https://github.com/CybeDefend/cybedefend-scanners).
- **Nothing installed on your machine.**
- **Plus every scanner that writes SARIF**, with `/cybedefend import <file>`.

<details>
<summary><b>The tools you keep, through SARIF</b></summary>

<br>

| Area | Tools you keep |
|---|---|
| **Code** | Semgrep, CodeQL, SonarQube, Snyk Code, ESLint security rules |
| **Dependencies** | Grype, osv-scanner, Snyk Open Source, OWASP Dependency-Check |
| **Infrastructure as code** | KICS, tfsec, Terrascan, Kubescape |
| **Secrets and CI/CD** | TruffleHog, detect-secrets, actionlint |
| **Anything else** | Any tool that writes SARIF 2.1.0 |

</details>

<br>

# Audit-ready, all year

The proof SOC 2 and ISO 27001 auditors ask for, kept while you work.

| Your auditor asks for | CybeDefend keeps |
|---|---|
| Vulnerabilities handled in time<br><sub>ISO 27001 A.8.8, SOC 2 CC7.1</sub> | Every finding with its date, its severity and the history of its status |
| Secure coding and testing<br><sub>ISO 27001 A.8.28, A.8.29</sub> | A scan on every pull request, and each flaw the AI scanner proved with its test |
| Change management<br><sub>ISO 27001 A.8.25, SOC 2 CC8.1</sub> | Your policies, judged at every scan and import, each violation recorded |
| Audit evidence | OWASP Top 10 and CWE Top 25 reports in PDF |

<br>

# Documentation

- **Self-hosting guide**: [deploy/community/README.md](deploy/community/README.md), with HTTPS and reverse proxies, the secret key, the integrations, upgrades, backups and how to verify an image.
- **Scanners in your CI**: [CybeDefend/cybedefend-scanners](https://github.com/CybeDefend/cybedefend-scanners).
- **Build and tests**: [CONTRIBUTING.md](CONTRIBUTING.md).
- **Report a vulnerability**: [SECURITY.md](SECURITY.md).

## In your CI

The scanner images of [CybeDefend/cybedefend-scanners](https://github.com/CybeDefend/cybedefend-scanners) run on every pull request and send their results to your dashboard. The full workflow, the pinning by commit and every option are documented there.

You need an instance your runners can reach, a project, and a personal access token of a user who may start scans on it.

<details>
<summary><b>GitHub Actions</b>, one step per scanner</summary>

<br>

```yaml
- uses: CybeDefend/cybedefend-scanners@v1.0.0
  with:
    scanner: opengrep
    api-url: ${{ vars.CYBEDEFEND_API_URL }}
    project-id: ${{ vars.CYBEDEFEND_PROJECT_ID }}
    token: ${{ secrets.CYBEDEFEND_TOKEN }}
```

</details>

<details>
<summary><b>GitLab CI</b>, one job per scanner</summary>

<br>

```yaml
include:
  - remote: https://raw.githubusercontent.com/CybeDefend/cybedefend-scanners/v1.0.0/templates/gitlab/cybedefend-scanners.gitlab-ci.yml

sast:
  extends: .cybedefend-sast
```

</details>

<details>
<summary><b>Any other CI</b>, with <code>docker run</code> or the import route</summary>

<br>

`docker run` a scanner image with `--upload`, or send the SARIF of any tool to the import route with a personal access token:

```bash
curl -H "Authorization: Bearer cdp_…" \
  -F file=@results.sarif -F type=sast -F branch=main \
  "$CYBEDEFEND_PUBLIC_URL/api/project/<projectId>/scan/import/start"
```

`type` is one of `sast`, `iac`, `secret`, `cicd`, `sca` and `container`.

</details>

## On a server, or on a Kubernetes cluster

```text
/cybedefend-setup
```

The setup skill installs the instance with you. It came with the same `npx skills add`.

<details>
<summary><b>What the setup skill does</b></summary>

<br>

It checks Docker and the Kubernetes clusters it can see, takes a default for each choice, asks what it cannot decide (scans on one of those clusters, the domain of a server), confirms once, then writes the settings, connects the cluster and starts the stack.

With a cluster connected, the instance starts one pod per scanner in a namespace of its own: **Start scan** appears next to **Import results**, an uploaded ZIP archive is scanned, and a project linked to GitHub or GitLab can be scanned on every push.

</details>

<details>
<summary><b>Install by hand</b></summary>

<br>

You need Docker Compose 2.24.4 or later and about 4 GB of RAM. The stack brings its own PostgreSQL 18.

```bash
git clone https://github.com/CybeDefend/cybedefend && cd cybedefend/deploy/community

# The master key: at least 32 random bytes, in a file readable by you alone.
(umask 077 && openssl rand -base64 32 > secret-key)
cp .env.example .env

# In .env, set the two required values:
#   CYBEDEFEND_SETUP_TOKEN  a long random string, for example: openssl rand -hex 32
#   CYBEDEFEND_PUBLIC_URL   the address users open, http://localhost:8080 by default
docker compose up -d
```

Open the dashboard at `CYBEDEFEND_PUBLIC_URL`, then enter `CYBEDEFEND_SETUP_TOKEN` to create the first administrator.

Keep a backup of the master key (`secret-key`) and never change it: it encrypts the integration credentials, the secret findings and the sign-in keys.

</details>

<br>

# Founding team

<table align="center">
  <tr>
    <td align="center" valign="top" width="200">
      <img src="assets/team/julien.png" width="120" alt="Julien Zammit"><br>
      <b>Julien Zammit</b><br>
      <sub>Co-founder and CEO</sub><br>
      <a href="https://x.com/JulienZammit1">X</a> &bull; <a href="https://www.linkedin.com/in/julienzammit">LinkedIn</a>
    </td>
    <td align="center" valign="top" width="200">
      <img src="assets/team/florentin.png" width="120" alt="Florentin Ledy"><br>
      <b>Florentin Ledy</b><br>
      <sub>Co-founder and CPTO</sub><br>
      <a href="https://www.linkedin.com/in/florentin-ledy">LinkedIn</a> &bull; <a href="https://github.com/FlorentinLedy">GitHub</a>
    </td>
    <td align="center" valign="top" width="200">
      <img src="assets/team/axel.png" width="120" alt="Axel Paulin"><br>
      <b>Axel Paulin</b><br>
      <sub>Co-founder and COO</sub><br>
      <a href="https://www.linkedin.com/in/axel-paulin">LinkedIn</a>
    </td>
  </tr>
</table>

<br>

<p align="center">If the audit found something in your code, a star helps other developers find the project.</p>

<br>

# Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.
To report a vulnerability, follow [SECURITY.md](SECURITY.md).
To talk with us, join [Discord](https://discord.gg/UPzm4n6SAJ).

## Licence

Open source under the GNU Affero General Public License v3 (AGPL-3.0-only, see LICENSE). Copyright (C) 2026 CybeDefend SAS. The network clause (AGPL section 13): if you modify it and let users interact with it over a network, you must offer them your modified source. This edition sends no telemetry: nothing leaves your instance for CybeDefend.

[LICENSE](LICENSE) &bull; [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) &bull; [TRADEMARKS.md](TRADEMARKS.md) &bull; [CONTRIBUTING.md](CONTRIBUTING.md) &bull; [SECURITY.md](SECURITY.md)

<br>

<p align="center"><sub>AGPL-3.0-only. The scanners keep their own licences. Built by <a href="https://cybedefend.com">CybeDefend</a>.<br>Snyk and GitHub are trademarks of their owners. CybeDefend is not affiliated with them.</sub></p>

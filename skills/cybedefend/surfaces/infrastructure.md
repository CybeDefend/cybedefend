# Surface: cloud, deployment and delivery

Read this page when the repository deploys itself (Terraform, Kubernetes or Helm, a compose file, serverless or edge functions, cloud permissions), builds and releases itself (CI workflows, release and signing, update channels, plugins or extensions), or reads its configuration at runtime. The scanners of step 1 (Trivy config, Checkov, zizmor, poutine) already report the known settings one by one: this page is for what they cannot see, **the path from an input to an identity, a credential or a release**.

**What counts.**
- A manifest is not a live exposure by itself. Say which environment uses it, which defaults or overlays change it, and whether that path is active.
- A wide permission is a finding when input from someone with fewer rights can reach the action it allows. Map each workload's identity to what it can do and to which resources.
- A reference to a secret is not a leaked secret. The flaw needs a lower-trust reader, an output, an artifact, a log or an unsafe fallback.
- Account policies, network attachments and hosted settings that the repository does not show are unknown: the flaw is a lead that names the one setting to check.

## Identities and permissions

- A workload, function, worker or node identity that can act on tenants, accounts or resources beyond its role, where a request or a job chooses the target.
- A role assumption, token exchange or workload federation that accepts a claim not bound to the source account, audience, repository, branch or namespace it should come from (a CI identity any fork or branch can obtain).
- An application that trusts an identity header, a tag, a label or an account id as if the cloud set it, when a caller or another workload can set it.

## Reachability

- An ingress, service, port mapping, load-balancer rule or server bind that puts an admin, debug, metrics or internal API on a public route the repository controls.
- A backend that accepts forwarded identity or a certificate subject from peers outside the intended proxy, or a second port or health path that skips it; a backend that opens up when the proxy is absent.
- A URL the server fetches that can reach the metadata service, a control socket or an internal API with the workload's credentials (follow it with the SSRF questions of [audit.md](../audit.md)).

## Containers and orchestration

- A workload that a less-trusted person can deploy with privileged mode, host namespaces, host paths, the container runtime socket or a service-account token that crosses into the node or the cluster.
- One deployment path that enforces image, namespace, secret or privilege rules, and another (a job, an upgrade, a restore) that does not.
- Network, admission or secret rules that select by a label, annotation or name a less-trusted person can set.

## Configuration and secrets

- Development values, chart defaults, environment variables or feature flags that turn off authentication, transport security, tenant scoping or the audit trail in a deployed environment. Read the final configuration of each environment the repository maintains, not only the base file.
- Secrets that reach logs, crash reports, process arguments, a shared environment, a wide volume, a build output or an API another workload or tenant can read.
- A credential that fails to mount, refresh or rotate, and an application that then falls back to a weaker mode or keeps the stale one.
- A bucket policy, object key, CDN origin or signed address that does not bind the person, the operation, the object, the audience or the expiry.
- An edge or serverless runtime that assumes a secret, isolation or tenant rule the origin runtime does not have, and a fallback that changes who is trusted.

## Build, release and update

- A workflow that runs code from an untrusted contributor (a fork's pull request, a comment, an issue title, a branch name) with secrets, a write token or a deploy right: `pull_request_target` or `workflow_run` that checks out the contributor's code, a `${{ }}` expression from the event inside a `run:` step, a self-hosted runner shared with releases.
- A cache, artifact or workspace written by an untrusted job and read by a privileged one.
- An automation token with more rights than its job; a release or package publish any branch can trigger.
- A dependency fetched from a mutable source (a branch, an unpinned tag, a URL, a registry that also serves a public package of the same name) in a path that ships.
- What is built is not what is released: an artifact replaced between build and promotion, a signature checked on another file, an update that accepts an older version or an unsigned one.
- A plugin or extension that receives more rights than its manifest declares, or loads code from where anyone can write.

**Render, then follow.** For each environment the repository maintains, render the final configuration (`helm template`, `kustomize build`, `terraform plan` output in the repository, the compose file with its overrides), then follow each workload's identity to what it can do, and each untrusted input of the pipeline to the secrets and rights of the job that reads it.

**Prove it.** A test or a local check that runs in the repository and touches nothing deployed: render the chart and assert the admin route is not on the public ingress; run the repository's policy tests (OPA, Conftest, Kyverno CLI, `terraform validate` with a plan file) on the rendered output; parse the workflow and assert no untrusted expression reaches a `run:` step of a job that holds secrets. No cloud account, no runner, no real credential. When the flaw depends on an account setting outside the repository, it stays a lead.

**Kinds:** `untrusted-code-in-privileged-workflow`, `service-identity-with-excess-rights`, `code-fetched-without-integrity-check`, `signature-not-verified`, `privilege-escalation`, `insecure-default`, `debug-endpoint-exposed`, `header-trusted`, `ssrf`, `signed-link-overreach`, `committed-secret`, `secret-in-logs`.

Adapted in part from the security-audit skill of Cloudflare, under the MIT License: see [NOTICE](../NOTICE).

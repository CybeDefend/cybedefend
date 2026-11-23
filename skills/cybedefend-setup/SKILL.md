---
name: cybedefend-setup
description: Install and configure a self-hosted CybeDefend AppSec Community Edition with Docker Compose, on a server, behind HTTPS or with scans on a Kubernetes cluster. Takes a default for each choice (import only, the MCP server on, this machine), asks only what it cannot decide (scans on a cluster it found, the domain of a server), confirms once, then writes the settings, connects the cluster and starts the stack. Use when someone wants to self-host the instance, put it on a server, connect a cluster or change its settings. To audit a repository on this machine, the cybedefend skill sets up a local instance by itself.
---

# CybeDefend AppSec Community Edition: guided setup

You install the Community Edition for the operator, from a clone of
`https://github.com/CybeDefend/cybedefend`, with Docker Compose. The reference
for every step is `deploy/community/README.md` in that clone: read the section
named in each step before you act, and follow it where it differs from this
file.

To audit a repository on this machine, the `cybedefend` skill of the same
repository (`/cybedefend`) runs this setup by itself with the defaults of step
2 and asks nothing. This skill is for the rest: a server, HTTPS, scans on a
Kubernetes cluster, the MCP server off.

## Rules

- **Ask only what you cannot decide.** Step 2 gives a default for each choice.
  Ask a question only where it says so, one decision at a time, with the
  choices you detected, and the multiple-choice question tool of your client
  when it has one. Then one confirmation before anything is written.
- **Never overwrite what the operator already has**: `secret-key`, `.env`,
  `cluster/kubeconfig`, `docker-compose.override.yml`. If one exists, read the
  settings it holds (not the secret values) and change only the lines this
  setup needs, after saying which ones.
- **Never print a secret**: the master key, the setup token, a ServiceAccount
  token. Write them to their file directly; tell the operator where to read
  them.
- **Name the kubectl context in every cluster command** (`--context <name>`),
  so nothing is applied to another cluster than the one the operator chose. Ask
  again before you apply anything to a cluster that is not on this machine.
- Run every command from `deploy/community` unless a step says otherwise.

## 1. Check the machine

- The clone: if the current directory is not a clone of the repository (no
  `deploy/community/docker-compose.yml`), ask where to clone it, then
  `git clone https://github.com/CybeDefend/cybedefend <dir>`.
- Docker with Docker Compose 2.24.4 or later: `docker compose version`. If
  Docker is missing or not running, stop and say how to install or start it.
- About 4 GB of RAM free for the containers, and `openssl`. On Windows
  without it, Node gives the same 32 random bytes:
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- `kubectl` and its contexts: `kubectl config get-contexts`. Note each context
  and whether its cluster runs on this machine: OrbStack (`orbstack`), Docker
  Desktop (`docker-desktop`), kind (`kind-…`), minikube, k3d, or a server
  elsewhere.

## 2. Decide, then confirm once

Take the default of each choice unless the operator already said otherwise.
Ask only question 1, and only when step 1 found a Kubernetes context; ask
question 3 only when the operator wants a server.

1. **Results: import only, or scans on a Kubernetes cluster?** Default: import
   only. Ask only when step 1 found a context.
   - *Import only*: any scanner's SARIF (and a CycloneDX SBOM with an SCA
     import) is sent to the API. No cluster needed.
   - *Scans on a cluster*: offer each context found in step 1, local ones
     first. The instance then starts one pod per scanner, in a namespace of
     its own, and imports keep working. If no context was found, say so and
     offer import only (a cluster can be connected later by running this
     setup again).
2. **The MCP server for coding agents**: on (the default: it starts with the
   stack) or off. Do not ask: off only when the operator says so.
3. **Where users open the instance** (`CYBEDEFEND_PUBLIC_URL`). Default: this
   machine. Ask for the domain only when the operator wants a server:
   - this machine only: `http://localhost:8080`;
   - this machine, with scans on a local cluster: `http://host.docker.internal:8080`
     (the scan pods cannot reach `localhost`, see step 4);
   - a server: its HTTPS address, behind a TLS proxy (README section
     « HTTPS »). Ask for the domain.

Repeat the choices back in one short list and wait for one yes.

## 3. Write the master key and the settings

README sections: « Quick start », « The secret key ».

- `secret-key`, only if it does not exist:
  `(umask 077 && openssl rand -base64 32 > secret-key)`. Tell the operator to
  back it up and never change it: it encrypts every credential of the
  instance.
- `.env`, only if it does not exist: `cp .env.example .env`. Then set:
  - `CYBEDEFEND_SETUP_TOKEN` to a fresh `openssl rand -base64 32`, written
    straight into the file;
  - `CYBEDEFEND_PUBLIC_URL` to the address of question 3;
  - with a public URL on `host.docker.internal`: also
    `CYBEDEFEND_STORAGE_PUBLIC_URL=http://host.docker.internal:9000` and
    `AUTH_COOKIE_INSECURE_LOCALHOST=true`;
  - on a server: `CYBEDEFEND_STORAGE_PUBLIC_URL` to the storage's HTTPS
    address, and the proxy of the README section « HTTPS ».

## 4. Connect the cluster (scans only)

README sections: « Run scans on a Kubernetes cluster » and, for OrbStack,
« A local cluster (OrbStack) ». `<ctx>` is the context the operator chose.

1. **Addresses.** The scan pods download the archive from
   `CYBEDEFEND_STORAGE_PUBLIC_URL` and send their results to
   `CYBEDEFEND_PUBLIC_URL`: both must be addresses the pods reach, never
   `localhost`.
   - A local cluster that shares the machine's Docker (OrbStack, Docker
     Desktop): `host.docker.internal`, set in step 3. The browser on this
     machine must resolve it too: if `/etc/hosts` has no
     `host.docker.internal` line, ask before adding
     `127.0.0.1 host.docker.internal` (it needs sudo).
   - A cluster elsewhere: the server's public addresses.
2. **Namespace and ServiceAccount.** `cybedefend-namespace.yaml` and
   `cybedefend-scanner.yaml`, next to the compose file, create the namespace
   `cybedefend-scans` (restricted Pod Security Standard), a ServiceAccount
   allowed to manage pods and Secrets there only, and its token. For another
   namespace, replace `cybedefend-scans` in both files. Apply:

   ```bash
   kubectl --context <ctx> apply -f cybedefend-namespace.yaml
   kubectl --context <ctx> apply -f cybedefend-scanner.yaml
   ```

3. **The API server's address, as the containers see it.** Read it with
   `kubectl config view --minify --context <ctx> -o jsonpath='{.clusters[0].cluster.server}'`.
   An address on `127.0.0.1` or `localhost` is the container itself inside
   `security-scanning`: OrbStack's is `https://k8s.orb.local:26443`. For
   another local cluster, find a name the containers resolve that its
   certificate covers (the README section « 2. Write the kubeconfig »); if
   there is none, say so and stop this step.
4. **The kubeconfig**, only if `cluster/kubeconfig` does not exist. It holds
   the ServiceAccount's token, never the operator's own credentials. Write it
   without printing the token:

   ```bash
   NS=cybedefend-scans KC=cluster/kubeconfig
   kubectl --context <ctx> -n "$NS" get secret cybedefend-scanner-token -o jsonpath='{.data.ca\.crt}' | base64 -d > cluster/ca.crt
   TOKEN=$(kubectl --context <ctx> -n "$NS" get secret cybedefend-scanner-token -o jsonpath='{.data.token}' | base64 -d)
   kubectl config --kubeconfig "$KC" set-cluster scans --server=<server of item 3> --certificate-authority=cluster/ca.crt --embed-certs=true
   kubectl config --kubeconfig "$KC" set-credentials cybedefend-scanner --token="$TOKEN"
   kubectl config --kubeconfig "$KC" set-context cybedefend-scanner --cluster=scans --user=cybedefend-scanner
   kubectl config --kubeconfig "$KC" use-context cybedefend-scanner
   rm cluster/ca.crt; unset TOKEN
   ```

   The services run as user 10001: on the operator's own machine
   `chmod 644 cluster/kubeconfig`; on a server
   `sudo chown 10001:10001 cluster/kubeconfig && sudo chmod 400 cluster/kubeconfig`.
5. **Turn scanning on**, in `.env`:
   `CYBEDEFEND_SCANNER_KUBECONFIG_FILE=/run/cybedefend-cluster/kubeconfig` and
   `CYBEDEFEND_SCANNER_NAMESPACE=cybedefend-scans`. On a local cluster, offer
   `CYBEDEFEND_SCANNER_KEEP_PODS=true` to read the logs of finished pods.
6. **Scanner images.** The pods run `ghcr.io/cybedefend/cybedefend-scanners/<name>`
   at `CYBEDEFEND_SCANNER_IMAGE_TAG`. A cluster that can pull from `ghcr.io`
   needs nothing. If the operator builds them (README « 3. Build the images »),
   only a cluster that shares the machine's Docker image store (OrbStack,
   Docker Desktop) sees them without a registry; another needs
   `CYBEDEFEND_SCANNER_IMAGE_REGISTRY`.

## 5. The MCP server

README section « The MCP server ». On by default: nothing to write. Off: write
`docker-compose.override.yml` next to `docker-compose.yml`, only if it does not
exist (otherwise add the two services to it):

```yaml
services:
  mcp:
    profiles: [disabled]
  mcp-redis:
    profiles: [disabled]
```

## 6. Start and check

- Start: `docker compose up -d`, with the published images
  (`ghcr.io/cybedefend/cybedefend-*` at `CYBEDEFEND_VERSION`). Only when they
  cannot be pulled, build them from this clone and say so (longer):
  `docker compose -f docker-compose.yml -f docker-compose.build.yml build`,
  then `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d`.
- Wait until `docker compose ps` shows every service healthy (a few minutes on
  the first start). For a service that is not, read its last log lines and fix
  the cause with the README section « Troubleshooting ».
- Scans: `docker compose logs security-scanning | grep CLUSTER_` must show
  `CLUSTER_SCANNING_ENABLED`. On `CLUSTER_SCANNING_DISABLED reason=…` or
  `CLUSTER_SCANNING_UNREACHABLE_ADDRESS`, follow the README list under
  « 3. Turn scanning on » (and, on OrbStack, « When it does not work » under
  « A local cluster (OrbStack) »), then `docker compose up -d` again
  (`docker compose restart` does not read `.env` again).
- A scan whose scanner pod fails: README « When a scanner fails » (its exit
  code, and how to read the pod's logs).
- MCP: `docker compose ps mcp` healthy, when on.

## 7. Hand over

Tell the operator, briefly:

- open `CYBEDEFEND_PUBLIC_URL` (exactly that address: sign-in loops on another
  one), and enter the setup token, which they read with
  `grep CYBEDEFEND_SETUP_TOKEN .env`, to create the first administrator;
- back up `secret-key`;
- with import only: create a personal access token in their profile and send
  results as the README section « Importing results » shows;
- with scans: create a project and start a scan, or link GitHub or GitLab
  (README « Optional integrations »);
- with the MCP server: its address, `CYBEDEFEND_MCP_PUBLIC_URL` followed by
  `/mcp` (`http://localhost:3010/mcp` by default), with a personal access token
  as bearer;
- what this setup wrote or changed, file by file.

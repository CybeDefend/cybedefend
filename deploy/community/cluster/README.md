# The cluster folder

`security-scanning` and `security-scanning-cron` mount this folder read-only
at `/run/cybedefend-cluster`.

To run scans on a Kubernetes cluster, put the kubeconfig here as `kubeconfig`,
readable by user 10001, then set in `.env`:

```bash
CYBEDEFEND_SCANNER_KUBECONFIG_FILE=/run/cybedefend-cluster/kubeconfig
CYBEDEFEND_SCANNER_NAMESPACE=<your namespace>
```

and run `docker compose up -d`.

The kubeconfig, and a client certificate or key placed here, hold credentials. `.gitignore` keeps every file of this folder but this README out of Git.

How to create the namespace, its ServiceAccount and Role, and the kubeconfig:
« Run scans on a Kubernetes cluster » in `../README.md`.

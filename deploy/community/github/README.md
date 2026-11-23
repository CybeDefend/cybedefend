# The github folder

`external-integrations`, its worker and its scheduler mount this folder
read-only at `/run/cybedefend-github`.

To give the GitHub App's private key as a file rather than in `.env`, put the
PEM GitHub gave you here as `private-key.pem`, readable by user 10001 (the
services' user) and nobody else:

```bash
cp ~/Downloads/<your-app>.private-key.pem github/private-key.pem
sudo chown 10001:10001 github/private-key.pem
sudo chmod 400 github/private-key.pem
```

then set in `.env`, instead of `GITHUB_PRIVATE_KEY`:

```bash
GITHUB_PRIVATE_KEY_FILE=/run/cybedefend-github/private-key.pem
```

and run `docker compose up -d`.

The key is a credential. `.gitignore` keeps every file of this folder but this
README out of Git.

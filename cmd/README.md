## Docker

```powershell
docker build -t footter-proxy-match .
docker compose up -d
```

By default compose serves `getsky.tech` on ports `80` and `443`, stores ACME certificates in the `footter_proxy_certs` volume, and uses:
By default compose serves `getsky.tech` on ports `80` and `443`, stores ACME certificates in `/var/lib/footter-proxy-match/certs`, and uses:

```text
ghcr.io/getsky/footer-visualizator/footter-proxy-match:latest
```

## GitHub CI/CD

Workflows:

- `.github/workflows/ci.yml`: runs `go test ./...` and Docker build.
- `.github/workflows/deploy.yml`: builds and pushes the image to GHCR, then deploys it over SSH with Docker Compose.

Required repository secrets for deploy:

```text
DEPLOY_HOST=91.105.196.41
DEPLOY_USER=root
DEPLOY_SSH_KEY=<private SSH key with access to the server>
```

If the GHCR package is private, also add:

```text
GHCR_USERNAME=<github username>
GHCR_TOKEN=<classic PAT or fine-grained token with package read access>
```

The deploy workflow can be started manually with `workflow_dispatch`. It also runs on pushes to `main` and `master`.

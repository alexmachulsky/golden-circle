# Compose Security Check

The hardened public deployment `docker-compose.prod.yml` must:

- publish only nginx on `127.0.0.1:7001`
- not publish the app container directly
- set `TRUSTED_IP_HEADER=x-real-ip`
- not set `DEPLOYMENT_MODE=local`
- back secrets via `*_FILE` Docker secrets (never plain `environment` values)

The default local-dev `docker-compose.yml` sets `DEPLOYMENT_MODE=local` (in-memory
rate limiter, relaxed public-production guards) and must publish only
`127.0.0.1:7001` (loopback) so a naive `docker compose up` is never network-exposed.
It is not for public deployment — use `docker-compose.prod.yml` or the k8s manifests
for that.

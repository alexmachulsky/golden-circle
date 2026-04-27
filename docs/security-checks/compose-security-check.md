# Compose Security Check

Default `docker-compose.yml` must:

- publish only nginx on `127.0.0.1:7001`
- not publish the app container directly
- set `TRUSTED_IP_HEADER=x-real-ip`
- not set `DEPLOYMENT_MODE=local`

`docker-compose.local.yml` may set `DEPLOYMENT_MODE=local`, but must publish only `127.0.0.1:7001`.

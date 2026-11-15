#!/usr/bin/env bash
set -euo pipefail
install -d -m 700 -o mongodb -g mongodb /run/rp-mongo
for rp_file in keyfile server.pem ca.crt root-password app-password; do
  install -m 400 -o mongodb -g mongodb "/rp-secrets/$rp_file" "/run/rp-mongo/$rp_file"
done
exec /usr/local/bin/docker-entrypoint.sh "$@"

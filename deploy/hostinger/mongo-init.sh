#!/usr/bin/env bash
set -euo pipefail
for ((rp_try=0; rp_try<90; rp_try++)); do
  if mongosh --host mongo --tls --tlsCAFile /rp-secrets/ca.crt --quiet /rp/mongo-replica.js >/dev/null 2>&1; then
    echo 'Authenticated TLS MongoDB replica set is ready.'
    exit 0
  fi
  sleep 2
done
echo 'MongoDB initialization did not complete; inspect database service diagnostics locally.' >&2
exit 1

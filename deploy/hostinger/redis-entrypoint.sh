#!/bin/sh
set -eu
mkdir -p /run/rp-redis
chmod 700 /run/rp-redis
for rp_file in password server.crt server.key ca.crt; do
  cp "/rp-secrets/$rp_file" "/run/rp-redis/$rp_file"
  chmod 400 "/run/rp-redis/$rp_file"
done
rp_password=$(cat /run/rp-redis/password)
case "$rp_password" in ''|*[!a-f0-9]*) echo 'Invalid generated Redis credential.' >&2; exit 1;; esac
umask 077
cat > /run/rp-redis/redis.conf <<EOF
bind 0.0.0.0
protected-mode yes
port 0
tls-port 6379
tls-cert-file /run/rp-redis/server.crt
tls-key-file /run/rp-redis/server.key
tls-ca-cert-file /run/rp-redis/ca.crt
tls-auth-clients no
requirepass $rp_password
dir /data
appendonly yes
appendfsync everysec
maxmemory 512mb
maxmemory-policy noeviction
EOF
unset rp_password
chown -R redis:redis /run/rp-redis
exec /usr/local/bin/docker-entrypoint.sh redis-server /run/rp-redis/redis.conf

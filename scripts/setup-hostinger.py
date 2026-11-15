#!/usr/bin/env python3
"""Create private first-install credentials and database TLS files; never overwrite."""
import argparse
import base64
import ipaddress
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile


def openssl(*args):
    subprocess.run(["openssl", *map(str, args)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def write_private(path, content):
    with path.open("x") as handle:
        handle.write(content)
    path.chmod(0o600)


def provision(directory, domain, expected_ip):
    if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}", domain):
        raise ValueError("Use a hostname without scheme or path.")
    ipaddress.IPv4Address(expected_ip)
    if not shutil.which("openssl"):
        raise ValueError("OpenSSL is required.")
    directory.mkdir(parents=True, exist_ok=True)
    env = directory / ".env.hostinger"
    destination = directory / ".hostinger-secrets"
    if env.exists() or env.is_symlink() or destination.exists() or destination.is_symlink():
        raise ValueError("Existing settings/secrets found. Setup never replaces credentials or encryption keys.")
    old_umask = os.umask(0o077)
    try:
        with tempfile.TemporaryDirectory(prefix=".rp-setup-", dir=directory) as temporary:
            root = Path(temporary)
            ca = root / "authority"
            ca.mkdir()
            openssl("req", "-x509", "-newkey", "rsa:3072", "-nodes", "-days", "3650",
                    "-keyout", ca / "ca.key", "-out", root / "ca.crt", "-subj", "/CN=RevenuePilot database CA",
                    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign")
            for service in ("mongo", "redis"):
                target = root / service
                target.mkdir()
                extension = target / "extensions.cnf"
                extension.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:" + service + ",DNS:localhost,IP:127.0.0.1\n")
                openssl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", target / "server.key",
                        "-out", target / "server.csr", "-subj", "/O=RevenuePilot/OU=Private databases/CN=" + service)
                openssl("x509", "-req", "-in", target / "server.csr", "-CA", root / "ca.crt", "-CAkey", ca / "ca.key",
                        "-set_serial", str(secrets.randbits(120) + 1), "-days", "365", "-sha256", "-extfile", extension, "-out", target / "server.crt")
                shutil.copyfile(root / "ca.crt", target / "ca.crt")
                if service == "mongo":
                    write_private(target / "server.pem", (target / "server.key").read_text() + (target / "server.crt").read_text())
                extension.unlink()
                (target / "server.csr").unlink()
            mongo_password, redis_password = secrets.token_hex(32), secrets.token_hex(32)
            write_private(root / "mongo/root-password", secrets.token_hex(32))
            write_private(root / "mongo/app-password", mongo_password)
            write_private(root / "mongo/keyfile", base64.b64encode(secrets.token_bytes(512)).decode())
            write_private(root / "redis/password", redis_password)
            (root / "ca.crt").chmod(0o644)
            settings = {
                "REVENUEPILOT_DOMAIN": domain, "WEB_ORIGIN": "https://" + domain,
                "REVENUEPILOT_EXPECTED_IPV4": expected_ip, "REVENUEPILOT_HTTP_PORT": "8081",
                "REVENUEPILOT_NETWORK_SUBNET": "172.30.84.0/24", "TRUST_PROXY_CIDRS": "172.30.84.0/24",
                "MONGODB_URI": "mongodb://revenuepilot:" + mongo_password + "@mongo:27017/revenuepilot?authSource=revenuepilot&replicaSet=rp-rs&tls=true&tlsCAFile=/run/revenuepilot/ca.crt",
                "REDIS_URL": "rediss://default:" + redis_password + "@redis:6379",
                "DATA_ENCRYPTION_KEY": secrets.token_hex(32), "ALLOW_REGISTRATION": "false",
                "ALLOW_LIVE_PROVIDERS": "false", "ALLOW_ACCOUNT_EMAIL": "false",
            }
            os.rename(root, destination)
            # Exclusive creation; a partial failure is retained for inspection, never regenerated.
            write_private(env, "\n".join(key + "=" + value for key, value in settings.items()) + "\n")
        print("Private settings and TLS material created. No secret values printed; no containers started.")
        print("Preserve .env.hostinger and .hostinger-secrets in an encrypted off-server backup before real data.")
    finally:
        os.umask(old_umask)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path.cwd())
    parser.add_argument("--domain", default="revenuepilot.codebegun.com")
    parser.add_argument("--expected-ip", default="200.97.164.244")
    args = parser.parse_args()
    try:
        provision(args.directory.resolve(), args.domain, args.expected_ip)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, (str(error) if isinstance(error, ValueError) else "Setup failed; existing generated files were preserved for inspection.") + "\n")

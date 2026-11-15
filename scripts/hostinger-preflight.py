#!/usr/bin/env python3
"""Read-only first-install checks. Never prints credentials or changes the VPS."""
import argparse
import ipaddress
import json
from pathlib import Path
import re
import shutil
import socket
import stat
import subprocess
import sys
from urllib.parse import parse_qs, urlsplit


def read_settings(path):
    values = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        if not sep or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError("Invalid environment file syntax; use KEY=value lines.")
        if key in values:
            raise ValueError("Duplicate environment setting.")
        values[key] = value.strip().strip("\"'")
    return values


def validate_settings(values):
    domain = values.get("REVENUEPILOT_DOMAIN", "")
    if not re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}", domain):
        raise ValueError("Set an exact public hostname, without scheme/path.")
    if values.get("WEB_ORIGIN") != "https://" + domain:
        raise ValueError("WEB_ORIGIN must match the selected HTTPS hostname.")
    ipaddress.IPv4Address(values.get("REVENUEPILOT_EXPECTED_IPV4", ""))
    if not re.fullmatch(r"[a-fA-F0-9]{64}", values.get("DATA_ENCRYPTION_KEY", "")):
        raise ValueError("Set a stable random encryption key on the host.")
    for name in ("MONGODB_URI", "REDIS_URL"):
        uri = urlsplit(values.get(name, ""))
        if not uri.hostname or not uri.username or not uri.password:
            raise ValueError(name + " requires a dedicated authenticated endpoint.")
        if name == "REDIS_URL" and uri.scheme != "rediss":
            raise ValueError("Redis requires TLS (rediss://).")
        if name == "MONGODB_URI":
            query = parse_qs(uri.query)
            if uri.scheme not in ("mongodb", "mongodb+srv"):
                raise ValueError("Invalid MongoDB URI scheme.")
            if uri.scheme == "mongodb" and (query.get("tls") != ["true"] or not query.get("replicaSet")):
                raise ValueError("MongoDB requires TLS and a replica set.")
            for option in ("tlsAllowInvalidCertificates", "tlsAllowInvalidHostnames", "tlsInsecure"):
                if query.get(option, ["false"])[0].lower() != "false":
                    raise ValueError("MongoDB certificate verification must remain enabled.")
            if query.get("tls") == ["false"] or query.get("ssl") == ["false"]:
                raise ValueError("MongoDB TLS cannot be disabled.")
    network = ipaddress.ip_network(values.get("REVENUEPILOT_NETWORK_SUBNET", "172.30.84.0/24"))
    if network.version != 4 or not network.subnet_of(ipaddress.ip_network("172.16.0.0/12")) or network.prefixlen < 24:
        raise ValueError("Use a dedicated /24 or smaller private Docker subnet in 172.16.0.0/12.")
    if values.get("TRUST_PROXY_CIDRS") != str(network):
        raise ValueError("Trust only the selected dedicated Docker proxy network.")
    port = int(values.get("REVENUEPILOT_HTTP_PORT", "8081"))
    if not 1024 <= port <= 65535:
        raise ValueError("Use an unprivileged loopback application port.")
    for flag in ("ALLOW_REGISTRATION", "ALLOW_LIVE_PROVIDERS", "ALLOW_ACCOUNT_EMAIL"):
        if values.get(flag, "false") != "false":
            raise ValueError("First installation keeps registration, providers and mail disabled.")
    return domain, network, port


def output(*args):
    # Do not echo failed command stderr: it may contain configuration values.
    result = subprocess.run(args, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError("Required host inspection command failed: " + args[0])
    return result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", default=".env.hostinger")
    args = parser.parse_args()
    path = Path(args.env).resolve()
    if not path.is_file():
        raise ValueError("Deployment environment file is missing.")
    if path.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise ValueError("Deployment environment file must be private (mode 600 or 400).")
    values = read_settings(path)
    domain, network, port = validate_settings(values)
    if not sys.platform.startswith("linux") or not Path("/etc/os-release").is_file():
        raise ValueError("Run host inspection on the selected Linux VPS.")
    for command in ("docker", "ss"):
        if not shutil.which(command):
            raise ValueError("Missing host prerequisite: " + command)
    output("docker", "compose", "version")
    for line in output("ss", "-H", "-lntu").splitlines():
        fields = line.split()
        if len(fields) >= 5:
            bound = fields[4].rsplit(":", 1)[-1]
            if bound in ("80", "443", str(port)):
                raise ValueError("A required port is occupied. Preserve its service; review an existing-proxy deployment instead.")
    network_ids = output("docker", "network", "ls", "-q").split()
    if network_ids:
        for item in json.loads(output("docker", "network", "inspect", *network_ids)):
            for config in item.get("IPAM", {}).get("Config", []) or []:
                subnet = config.get("Subnet")
                if subnet and ipaddress.ip_network(subnet).overlaps(network):
                    raise ValueError("The proposed Docker subnet already exists or overlaps. Review before installing.")
    addresses = {item[4][0] for item in socket.getaddrinfo(domain, 443, type=socket.SOCK_STREAM)}
    if addresses != {values["REVENUEPILOT_EXPECTED_IPV4"]}:
        raise ValueError("DNS is not exclusively the selected IPv4. Review existing A/AAAA/CDN routing before certificate issuance.")
    if shutil.disk_usage(path.parent).free < 10 * 1024**3:
        raise ValueError("Less than 10 GiB disk free; review capacity before building.")
    memory = Path("/proc/meminfo").read_text()
    available = re.search(r"MemAvailable:\s+(\d+) kB", memory)
    if not available or int(available.group(1)) < 2 * 1024**2:
        raise ValueError("Less than 2 GiB available RAM; review host capacity.")
    print("Host preflight passed: DNS, free ports/subnet, configuration and basic headroom.")
    print("No services changed. Database connectivity, backup/restore and load testing remain separate checks.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        # OS and timeout errors may contain paths/arguments; never print their text.
        print(str(error) if isinstance(error, ValueError) else "Host inspection failed; check prerequisites locally.", file=sys.stderr)
        sys.exit(1)

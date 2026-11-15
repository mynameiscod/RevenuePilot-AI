#!/usr/bin/env python3
"""Operate only the RevenuePilot production Compose project from this checkout."""
import argparse
import getpass
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
COMPOSE = ["docker", "compose", "--env-file", str(ROOT / ".env.hostinger"),
           "-f", str(ROOT / "compose.production.yaml"), "-f", str(ROOT / "compose.database.yaml"),
           "-f", str(ROOT / "compose.hostinger.yaml")]


def run(*args, **kwargs):
    return subprocess.run([*COMPOSE, *args], cwd=ROOT, check=True, **kwargs)


def first_owner():
    if not sys.stdin.isatty():
        raise ValueError("Owner setup requires an interactive private terminal.")
    name = input("Owner name: ").strip()
    email = input("Owner email: ").strip().lower()
    workspace = input("Workspace [CodeBegun]: ").strip() or "CodeBegun"
    password = getpass.getpass("New owner password (12–128 characters; hidden): ")
    if not 12 <= len(password) <= 128 or getpass.getpass("Confirm password: ") != password:
        raise ValueError("Password length or confirmation is invalid.")
    # Credentials are passed only on stdin, never command arguments or files.
    run("exec", "-T", "api", "node", "/app/dist/bootstrap-owner.mjs",
        input=json.dumps(dict(name=name, email=email, password=password, workspaceName=workspace)), text=True)


def publish():
    check = """import mongoose from 'mongoose';
try {
 if (process.env.ALLOW_REGISTRATION !== 'false' || process.env.ALLOW_LIVE_PROVIDERS !== 'false') throw Error();
 await mongoose.connect(process.env.MONGODB_URI);
 if (!(await mongoose.connection.db.collection('memberships').findOne({role:'owner'}))) throw Error();
 console.log('Owner exists; public registration and live providers are disabled.');
} catch { console.error('Publication check failed. Bootstrap an owner and keep private-mode flags disabled.'); process.exitCode=1; }
finally { await mongoose.disconnect(); }"""
    run("exec", "-T", "api", "node", "--input-type=module", "-e", check)
    run("up", "-d", "--wait", "--wait-timeout", "120", "edge")
    verify()


def verify():
    spec = importlib.util.spec_from_file_location("preflight", ROOT / "scripts/hostinger-preflight.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    values = module.read_settings(ROOT / ".env.hostinger")
    domain, _, _ = module.validate_settings(values)
    for attempt in range(12):
        try:
            with urllib.request.urlopen("https://" + domain + "/api/v1/public/config", timeout=10) as response:
                data = json.load(response)
            if data != dict(demo=False, registration=False, localPreview=False):
                raise ValueError("Unexpected public runtime configuration.")
            with urllib.request.urlopen("https://" + domain + "/", timeout=10) as response:
                if b"RevenuePilot" not in response.read():
                    raise ValueError("Application HTML was not identified.")
            print("HTTPS and application verified: https://" + domain)
            print("Sign in, enable MFA, configure forms and complete the staging journey before real leads.")
            return
        except Exception:
            if attempt == 11:
                raise ValueError("HTTPS is not verified yet. Inspect DNS and edge diagnostics locally; do not disable TLS verification.")
            time.sleep(5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "owner", "publish", "verify", "status"])
    args = parser.parse_args()
    if args.action == "start":
        subprocess.run([sys.executable, str(ROOT / "scripts/hostinger-preflight.py"), "--env", str(ROOT / ".env.hostinger")], check=True)
        run("config", "--quiet")
        run("up", "-d", "--build", "--wait", "--wait-timeout", "240", "api", "collector", "worker", "web")
        print("Private services started. Next: python3 scripts/hostingerctl.py owner")
    elif args.action == "owner":
        first_owner()
    elif args.action == "publish":
        publish()
    elif args.action == "verify":
        verify()
    else:
        run("ps", "-a")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, KeyboardInterrupt) as error:
        print(str(error) if isinstance(error, ValueError) else "Operation stopped. Preserve existing data/secrets and inspect the reported service status.", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Check actual generated certificate trust, private files and refusal to overwrite."""
import importlib.util
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent

def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

setup = module("setup-hostinger")
preflight = module("hostinger-preflight")

class SetupTests(unittest.TestCase):
    def test_private_trusted_material_and_stable_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)
            setup.provision(path, "pilot.example.test", "203.0.113.12")
            env = path / ".env.hostinger"
            initial = env.read_bytes()
            values = preflight.read_settings(env)
            preflight.validate_settings(values)
            self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)
            secrets = path / ".hostinger-secrets"
            self.assertEqual(stat.S_IMODE(secrets.stat().st_mode), 0o700)
            for service in ("mongo", "redis"):
                certificate = secrets / service / "server.crt"
                subprocess.run(["openssl", "verify", "-CAfile", str(secrets / "ca.crt"), "-verify_hostname", service, str(certificate)], check=True, stdout=subprocess.DEVNULL)
                subprocess.run(["openssl", "verify", "-CAfile", str(secrets / "ca.crt"), "-verify_ip", "127.0.0.1", str(certificate)], check=True, stdout=subprocess.DEVNULL)
                self.assertEqual(stat.S_IMODE((secrets / service / "server.key").stat().st_mode), 0o600)
            with self.assertRaises(ValueError):
                setup.provision(path, "pilot.example.test", "203.0.113.12")
            self.assertEqual(initial, env.read_bytes())
            for ignore in (".gitignore", ".dockerignore"):
                self.assertIn(".hostinger-secrets/", (ROOT / ignore).read_text())
                self.assertIn(".rp-setup-*/", (ROOT / ignore).read_text())

if __name__ == "__main__":
    unittest.main()

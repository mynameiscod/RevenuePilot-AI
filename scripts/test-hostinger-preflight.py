import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).with_name("hostinger-preflight.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class HostConfigurationTests(unittest.TestCase):
    def settings(self):
        return {
            "REVENUEPILOT_DOMAIN": "revenuepilot.example.test",
            "WEB_ORIGIN": "https://revenuepilot.example.test",
            "REVENUEPILOT_EXPECTED_IPV4": "203.0.113.12",
            "DATA_ENCRYPTION_KEY": "1" * 64,
            "MONGODB_URI": "mongodb://synthetic:synthetic@db.example.test/revenuepilot?tls=true&replicaSet=rs0",
            "REDIS_URL": "rediss://default:synthetic@redis.example.test:6379",
            "TRUST_PROXY_CIDRS": "172.30.84.0/24",
        }

    def test_valid_dedicated_authenticated_tls_settings(self):
        domain, network, port = preflight.validate_settings(self.settings())
        self.assertEqual(domain, "revenuepilot.example.test")
        self.assertEqual(str(network), "172.30.84.0/24")
        self.assertEqual(port, 8081)

    def test_invalid_or_insecure_dependencies_fail(self):
        cases = [
            ("MONGODB_URI", "mongodb://u:p@db/revenuepilot?replicaSet=rs0"),
            ("MONGODB_URI", "mongodb://u:p@db/revenuepilot?tls=true"),
            ("MONGODB_URI", "mongodb+srv://u:p@db/revenuepilot?tls=false"),
            ("MONGODB_URI", "mongodb+srv://u:p@db/revenuepilot?tlsAllowInvalidCertificates=true"),
            ("REDIS_URL", "redis://u:p@redis:6379"),
            ("REDIS_URL", "rediss://redis:6379"),
            ("TRUST_PROXY_CIDRS", "0.0.0.0/0"),
            ("REVENUEPILOT_NETWORK_SUBNET", "172.16.0.0/12"),
            ("WEB_ORIGIN", "https://wrong.example.test"),
            ("ALLOW_LIVE_PROVIDERS", "true"),
            ("ALLOW_REGISTRATION", "true"),
        ]
        for key, value in cases:
            with self.subTest(setting=key, value=value):
                values = self.settings()
                values[key] = value
                with self.assertRaises(ValueError):
                    preflight.validate_settings(values)

    def test_duplicate_settings_are_not_silently_overridden(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "settings"
            path.write_text("WEB_ORIGIN=https://first.example.test\nWEB_ORIGIN=https://second.example.test\n")
            with self.assertRaises(ValueError):
                preflight.read_settings(path)


unittest.main()

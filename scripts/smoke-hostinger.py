#!/usr/bin/env python3
"""Synthetic CI only: private owner, TLS databases, worker, persistence and restore."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
if os.environ.get("GITHUB_ACTIONS") != "true":
    raise SystemExit("Synthetic CI only; never run against a customer VPS.")
spec = importlib.util.spec_from_file_location("preflight", ROOT / "scripts/hostinger-preflight.py")
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)
settings = preflight.read_settings(ROOT / ".env.hostinger")
assert settings["REVENUEPILOT_DOMAIN"] == "revenuepilot.example.test"
assert settings["REVENUEPILOT_EXPECTED_IPV4"] == "203.0.113.12"
COMPOSE = ["docker", "compose", "-p", "revenuepilot-vps-ci", "--env-file", ".env.hostinger", "-f", "compose.production.yaml", "-f", "compose.database.yaml", "-f", "compose.hostinger.yaml"]

def run(*args, **kwargs):
    return subprocess.run([*COMPOSE, *args], cwd=ROOT, check=True, **kwargs)

owner = dict(name="Stack Owner", email="stack-owner@example.test", password="Synthetic-stack-password!", workspaceName="Stack Test")
run("exec", "-T", "api", "node", "dist/bootstrap-owner.mjs", input=json.dumps(owner), text=True)
repeat = subprocess.run([*COMPOSE, "exec", "-T", "api", "node", "dist/bootstrap-owner.mjs"], input=json.dumps(owner), text=True, capture_output=True)
assert repeat.returncode != 0, "A second owner bootstrap must be refused"
subprocess.run(["node", "scripts/smoke-stack.mjs"], cwd=ROOT, env={**os.environ, "RP_SMOKE_PRODUCTION": "true"}, check=True)

run("exec", "-T", "api", "node", "--input-type=module", "-e", """
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
await mongoose.connect(process.env.MONGODB_URI);
await assert.rejects(mongoose.connection.db.admin().command({usersInfo: 1}), e => e.code === 13);
await mongoose.connection.db.collection('ci_persistence').insertOne({_id:'survives-restart'});
const redis = new Redis(process.env.REDIS_URL);
await redis.set('ci:persistence', 'survives-restart'); await redis.quit();
await mongoose.disconnect();
console.log('Application database role is restricted; persistence markers written.');
""")
unauth = run("exec", "-T", "redis", "redis-cli", "--tls", "--cacert", "/run/rp-redis/ca.crt", "-h", "redis", "ping", capture_output=True, text=True)
assert "NOAUTH" in unauth.stdout, "Redis must reject unauthenticated access"
run("restart", "mongo", "redis")
run("up", "-d", "--wait", "--wait-timeout", "180", "api", "collector", "worker", "web")
run("exec", "-T", "api", "node", "--input-type=module", "-e", """
import assert from 'node:assert/strict'; import mongoose from 'mongoose'; import { Redis } from 'ioredis';
await mongoose.connect(process.env.MONGODB_URI);
assert.equal(await mongoose.connection.db.collection('ci_persistence').countDocuments({_id:'survives-restart'}), 1);
assert.equal(await mongoose.connection.db.collection('users').countDocuments(), 1);
const redis = new Redis(process.env.REDIS_URL); assert.equal(await redis.get('ci:persistence'),'survives-restart');
await redis.quit(); await mongoose.disconnect(); console.log('MongoDB and Redis survived restart.');
""")
run("stop", "-t", "30", "web", "api", "collector", "worker")
# The password is read inside Mongo into a private tmpfs config; never an argument/log.
run("exec", "-T", "mongo", "mongosh", "--nodb", "--quiet", "--eval", "fs.writeFileSync('/run/rp-mongo/backup.yml', JSON.stringify({uri:'mongodb://rp_admin@mongo:27017/?authSource=admin',password:fs.readFileSync('/run/rp-mongo/root-password','utf8').trim()}), {mode:0o600});")
try:
    with tempfile.TemporaryFile() as archive:
        run("exec", "-T", "mongo", "mongodump", "--config", "/run/rp-mongo/backup.yml", "--ssl", "--sslCAFile", "/run/rp-mongo/ca.crt", "--db", "revenuepilot", "--archive", "--gzip", stdout=archive)
        archive.seek(0)
        run("exec", "-T", "mongo", "mongorestore", "--config", "/run/rp-mongo/backup.yml", "--ssl", "--sslCAFile", "/run/rp-mongo/ca.crt", "--archive", "--gzip", "--nsFrom=revenuepilot.*", "--nsTo=rp_restore_check.*", stdin=archive)
    run("exec", "-T", "mongo", "mongosh", "--host", "mongo", "--tls", "--tlsCAFile", "/run/rp-mongo/ca.crt", "--quiet", "--eval", """
if(!db.getSiblingDB('admin').auth('rp_admin', fs.readFileSync('/run/rp-mongo/root-password','utf8').trim())) quit(1);
const source=db.getSiblingDB('revenuepilot'), restored=db.getSiblingDB('rp_restore_check');
for (const name of source.getCollectionNames().filter(n=>n!=='rate_buckets')) {
 if(source.getCollection(name).countDocuments({}) !== restored.getCollection(name).countDocuments({})) throw Error('Restore mismatch');
}
if(restored.users.countDocuments() !== 1 || restored.leads.countDocuments() !== 2) throw Error('Restore data absent');
print('Authenticated TLS backup and isolated restore verified.');
""")
finally:
    run("exec", "-T", "mongo", "rm", "-f", "/run/rp-mongo/backup.yml")

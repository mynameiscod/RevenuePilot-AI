import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env")) {
  console.log(".env already exists; it was not changed.");
  process.exit(0);
}
writeFileSync(
  ".env",
  `NODE_ENV=development\nMONGODB_URI=mongodb://127.0.0.1:27017/revenuepilot?replicaSet=rp-rs&directConnection=true\nREDIS_URL=redis://localhost:6379\nDATA_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\nWEB_ORIGIN=http://localhost:3001\nAPI_PORT=4000\nALLOW_REGISTRATION=true\nREVENUEPILOT_DEMO=false\n`,
  { mode: 0o600 },
);
console.log(
  "Created a private .env with a new encryption key. Keep this key stable for existing encrypted data.",
);

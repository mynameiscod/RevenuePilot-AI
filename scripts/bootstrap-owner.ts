import mongoose from "mongoose";
import { readConfig } from "../apps/api/src/config.ts";
import { connectDatabase } from "../apps/api/src/db.ts";
import { bootstrapOwner } from "../apps/api/src/bootstrap.ts";
try {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk.toString();
    if (Buffer.byteLength(data) > 16384) throw new Error("INPUT_TOO_LARGE");
  }
  const input: unknown = JSON.parse(data);
  const config = readConfig();
  await connectDatabase(config.MONGODB_URI);
  await bootstrapOwner(input, config);
  console.log(
    "First owner created. Public registration remains disabled. Sign in and enable MFA.",
  );
} catch {
  console.error(
    "Owner not confirmed. Check valid input, database readiness, or an existing owner/bootstrap. Never rerun setup to replace credentials.",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}

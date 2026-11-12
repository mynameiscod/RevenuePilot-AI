import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
  WEB_ORIGIN: z.url().default("http://localhost:3001"),
  API_PORT: z.coerce.number().default(4000),
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  REVENUEPILOT_DEMO: z.enum(["true", "false"]).default("false"),
});
export type Config = z.infer<typeof schema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid server configuration: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}. Run npm run setup:env. No fallback encryption key is permitted.`,
    );
  if (
    result.data.NODE_ENV === "production" &&
    (result.data.REVENUEPILOT_DEMO === "true" ||
      !result.data.WEB_ORIGIN.startsWith("https://"))
  )
    throw new Error("Production requires HTTPS and forbids demo mode.");
  return result.data;
}

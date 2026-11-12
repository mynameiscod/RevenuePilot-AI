import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
  WEB_ORIGIN: z
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    }, "Use an HTTP(S) origin without credentials, path, query or fragment")
    .transform((value) => new URL(value).origin)
    .default("http://localhost:3001"),
  API_PORT: z.coerce.number().default(4000),
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  REVENUEPILOT_DEMO: z.enum(["true", "false"]).default("false"),
  ALLOW_LIVE_PROVIDERS: z.enum(["true", "false"]).default("false"),
  ALLOW_ACCOUNT_EMAIL: z.enum(["true", "false"]).default("false"),
  ACCOUNT_EMAIL_FROM: z.email().optional(),
  AWS_REGION: z
    .string()
    .regex(/^[a-z]{2}-[a-z]+-\d$/)
    .default("ap-south-1"),
  BILLING_STRIPE_SECRET_KEY: z.string().optional(),
  BILLING_STRIPE_WEBHOOK_SECRET: z.string().optional(),
  BILLING_PRICE_GROWTH: z
    .string()
    .regex(/^price_[A-Za-z0-9]+$/)
    .optional(),
  BILLING_PRICE_SCALE: z
    .string()
    .regex(/^price_[A-Za-z0-9]+$/)
    .optional(),
});
export type Config = z.infer<typeof schema>;
export function allowedWebOrigins(config: Config): Set<string> {
  const origins = new Set([config.WEB_ORIGIN]);
  const url = new URL(config.WEB_ORIGIN);
  if (
    config.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(url.hostname)
  ) {
    // Keep the configured scheme and port. No wildcard, request Host header,
    // other loopback addresses, or production aliases establish trust.
    for (const host of ["localhost", "127.0.0.1"]) {
      url.hostname = host;
      origins.add(url.origin);
    }
  }
  return origins;
}
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
  if (
    result.data.REVENUEPILOT_DEMO === "true" &&
    result.data.ALLOW_LIVE_PROVIDERS === "true"
  )
    throw new Error("Demo mode forbids live provider execution.");
  if (
    result.data.NODE_ENV === "production" &&
    result.data.BILLING_STRIPE_SECRET_KEY &&
    !/^(sk|rk)_live_/.test(result.data.BILLING_STRIPE_SECRET_KEY)
  )
    throw new Error("Production billing requires live Stripe credentials.");
  return result.data;
}

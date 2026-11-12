import { RateBucket } from "./models.ts";
import { digest } from "./security.ts";
import { AppError } from "./errors.ts";
export async function rateLimit(
  key: string,
  limit: number,
  intervalMs = 60000,
) {
  const bucket = Math.floor(Date.now() / intervalMs);
  const result = await RateBucket.findOneAndUpdate(
    { _id: digest(`${key}:${bucket}`) },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((bucket + 2) * intervalMs) },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();
  if (result!.count > limit)
    throw new AppError(
      429,
      "RATE_LIMITED",
      "Too many requests. Please try again later.",
    );
}

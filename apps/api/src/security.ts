import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const randomToken = () => randomBytes(32).toString("base64url");
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const passwordHash = (password: string) =>
  hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
export const passwordMatches = (encoded: string, password: string) =>
  verify(encoded, password);
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function seal(value: unknown, key: string, tenantId: string): string {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(tenantId));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}
export function unseal<T>(value: string, key: string, tenantId: string): T {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1") throw new Error("Unsupported ciphertext version");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(tenantId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8"),
  ) as T;
}
export const lookupHash = (value: string, key: string, tenantId: string) =>
  createHmac("sha256", Buffer.from(key, "hex"))
    .update(`${tenantId}:${value.toLowerCase().trim()}`)
    .digest("hex");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buffer: Buffer) {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i < bits.length; i += 5)
    output += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return output;
}
function decode32(value: string) {
  const bits = [...value]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}
export function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", decode32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
export function totpStep(secret: string, code: string, now = Date.now()) {
  const step = Math.floor(now / 30000);
  return [step - 1, step, step + 1].find((s) => equal(totp(secret, s), code));
}

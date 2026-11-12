export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly ambiguous = false,
    public readonly retryAfter?: number,
  ) {
    super(code);
  }
}
export type Transport = typeof fetch;
export const providerId = (value: string) => {
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(value))
    throw new ProviderError("INVALID_PROVIDER_IDENTIFIER");
  return value;
};
export async function providerJson(
  url: URL | string,
  init: RequestInit = {},
  transport: Transport = fetch,
) {
  const u = new URL(url);
  const allowed = [
    "api.stripe.com",
    "api.razorpay.com",
    "api.hubapi.com",
    "graph.facebook.com",
    "googleads.googleapis.com",
    "datamanager.googleapis.com",
    "oauth2.googleapis.com",
    "api.openai.com",
    "api.anthropic.com",
    "api.outpero.com",
    "app.outpero.com",
  ];
  if (
    u.protocol !== "https:" ||
    !allowed.includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port
  )
    throw new ProviderError("PROVIDER_DESTINATION_DENIED");
  let response: Response;
  try {
    response = await transport(u, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ProviderError(
      "PROVIDER_UNREACHABLE",
      init.method !== undefined && init.method !== "GET",
    );
  }
  if (!response.ok)
    throw new ProviderError(
      response.status === 429
        ? "PROVIDER_RATE_LIMIT"
        : response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH_FAILED"
          : "PROVIDER_REQUEST_FAILED",
      response.status >= 500 &&
        init.method !== undefined &&
        init.method !== "GET",
      Number(response.headers.get("retry-after")) || undefined,
    );
  const reader = response.body?.getReader();
  if (!reader)
    throw new ProviderError(
      "PROVIDER_EMPTY_RESPONSE",
      !!init.method && init.method !== "GET",
    );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new ProviderError(
        "PROVIDER_RESPONSE_TOO_LARGE",
        !!init.method && init.method !== "GET",
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ProviderError(
      "PROVIDER_INVALID_JSON",
      !!init.method && init.method !== "GET",
    );
  }
}

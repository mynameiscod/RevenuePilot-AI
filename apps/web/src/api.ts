let csrfToken = "";
export const setCsrf = (token: string) => {
  csrfToken = token;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    headers,
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.code ?? "REQUEST_FAILED",
      body.errors
        ?.map(
          (e: { path: string; message: string }) =>
            `${e.path || "Details"}: ${e.message}`,
        )
        .join(" · ") ||
        body.title ||
        "Unable to complete the request.",
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const mutate = <T>(
  path: string,
  body: unknown,
  method = "POST",
  operationKey = crypto.randomUUID(),
) =>
  api<T>(path, {
    method,
    body: JSON.stringify(body),
    headers: { "Idempotency-Key": operationKey },
  });

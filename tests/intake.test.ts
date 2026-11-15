import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntake } from "../packages/sdk/src/intake.ts";
const formKey = "form_synthetic_website_test";
const options = { apiOrigin: "https://rp.example.test", formKey };
let saved = new Map<string, string>();
function browser(
  search = "?rp_link=ml_synthetic&utm_source=google&utm_medium=cpc&email=PRIVATE",
) {
  vi.stubGlobal("window", {
    location: {
      origin: "https://www.example.test",
      pathname: "/courses/java",
      search,
    },
    sessionStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    },
  });
  vi.stubGlobal("document", { referrer: "" });
}
const ok = {
  ok: true,
  status: 201,
  json: async () => ({
    accepted: true,
    acceptanceToken: "synthetic-acceptance",
    expiresInSeconds: 86400,
  }),
};
const input = {
  name: "Synthetic",
  email: "student@example.test",
  privacyConsent: true as const,
  marketingConsent: false,
  consentVersion: "1",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  saved = new Map();
});
describe("website intake delivery", () => {
  it("keeps measurement optional and submits an enquiry without emitting source data", async () => {
    browser();
    const fetcher = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetcher);
    const intake = createIntake(options);
    expect(await intake.record("viewed")).toEqual({ collected: false });
    await intake.submit(input);
    const payload = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      entryPoint: "website",
      trackingConsent: false,
      adConsent: false,
    });
    expect(payload.touch).toBeUndefined();
    expect(saved.size).toBe(0);
    expect(fetcher.mock.calls[0][1].credentials).toBe("omit");
  });
  it("deduplicates observations and simultaneous submissions, freezing the original campaign", async () => {
    browser();
    const fetcher = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetcher);
    const intake = createIntake(options);
    intake.setConsent({ tracking: true, advertising: false });
    window.location.search = "?utm_source=meta";
    await Promise.all([intake.record("viewed"), intake.record("viewed")]);
    await Promise.all([intake.submit(input), intake.submit(input)]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(payload.touch.source).toBe("google");
    expect(JSON.stringify(payload)).not.toContain("PRIVATE");
  });
  it("retries the exact original payload after a lost acknowledgement and blocks edits", async () => {
    browser();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetcher);
    const intake = createIntake(options);
    await expect(intake.submit(input)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
    await expect(
      intake.submit({ ...input, name: "Changed" }),
    ).rejects.toMatchObject({ code: "RETRY_ORIGINAL" });
    intake.setConsent({ tracking: true, advertising: true });
    await intake.submit(input);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
  });
  it("stops new telemetry on withdrawal while an uncertain submission can replay unchanged", async () => {
    browser();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetcher);
    const intake = createIntake({ ...options, storage: "session" });
    intake.setConsent({ tracking: true, advertising: true });
    await expect(intake.submit(input)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
    intake.setConsent({ tracking: false, advertising: false });
    expect(saved.size).toBe(0);
    expect(await intake.record("started")).toEqual({ collected: false });
    await intake.submit(input);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[0][1].body);
  });
  it("does not restore an expired campaign or attempt", async () => {
    browser();
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetcher);
    const first = createIntake({ ...options, storage: "session" });
    first.setConsent({ tracking: true, advertising: false });
    await first.record("viewed");
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    browser("");
    const second = createIntake({ ...options, storage: "session" });
    second.setConsent({ tracking: true, advertising: false });
    await second.record("viewed");
    const [a, b] = fetcher.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(b.attemptId).not.toBe(a.attemptId);
    expect(b.touch.marketingKey).not.toBe("ml_synthetic");
  });
  it("permits correction after a definitive validation error and retains diagnostic IDs", async () => {
    browser();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 422,
          json: async () => ({
            title: "Check input",
            code: "VALIDATION_FAILED",
            requestId: "req-synthetic",
          }),
        })
        .mockResolvedValue(ok),
    );
    const intake = createIntake(options);
    await expect(intake.submit(input)).rejects.toMatchObject({
      retryable: false,
      requestId: "req-synthetic",
    });
    await expect(
      intake.submit({ ...input, name: "Corrected" }),
    ).resolves.toMatchObject({ accepted: true });
  });
  it("bounds a hanging request and handles invalid proxy responses without false success", async () => {
    browser();
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init.signal.addEventListener("abort", () =>
              reject(new Error("timeout")),
            ),
          ),
      ),
    );
    const intake = createIntake({ ...options, timeoutMs: 100 });
    const rejected = expect(intake.submit(input)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(101);
    await rejected;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    await expect(intake.submit(input)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("restores same-tab campaign and attempt only after consent and clears on withdrawal", async () => {
    browser();
    const fetcher = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetcher);
    const first = createIntake({ ...options, storage: "session" });
    expect(saved.size).toBe(0);
    first.setConsent({ tracking: true, advertising: false });
    await first.record("viewed");
    expect([...saved.values()].join("")).not.toContain("PRIVATE");
    browser("");
    const second = createIntake({ ...options, storage: "session" });
    await second.record("viewed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    second.setConsent({ tracking: true, advertising: false });
    await second.record("started");
    const [a, b] = fetcher.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(b.attemptId).toBe(a.attemptId);
    expect(b.touch.marketingKey).toBe("ml_synthetic");
    second.setConsent({ tracking: false, advertising: false });
    expect(saved.size).toBe(0);
    await second.submit(input);
    expect(JSON.parse(fetcher.mock.calls[2][1].body).touch).toBeUndefined();
  });
  it("starts a distinct attempt for a new campaign and tolerates blocked storage", async () => {
    browser();
    const fetcher = vi.fn().mockResolvedValue(ok);
    vi.stubGlobal("fetch", fetcher);
    const first = createIntake({ ...options, storage: "session" });
    first.setConsent({ tracking: true, advertising: false });
    await first.record("viewed");
    browser("?rp_link=ml_another&utm_source=meta&utm_medium=paid_social");
    const second = createIntake({ ...options, storage: "session" });
    second.setConsent({ tracking: true, advertising: false });
    await second.record("viewed");
    const [a, b] = fetcher.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(b.attemptId).not.toBe(a.attemptId);
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("blocked");
      },
    });
    const third = createIntake({ ...options, storage: "session" });
    third.setConsent({ tracking: true, advertising: false });
    await expect(third.submit(input)).resolves.toMatchObject({
      accepted: true,
    });
  });
});

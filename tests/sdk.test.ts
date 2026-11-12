import { afterEach, describe, expect, it, vi } from "vitest";
import { createTracker } from "../packages/sdk/src/index.ts";

describe("browser telemetry privacy and delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const options = {
    endpoint: "https://collector.example.test/api/v1/collect",
    siteKey: "pk_synthetic_test_site_key",
  };
  it("requires consent, excludes query and fragment, and rotates identity after withdrawal", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", {
      pathname: "/courses/java",
      search: "?email=private",
      hash: "#private",
    });
    const bodies: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        expect(init.credentials).toBe("omit");
        return {
          ok: true,
          json: async () => ({
            acceptedIds: body.events.map((e: any) => e.eventId),
            duplicateIds: [],
            rejected: [],
          }),
        };
      }),
    );
    const tracker = createTracker(options);
    tracker.track("page.viewed.v1");
    await tracker.flush();
    expect(bodies).toHaveLength(0);
    tracker.grantConsent();
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies[0].events[0].path).toBe("/courses/java");
    expect(JSON.stringify(bodies)).not.toContain("private");
    const original = bodies[0].events[0].anonymousId;
    tracker.revokeConsent();
    tracker.track("page.viewed.v1");
    await vi.advanceTimersByTimeAsync(5000);
    expect(bodies).toHaveLength(1);
    tracker.grantConsent();
    await vi.advanceTimersByTimeAsync(0);
    expect(bodies[1].events[0].anonymousId).not.toBe(original);
    tracker.destroy();
  });
  it("retries the same event ID after rate limiting and clears only acknowledged events", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { pathname: "/" });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockImplementation(async (_url, init) => ({
        ok: true,
        json: async () => ({
          acceptedIds: JSON.parse(init.body).events.map((e: any) => e.eventId),
          duplicateIds: [],
          rejected: [],
        }),
      }));
    vi.stubGlobal("fetch", fetcher);
    const tracker = createTracker(options);
    tracker.grantConsent();
    await vi.advanceTimersByTimeAsync(0);
    await tracker.flush();
    await tracker.flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const sent = fetcher.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(sent[0].events[0].eventId).toBe(sent[1].events[0].eventId);
    tracker.destroy();
  });
  it("requires explicit form identity and bounds an offline queue to 100 events", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("location", { pathname: "/" });
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetcher);
    const tracker = createTracker(options);
    tracker.grantConsent();
    await vi.advanceTimersByTimeAsync(0);
    expect(() => tracker.track("form.started.v1")).toThrow(/formId/);
    for (let i = 0; i < 110; i++) tracker.track("page.viewed.v1");
    await vi.advanceTimersByTimeAsync(0);
    const delivered: string[] = [];
    fetcher.mockImplementation(async (_url, init) => {
      const ids = JSON.parse(init.body).events.map((e: any) => e.eventId);
      delivered.push(...ids);
      return {
        ok: true,
        json: async () => ({
          acceptedIds: ids,
          duplicateIds: [],
          rejected: [],
        }),
      };
    });
    await tracker.flush();
    await tracker.flush();
    await tracker.flush();
    expect(new Set(delivered).size).toBe(100);
    tracker.destroy();
  });
});

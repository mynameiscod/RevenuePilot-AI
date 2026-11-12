import type { BrowserEvent } from "../../core/src/contracts.ts";

export interface TrackerOptions {
  endpoint: string;
  siteKey: string;
}
/** Explicit-consent, memory-only tracker. It never reads input values or sends query strings. */
export function createTracker(options: TrackerOptions) {
  let consent = false,
    anonymousId = crypto.randomUUID(),
    sessionId = crypto.randomUUID();
  let queue: BrowserEvent[] = [],
    sending = false;
  async function flush() {
    if (!consent || sending || !queue.length) return;
    sending = true;
    const batch = queue.slice(0, 50);
    try {
      const res = await fetch(options.endpoint, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteKey: options.siteKey, events: batch }),
      });
      if (res.ok) {
        const body = await res.json();
        const done = new Set([
          ...body.acceptedIds,
          ...body.duplicateIds,
          ...body.rejected.map((e: { eventId: string }) => e.eventId),
        ]);
        queue = queue.filter((e) => !done.has(e.eventId));
      } else if (res.status >= 400 && res.status < 500 && res.status !== 429)
        queue = queue.filter(
          (e) => !batch.some((b) => b.eventId === e.eventId),
        );
    } catch {
      /* Transient failures retain only a bounded in-memory queue. */
    } finally {
      sending = false;
    }
  }
  function track(
    type: BrowserEvent["type"],
    form?: { formId: string; attemptId: string },
  ) {
    if (!consent || queue.length >= 100) return;
    if (type !== "page.viewed.v1" && !form)
      throw new Error("Form events require formId and attemptId.");
    queue.push({
      type,
      payload: form ?? {},
      eventId: crypto.randomUUID(),
      anonymousId,
      sessionId,
      occurredAt: new Date().toISOString(),
      path: location.pathname,
      consent: "granted",
    } as BrowserEvent);
    void flush();
  }
  const timer = setInterval(() => void flush(), 5000);
  return {
    grantConsent() {
      if (!consent) {
        consent = true;
        track("page.viewed.v1");
      }
    },
    revokeConsent() {
      consent = false;
      queue = [];
      anonymousId = crypto.randomUUID();
      sessionId = crypto.randomUUID();
    },
    track,
    flush,
    destroy() {
      clearInterval(timer);
      queue = [];
      consent = false;
    },
  };
}
export { createIntake, type IntakeConsent } from "./intake.ts";

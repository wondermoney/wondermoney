import posthog from "posthog-js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { track } from "./track";

vi.mock("posthog-js", () => ({ default: { capture: vi.fn() } }));

/** `track` as an untyped caller would reach it: only a cast gets an unknown event this far. */
const untypedTrack = track as unknown as (event: string, properties?: Record<string, unknown>) => void;

describe("track", () => {
  afterEach(() => vi.clearAllMocks());

  it("sends nothing for an event that is not a catalogued web event", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    untypedTrack("account_delete", { accountKey: 12 });
    untypedTrack("bank_connection_abandoned", { provider: "enable_banking" });

    expect(posthog.capture).not.toHaveBeenCalled();
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      "Analytics event account_delete dropped: account_delete is not in the event catalogue",
      "Analytics event bank_connection_abandoned dropped: bank_connection_abandoned is not sent from web",
    ]);
  });

  it("does not compile for an event outside the catalogue", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // @ts-expect-error web events come from the catalogue; a mobile-only event is not one
    track("bank_connection_abandoned", { provider: "enable_banking" });
    // @ts-expect-error nor is a name that was never catalogued
    track("account_delete");
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

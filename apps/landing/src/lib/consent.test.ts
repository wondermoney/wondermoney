import { describe, expect, it } from "vitest";

import {
  CONSENT_STORAGE_KEY,
  createConsentDecision,
  defaultConsentDecision,
  parseConsentDecision,
  readConsentDecision,
  writeConsentDecision,
} from "./consent";
import { readConsentPreviewState } from "./consentPreview";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("parseConsentDecision", () => {
  it("treats malformed, unknown, and mismatched versions as denied", () => {
    // Given
    const malformedStates = [
      "not-json",
      JSON.stringify({
        version: "consent.v2",
        purposes: { necessary: true, analytics: true, ads: true },
      }),
      JSON.stringify({
        version: "consent.v1",
        purposes: { necessary: false, analytics: true, ads: true },
        decidedAt: 1_784_052_000,
      }),
      JSON.stringify({
        version: "consent.v1",
        purposes: {
          necessary: true,
          analytics: true,
          ads: true,
          profiling: true,
        },
        decidedAt: 1_784_052_000,
      }),
    ];

    // When
    const decisions = malformedStates.map(parseConsentDecision);

    // Then
    expect(decisions).toEqual(
      malformedStates.map(() => defaultConsentDecision()),
    );
  });
});

describe("consent storage", () => {
  it("persists only versioned purpose decisions with necessary storage enabled", () => {
    // Given
    const storage = createMemoryStorage();
    const decision = createConsentDecision(
      { analytics: true, ads: false },
      () => 1_784_052_000,
    );

    // When
    const stored = writeConsentDecision(storage, decision);
    const restored = readConsentDecision(storage);

    // Then
    expect(stored).toBe(true);
    expect(restored).toEqual({
      version: "consent.v1",
      purposes: { necessary: true, analytics: true, ads: false },
      decidedAt: 1_784_052_000,
    });
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toBe(JSON.stringify(restored));
  });

  it("fails denied when durable storage cannot be read or written", () => {
    // Given
    const storage: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => {
        throw new DOMException("blocked");
      },
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException("blocked");
      },
    };
    const permissive = createConsentDecision(
      { analytics: true, ads: true },
      () => 1_784_052_000,
    );

    // When
    const restored = readConsentDecision(storage);
    const stored = writeConsentDecision(storage, permissive);

    // Then
    expect(restored).toEqual(defaultConsentDecision());
    expect(stored).toBe(false);
  });
});

describe("readConsentPreviewState", () => {
  it("accepts deterministic states only in development", () => {
    // Given
    const search = "?consentPreview=failure";

    // When
    const development = readConsentPreviewState(search, true);
    const production = readConsentPreviewState(search, false);
    const unknown = readConsentPreviewState("?consentPreview=unknown", true);

    // Then
    expect(development).toBe("failure");
    expect(production).toBeNull();
    expect(unknown).toBeNull();
  });
});

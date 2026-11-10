import { z } from "zod";

export const CONSENT_STORAGE_KEY = "wondermoney.consent.v1";
export const CONSENT_CHANGE_EVENT = "wondermoney:consent-changed";

const ConsentDecisionSchema = z.strictObject({
  version: z.literal("consent.v1"),
  purposes: z.strictObject({
    necessary: z.literal(true),
    analytics: z.boolean(),
    ads: z.boolean(),
  }),
  decidedAt: z.number().int().nonnegative(),
});

export type ConsentDecision = z.infer<typeof ConsentDecisionSchema>;
export type ConsentSelection = Readonly<
  Pick<ConsentDecision["purposes"], "analytics" | "ads">
>;

export function defaultConsentDecision(): ConsentDecision {
  return {
    version: "consent.v1",
    purposes: { necessary: true, analytics: false, ads: false },
    decidedAt: 0,
  };
}

export function createConsentDecision(
  selection: ConsentSelection,
  now: () => number = () => Math.floor(Date.now() / 1_000),
): ConsentDecision {
  return ConsentDecisionSchema.parse({
    version: "consent.v1",
    purposes: { necessary: true, ...selection },
    decidedAt: now(),
  });
}

export function parseConsentDecision(
  serialized: string | null,
): ConsentDecision {
  if (!serialized) return defaultConsentDecision();

  try {
    const parsed = ConsentDecisionSchema.safeParse(JSON.parse(serialized));
    return parsed.success ? parsed.data : defaultConsentDecision();
  } catch (error) {
    if (error instanceof SyntaxError) return defaultConsentDecision();
    throw error;
  }
}

export function readConsentDecision(storage: Storage): ConsentDecision {
  try {
    return parseConsentDecision(storage.getItem(CONSENT_STORAGE_KEY));
  } catch (error) {
    if (error instanceof Error) return defaultConsentDecision();
    throw error;
  }
}

export function writeConsentDecision(
  storage: Storage,
  decision: ConsentDecision,
): boolean {
  const parsed = ConsentDecisionSchema.safeParse(decision);
  if (!parsed.success) return false;

  try {
    storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(parsed.data));
    return true;
  } catch (error) {
    if (error instanceof Error) return false;
    throw error;
  }
}

export function publishConsentDecision(
  target: EventTarget,
  previous: ConsentDecision,
  current: ConsentDecision,
): void {
  target.dispatchEvent(
    new CustomEvent(CONSENT_CHANGE_EVENT, {
      detail: { previous, current },
    }),
  );
}

export function subscribeToConsent(
  target: EventTarget,
  listener: (decision: ConsentDecision) => void,
): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = z
      .strictObject({ current: ConsentDecisionSchema })
      .safeParse(event.detail);
    if (detail.success) listener(detail.data.current);
  };

  target.addEventListener(CONSENT_CHANGE_EVENT, handler);
  return () => target.removeEventListener(CONSENT_CHANGE_EVENT, handler);
}

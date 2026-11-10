export const CONSENT_PREVIEW_STATES = [
  "default",
  "customize",
  "saved",
  "collapsed",
  "failure",
] as const;

export type ConsentPreviewState = (typeof CONSENT_PREVIEW_STATES)[number];

export function readConsentPreviewState(
  search: string,
  isDevelopment: boolean,
): ConsentPreviewState | null {
  if (!isDevelopment) return null;
  const candidate = new URLSearchParams(search).get("consentPreview");
  return CONSENT_PREVIEW_STATES.find((state) => state === candidate) ?? null;
}

/** Sign-up on the hosted instance: every primary CTA on the site. */
export const CTA_URL = "https://app.wonder.money/auth/signup";

const BASE_URL = CTA_URL;

/** Where the landing page CTAs point: sign-up on the hosted instance. Kept as a hook so call sites stay unchanged. */
export function useCtaUrl(baseUrl: string = BASE_URL): string {
  return baseUrl;
}

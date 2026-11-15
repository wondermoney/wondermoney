/** Sign-up on the hosted instance: every primary CTA on the site. */
export const CTA_URL = "https://app.wonder.money/auth/signup";

/**
 * The read-only demo on the hosted instance. The app starts the demo session when its sign-in
 * page opens with `?demo=1`: the session cookie has to be set from the app's own origin, so
 * this site can only link there. A visitor already signed in goes straight into the app.
 */
export const DEMO_URL = "https://app.wonder.money/auth/login?demo=1";

const BASE_URL = CTA_URL;

/** Where the landing page CTAs point: sign-up on the hosted instance. Kept as a hook so call sites stay unchanged. */
export function useCtaUrl(baseUrl: string = BASE_URL): string {
  return baseUrl;
}

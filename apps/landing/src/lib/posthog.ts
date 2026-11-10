import { readConsentDecision } from "./consent";

/**
 * Same project as the app (PostHog project 3621, EU region). That is the point
 * of putting PostHog here at all: `cross_subdomain_cookie` defaults to true for
 * `wonder.money`, so a visitor's distinct id survives the hop from this site to
 * `app.wonder.money`, and a landing-page visit can be joined to the signup and
 * activation events the product already emits. A separate project would have
 * given us LP pageview counts and no funnel.
 *
 * The key is publishable — it ships in the page bundle either way, exactly like
 * the GTM container id next door in `gtm.ts`. It is inlined rather than read
 * from a Vercel env var so a missing variable cannot silently disable analytics
 * on a deploy; `PUBLIC_POSTHOG_KEY` still overrides it when set.
 */
const POSTHOG_KEY =
  import.meta.env.PUBLIC_POSTHOG_KEY ??
  "phc_KlDfjBgreGCfTKJnwwP5W9I2PEGJsboIKFoedyTHGg4";
const POSTHOG_HOST = "https://eu.posthog.com";

type PostHogClient = {
  init: (key: string, options: Record<string, unknown>) => void;
  capture: (event: string, properties?: Record<string, unknown>) => void;
  opt_in_capturing: () => void;
  opt_out_capturing: () => void;
};

let client: PostHogClient | null = null;
let loading: Promise<void> | null = null;

/**
 * Events fired between the consent click and the module finishing its network
 * fetch. Small, but dropping them would silently lose exactly the events most
 * worth having — the first CTA click of a session often lands in that window.
 */
const pending: Array<[string, Record<string, unknown> | undefined]> = [];

function flushPending(): void {
  if (!client) return;
  while (pending.length > 0) {
    const queued = pending.shift();
    if (queued) client.capture(queued[0], queued[1]);
  }
}

/**
 * Mirrors `applyTrackingConsent` in `gtm.ts`, and is called from the same two
 * places in `ConsentBanner` — on mount and on save.
 *
 * `posthog-js` is imported dynamically rather than at module scope so that a
 * visitor who never grants analytics consent never downloads or executes it.
 * On a marketing site that is both the correct reading of the consent banner
 * and a meaningful chunk of JavaScript not shipped to most visitors.
 */
export function applyPostHogConsent(consent: { analytics: boolean }): void {
  if (typeof window === "undefined") return;

  if (!consent.analytics) {
    // Withdrawal after a previous grant: stop capturing, and drop anything
    // still queued so it cannot be sent later.
    pending.length = 0;
    client?.opt_out_capturing();
    return;
  }

  if (client) {
    client.opt_in_capturing();
    flushPending();
    return;
  }
  if (loading) return;

  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        // This is a multi-page Astro site, so every navigation is a real page
        // load and PostHog's own pageview capture is correct here. The app sets
        // this to false because Next.js routes client-side and captures manually.
        capture_pageview: true,
        // Not enabled on a public marketing site: a generic "analytics" consent
        // is not informed consent to have the session replayed.
        disable_session_recording: true,
        // PostHog drops events from anything it considers a bot, and it counts
        // `navigator.webdriver` — which every automated browser sets — as one
        // signal. Keeping the filter on in production is right for a public
        // marketing page that crawlers hit constantly; leaving it on in dev
        // makes the integration impossible to verify locally, because captures
        // are silently discarded while init still looks perfectly healthy.
        opt_out_useragent_filter: import.meta.env.DEV,
        debug: import.meta.env.DEV,
      });
      client = posthog as unknown as PostHogClient;
      flushPending();
    })
    .catch(() => {
      // Blocked by an extension, offline, or the CDN is down. Analytics is not
      // worth breaking a page over, so this stays silent and retryable.
      loading = null;
    });
}

/**
 * Consent is re-read per call rather than trusted from init, matching
 * `pushGtmEvent`. A visitor can withdraw consent in another tab, and the
 * cheapest correct thing is to check the source of truth every time.
 */
export function capturePostHogEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!readConsentDecision(window.localStorage).purposes.analytics) return;
  if (!client) {
    pending.push([event, properties]);
    return;
  }
  client.capture(event, properties);
}

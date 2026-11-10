import { readConsentDecision } from "./consent";
import { capturePostHogEvent } from "./posthog";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GTM_ID = "GTM-MGJJLRNH";
const GTM_SCRIPT_ID = "wondermoney-gtm";

type GtmEvent = {
  event: string;
  [key: string]: unknown;
};

/**
 * Fans out to PostHog as well as the dataLayer.
 *
 * Every CTA on this site already calls this with `{ event, cta_position,
 * page_type }`, so forwarding here gets PostHog the full set of existing call
 * sites without touching ~30 components — and, more to the point, without the
 * next person having to remember to emit twice. The name stays `pushGtmEvent`
 * because that is what the call sites say; the destination is an
 * implementation detail of this module.
 */
export function pushGtmEvent(payload: GtmEvent): void {
  if (typeof window === "undefined") return;
  if (!readConsentDecision(window.localStorage).purposes.analytics) return;
  const dataLayer = window.dataLayer ?? [];
  window.dataLayer = dataLayer;
  dataLayer.push(payload);

  const { event, ...properties } = payload;
  capturePostHogEvent(event, properties);
}

type TrackingConsent = {
  readonly analytics: boolean;
  readonly ads: boolean;
};

export function applyTrackingConsent(consent: TrackingConsent): void {
  if (typeof window === "undefined") return;
  const existingDataLayer = window.dataLayer;
  if (!consent.analytics) {
    if (existingDataLayer) {
      existingDataLayer.push(["consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      }]);
    }
    return;
  }

  const dataLayer = existingDataLayer ?? [];
  window.dataLayer = dataLayer;
  const sendConsent =
    window.gtag ?? ((...args: unknown[]) => dataLayer.push(args));
  sendConsent("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  sendConsent("consent", "update", {
    analytics_storage: "granted",
    ad_storage: consent.ads ? "granted" : "denied",
    ad_user_data: consent.ads ? "granted" : "denied",
    ad_personalization: consent.ads ? "granted" : "denied",
  });

  if (document.getElementById(GTM_SCRIPT_ID)) return;
  dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.id = GTM_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
  document.head.append(script);
}

/** Returns the page identifier derived from the current URL path (locale prefix stripped). */
export function getPageType(): string {
  if (typeof window === "undefined") return "unknown";
  const pathname = window.location.pathname;
  const withoutLocale = pathname.replace(/^\/(pt|en|es|fr|de|it)(\/|$)/, "/");
  const clean = withoutLocale.replace(/^\//, "").replace(/\/$/, "");
  return clean || "homepage";
}

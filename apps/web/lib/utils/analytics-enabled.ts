import { env } from "@/lib/utils/env";

/*
 * Analytics are opt-in per instance: a tracker loads only when its key is
 * configured (NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_GTM_ID). A self-hosted
 * instance sets neither by default, so it loads nothing. A production build
 * alone never turns anything on; outside production, developers also need
 * NEXT_PUBLIC_ENABLE_ANALYTICS=1 so a key in .env.local stays quiet.
 */
function isAnalyticsBuild() {
  return (
    process.env.NODE_ENV === "production" ||
    env.NEXT_PUBLIC_ENABLE_ANALYTICS === "1"
  );
}

export function isAnalyticsEnabled() {
  return isAnalyticsBuild() && !!env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
}

/** The configured Google Tag Manager container, or null when there is none. */
export function getGtmId(): null | string {
  return env.NEXT_PUBLIC_GTM_ID?.trim() || null;
}

export function isGtmEnabled() {
  return isAnalyticsBuild() && getGtmId() !== null;
}

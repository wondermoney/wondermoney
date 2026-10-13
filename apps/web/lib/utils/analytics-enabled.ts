import { GOOGLE_TAG_MANAGER_ID } from "@/lib/utils/analytics";
import { env } from "@/lib/utils/env";

export function isAnalyticsGloballyEnabled() {
  return (
    process.env.NODE_ENV === "production" ||
    env.NEXT_PUBLIC_ENABLE_ANALYTICS === "1"
  );
}

export function isAnalyticsEnabled() {
  return isAnalyticsGloballyEnabled() && !!env.NEXT_PUBLIC_POSTHOG_KEY;
}

export function isGtmEnabled() {
  return isAnalyticsGloballyEnabled() && !!GOOGLE_TAG_MANAGER_ID;
}

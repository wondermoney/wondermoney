"use client";

import { useEffect } from "react";

import { usePathname } from "@/i18n/navigation";
import { useAnalyticsConsent } from "@/lib/analytics/consent";
import { resolveFeatureScreen } from "@/lib/analytics/feature-screen";
import { track } from "@/lib/analytics/track";
import { isAnalyticsEnabled } from "@/lib/utils/analytics-enabled";

/**
 * `feature_screen_viewed` on each navigation, in place of a pageview: the screen's identifier,
 * never its path (`lib/analytics/feature-screen.ts`). A route that is not counted sends nothing.
 */
export default function FeatureScreenView() {
  const pathname = usePathname();
  const consent = useAnalyticsConsent();

  useEffect(() => {
    if (consent !== "granted" || !isAnalyticsEnabled() || !pathname) return;
    const screen = resolveFeatureScreen(pathname);
    if (screen) track("feature_screen_viewed", { screen });
  }, [consent, pathname]);

  return null;
}

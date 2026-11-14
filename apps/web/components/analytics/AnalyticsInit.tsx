"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

import {
  ANALYTICS_CONSENT_KEY,
  getAnalyticsConsent,
  useAnalyticsConsent,
} from "@/lib/analytics/consent";
import {
  getGtmId,
  isAnalyticsEnabled,
  isGtmEnabled,
} from "@/lib/utils/analytics-enabled";
import { env } from "@/lib/utils/env";

const GTM_SCRIPT_ID = "google-tag-manager";

export function AnalyticsInit() {
  const consent = useAnalyticsConsent();

  useEffect(() => {
    const posthogKey = env.NEXT_PUBLIC_POSTHOG_KEY;
    if (consent !== "granted") {
      if (posthog.__loaded) {
        posthog.stopSessionRecording();
        posthog.opt_out_capturing();
      }
      return;
    }
    if (!isAnalyticsEnabled() || !posthogKey) return;

    if (!posthog.__loaded) {
      posthog.init(posthogKey, {
        api_host: "https://eu.posthog.com",
        capture_pageview: false,
        capture_pageleave: false,
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true,
        person_profiles: "never",
        // Ignore identity and traits persisted by earlier app versions.
        persistence: "memory",
        before_send: (event) =>
          getAnalyticsConsent() === "granted" ? event : null,
      });
    }
    posthog.opt_in_capturing({ captureEventName: false });
  }, [consent]);

  useEffect(() => {
    const gtmId = getGtmId();
    if (consent !== "granted" || !isGtmEnabled() || !gtmId) return;
    const script = document.createElement("script");
    script.id = GTM_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(gtmId)}`;
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event: "gtm.js", "gtm.start": Date.now() });
    document.head.append(script);
    // A tag already executed by GTM cannot be unloaded by removing its script.
    // Consent withdrawn in another tab must also unload this tab's tags.
    const onStorage = (event: StorageEvent) => {
      if (
        (event.key === ANALYTICS_CONSENT_KEY || event.key === null) &&
        getAnalyticsConsent() !== "granted"
      )
        window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      script.remove();
      window.removeEventListener("storage", onStorage);
    };
  }, [consent]);

  return null;
}

"use client";

import posthog from "posthog-js";
import { useEffect } from "react";

import { useUser } from "@/lib/auth/user-context";
import { GOOGLE_TAG_MANAGER_ID } from "@/lib/utils/analytics";
import {
  isAnalyticsEnabled,
  isGtmEnabled,
} from "@/lib/utils/analytics-enabled";
import { env } from "@/lib/utils/env";

const GTM_SCRIPT_ID = "google-tag-manager";

function Gtm({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !isGtmEnabled()) {
      document.getElementById(GTM_SCRIPT_ID)?.remove();
      return;
    }
    if (document.getElementById(GTM_SCRIPT_ID)) return;

    const script = document.createElement("script");
    script.id = GTM_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${GOOGLE_TAG_MANAGER_ID}`;
    document.head.append(script);
  }, [enabled]);

  return null;
}

export function AnalyticsInit() {
  const user = useUser();
  const analyticsEnabled =
    isAnalyticsEnabled() && Boolean(env.NEXT_PUBLIC_POSTHOG_KEY);

  useEffect(() => {
    const posthogKey = env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!analyticsEnabled || !posthogKey) return;

    if (!posthog.__loaded) {
      posthog.init(posthogKey, {
        api_host: "https://eu.posthog.com",
        capture_pageview: false,
        debug: process.env.NODE_ENV === "development",
        disable_session_recording: true,
      });
    }


    if (process.env.NODE_ENV !== "development") {
      posthog.startSessionRecording();
    }

    // Pass the email trait so PostHog persons are attributable and the
    // "filter out internal and test users" cohort can distinguish real users
    // from internal accounts (RAD-175). user.id is the better-auth user id,
    // i.e. the same distinctId the server-side analytics outbox uses, so this
    // enriches the same person rather than creating a new one.
    if (user?.id) posthog.identify(user.id, { email: user.email });
  }, [analyticsEnabled, user?.id, user?.email]);

  return <Gtm enabled />;
}

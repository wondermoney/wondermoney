"use client";

import { useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { Suspense, useEffect } from "react";

import { usePathname } from "@/i18n/navigation";
import { getSanitizedPageviewUrl } from "@/lib/analytics/pageview-url";
import { isAnalyticsEnabled } from "@/lib/utils/analytics-enabled";

function AnalyticsPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const posthog = usePostHog();

  useEffect(() => {
    if (!isAnalyticsEnabled() || !pathname || !posthog) return;

    const url = getSanitizedPageviewUrl(window.origin, pathname, searchParams);

    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, posthog, searchParams]);

  return null;
}

export default function SuspendedAnalyticsPageView() {
  return (
    <Suspense fallback={null}>
      <AnalyticsPageView />
    </Suspense>
  );
}

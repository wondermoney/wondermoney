"use client";

import { useLocale } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef } from "react";

import { useUser } from "@/lib/auth/user-context";
import {
  ACTIVATION_EVENTS,
  captureActivationEvent,
  hasTrackedActivationEvent,
  markActivationEventTracked,
} from "@/lib/utils/analytics";

interface NetWorthViewedEventProps {
  accountCount: number;
  accountSource?: "manual" | "sync";
  captureLegacyNetWorthViewed?: boolean;
  isLoaded: boolean;
  portfolioCount: number;
}

export function NetWorthViewedEvent({
  accountCount,
  accountSource,
  captureLegacyNetWorthViewed = true,
  isLoaded,
  portfolioCount,
}: NetWorthViewedEventProps) {
  const posthog = usePostHog();
  const user = useUser();
  const locale = useLocale();
  const didCaptureLegacyNetWorthViewedRef = useRef(false);

  useEffect(() => {
    const eventProperties = {
      account_count: accountCount,
      account_source: accountSource,
      locale,
      portfolio_count: portfolioCount,
    };

    if (
      captureLegacyNetWorthViewed &&
      !didCaptureLegacyNetWorthViewedRef.current
    ) {
      didCaptureLegacyNetWorthViewedRef.current = true;
      posthog?.capture("net_worth_viewed", eventProperties);
    }

    if (!user?.id) return;

    if (
      !hasTrackedActivationEvent(ACTIVATION_EVENTS.dashboardFirstViewed, {
        userId: user.id,
      })
    ) {
      captureActivationEvent(
        posthog,
        ACTIVATION_EVENTS.dashboardFirstViewed,
        eventProperties,
      );
      markActivationEventTracked(ACTIVATION_EVENTS.dashboardFirstViewed, {
        userId: user.id,
      });
    }

    if (!isLoaded) return;

    if (
      hasTrackedActivationEvent(ACTIVATION_EVENTS.firstNetWorthRendered, {
        userId: user.id,
      })
    ) {
      return;
    }

    captureActivationEvent(
      posthog,
      ACTIVATION_EVENTS.firstNetWorthRendered,
      eventProperties,
    );
    markActivationEventTracked(ACTIVATION_EVENTS.firstNetWorthRendered, {
      userId: user.id,
    });
  }, [
    accountCount,
    accountSource,
    captureLegacyNetWorthViewed,
    isLoaded,
    locale,
    portfolioCount,
    posthog,
    user?.id,
  ]);

  return null;
}

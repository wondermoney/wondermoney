"use client";

import { useSyncExternalStore } from "react";

export const ANALYTICS_CONSENT_KEY = "wondermoney:analytics-consent:v1";
const CHANGE_EVENT = "wondermoney:analytics-consent-change";
export type AnalyticsConsent = "granted" | "denied" | null;

export function getAnalyticsConsent(): AnalyticsConsent {
  try {
    if (typeof window === "undefined") return null;
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, null>) {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  } catch {
    // Unavailable storage must leave analytics off.
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useAnalyticsConsent() {
  return useSyncExternalStore(subscribe, getAnalyticsConsent, () => null);
}

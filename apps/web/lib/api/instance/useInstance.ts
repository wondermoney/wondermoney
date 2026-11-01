"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/** `GET /v1/instance`: what this server offers. See the API's `controller/instance.ts`. */
export interface InstanceDescription {
  apiVersion: number;
  features: {
    ai: { assistant: boolean; csvMapping: boolean; enrichment: boolean; monthlyStory: boolean; ocr: boolean };
    bankSync: boolean;
    contactForm: boolean;
    email: boolean;
    /**
     * In-app feedback can be emailed to the support inbox (`POST /v1/feedback`). Absent on an
     * API older than this field, which reads as off.
     */
    feedback?: boolean;
    fileStorage: boolean;
    /** Both Google OAuth credentials are set, so "Continue with Google" works. */
    googleSignIn: boolean;
    marketData: boolean;
  };
  minAppVersion: null | string;
  name: string;
  signupMode: "closed" | "invite" | "open";
  /** The operator's `SUPPORT_EMAIL`; null when the instance has no support inbox. */
  supportEmail: null | string;
}

const apiBaseUrl = () => process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function fetchInstance(): Promise<InstanceDescription> {
  const res = await fetch(`${apiBaseUrl()}/v1/instance`);
  if (!res.ok) throw new Error(`GET /v1/instance failed: ${res.status}`);
  return (await res.json()) as InstanceDescription;
}

/**
 * The server's capabilities. Public, and stable for the life of a deploy, so it is fetched once
 * per session. While it loads, `features` is undefined: callers treat an unknown feature as
 * available rather than flash it away.
 */
function useInstance() {
  return useQuery({
    queryFn: fetchInstance,
    queryKey: ["instance"],
    retry: 1,
    staleTime: Infinity,
  });
}

const subscribeNothing = () => () => {};

/**
 * False on the server and through the hydrating render, true after. The server
 * never has instance data, but a client with the query cached does, so reading
 * `data` straight away renders a feature-gated control on the server and drops
 * it on the client: a hydration mismatch (the Settings tabs, the import
 * triggers). Holding the server's answer until hydration is done keeps the
 * first client render identical; the real value lands one render later.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/** True unless the server has said the feature is off. */
export function useFeature(select: (features: InstanceDescription["features"]) => boolean): boolean {
  const { data } = useInstance();
  const hydrated = useHydrated();
  return hydrated && data ? select(data.features) : true;
}

/**
 * True only once the server has said the feature is on. For controls that fail when used on a
 * server without the feature (a sign-in button that would error), where briefly hiding the
 * control on a server that has it is the lesser harm.
 */
export function useConfirmedFeature(select: (features: InstanceDescription["features"]) => boolean): boolean {
  const { data } = useInstance();
  const hydrated = useHydrated();
  return hydrated && data ? select(data.features) : false;
}

/** Where users can write for help, or null: no support links are shown then. */
export function useSupportEmail(): null | string {
  const { data } = useInstance();
  const hydrated = useHydrated();
  return hydrated ? (data?.supportEmail ?? null) : null;
}

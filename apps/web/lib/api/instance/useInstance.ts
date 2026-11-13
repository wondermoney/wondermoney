"use client";

import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/** `GET /v1/instance`: what this server offers. See the API's `controller/instance.ts`. */
export interface InstanceDescription {
  apiVersion: number;
  /** The commit the server was built from; null for a local build. */
  commit?: null | string;
  features: {
    ai: { assistant: boolean; csvMapping: boolean; enrichment: boolean; monthlyStory: boolean; ocr: boolean; statementImport?: boolean };
    bankSync: boolean;
    /**
     * `instance` when the operator set a shared Enable Banking credential, `user` when everyone
     * adds their own. Whether the signed-in household may use the shared one is on the profile
     * (`useBankLinkCredential`). Absent on an older API, which reads as `user`.
     */
    bankSyncCredentials?: "instance" | "user";
    contactForm: boolean;
    /**
     * One-click sign-in to the shared read-only demo account (`POST /v1/auth/demo`,
     * `DEMO_SIGN_IN_ENABLED`). Absent on an API older than this field, which reads as off.
     */
    demo?: boolean;
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
    /** What this server's market-data providers can be asked (`search`, `quote`, `dailyHistory`, `dividends`, `splits`). Absent on an older API. */
    marketDataCapabilities?: string[];
    /** The set-up market-data providers, in the order the server asks them. Absent on an older API. */
    marketDataProviders?: string[];
    /** The read-only MCP server at `POST /v1/mcp` (`MCP_ENABLED`). */
    mcp?: boolean;
    /**
     * Single sign-on through the operator's OIDC provider ("Sign in with <name>"). Null when
     * none is configured; absent on an API older than single sign-on.
     */
    oidc?: null | { name: string };
    /** Passkey sign-in and passkey management. Absent on an API older than passkeys. */
    passkey?: boolean;
    /**
     * False under `OIDC_ONLY`: the server refuses password sign-in, sign-up and reset, so the
     * forms are hidden. Absent on an older API, which reads as on.
     */
    passwordSignIn?: boolean;
    /**
     * PDF statement import: the largest statement taken and the provider's family. Null when the
     * server has no model for it; absent on an older API. The provider's name, for the consent line,
     * is on the signed-in profile (`useStatementImportProvider`).
     */
    statementImport?: null | StatementImportFeature;
  };
  minAppVersion: null | string;
  name: string;
  signupMode: "closed" | "invite" | "open";
  /** The operator's `SPONSOR_URL`; null, or absent on an older API, hides the link. */
  sponsorUrl?: null | string;
  /** The operator's `SUPPORT_EMAIL`; null when the instance has no support inbox. */
  supportEmail: null | string;
  /** The release version the server runs (`dev` for a local build); absent on an older API. */
  version?: string;
}

export interface StatementImportFeature {
  maxBytes: number;
  maxPages: number;
  providerKind: "anthropic" | "azure-openai" | "openai-compatible";
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

/** The single sign-on provider's button label, once the server has said it has one. */
export function useOidcProvider(): null | { name: string } {
  const { data } = useInstance();
  const hydrated = useHydrated();
  return hydrated ? (data?.features.oidc ?? null) : null;
}

/**
 * PDF statement import, once the server has said it has a model for it; null otherwise (and while
 * the description loads, so the entry never shows on a server without it).
 */
export function useStatementImport(): null | StatementImportFeature {
  const { data } = useInstance();
  const hydrated = useHydrated();
  if (!hydrated || !data?.features.ai.statementImport) return null;
  return data.features.statementImport ?? null;
}

/**
 * Who may create an account here, or null until the server has said: callers that offer
 * sign-up show it only for `"open"`.
 */
export function useSignupMode(): InstanceDescription["signupMode"] | null {
  const { data } = useInstance();
  const hydrated = useHydrated();
  return hydrated ? (data?.signupMode ?? null) : null;
}

/**
 * Whether the server has a shared Enable Banking credential (`features.bankSyncCredentials`).
 * Undefined until the description arrives.
 */
export function useInstanceBankSyncCredentials(): "instance" | "user" | undefined {
  const { data } = useInstance();
  const hydrated = useHydrated();
  if (!hydrated || !data) return undefined;
  return data.features.bankSyncCredentials ?? "user";
}

/** Where users can write for help, or null: no support links are shown then. */
export function useSupportEmail(): null | string {
  const { data } = useInstance();
  const hydrated = useHydrated();
  return hydrated ? (data?.supportEmail ?? null) : null;
}

/** Where users can chip in towards running this instance, or null: no link is shown then. */
export function useSponsorUrl(): null | string {
  const { data } = useInstance();
  const hydrated = useHydrated();
  return hydrated ? (data?.sponsorUrl ?? null) : null;
}

/**
 * Which build the server runs, for the version line in the account menu. Null until the
 * description arrives, and on an older API that does not report a version.
 */
export function useServerBuildInfo(): {
  commit: null | string;
  version: null | string;
} {
  const { data } = useInstance();
  const hydrated = useHydrated();
  if (!hydrated || !data?.version) return { commit: null, version: null };
  return { commit: data.commit ?? null, version: data.version };
}

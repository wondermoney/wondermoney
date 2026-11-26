"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { getApiErrorCode } from "@/lib/api/errors";
import useHousehold from "@/lib/api/household/useHousehold";
import { authClient } from "@/lib/auth/client";
import {
  getOAuthClientInfo,
  isKnownConsentScope,
  OAUTH_CONSENT_SCOPES,
  type OAuthConsentRequest,
  submitOAuthConsent,
} from "@/lib/auth/oauth-consent";

import { Alert, AlertDescription, AlertTitle } from "../ui/Alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/Label";
import { Text } from "../ui/Typography";

export interface OAuthConsentProps {
  request: OAuthConsentRequest;
  instanceName: string;
  signedInEmail: null | string;
  /** The account uses two-factor authentication: allowing needs the current code. */
  twoFactorEnabled: boolean;
  /** The session is under a day old; otherwise the person signs in again before consenting. */
  sessionFresh: boolean;
}

type ConsentError =
  "error" | "invalid-totp" | "session-not-fresh" | "totp-required";

const ERROR_BY_CODE: Record<string, ConsentError> = {
  invalid_totp: "invalid-totp",
  session_not_fresh: "session-not-fresh",
  totp_required: "totp-required",
};

/** The other members' first names, for naming the household the client will read. */
function otherMemberNames(
  members: {
    appuserKey: number;
    emailAddress: string;
    firstName?: null | string;
  }[],
  viewerAppuserKey: null | number,
): string[] {
  return members
    .filter((member) => member.appuserKey !== viewerAppuserKey)
    .map((member) => member.firstName?.trim() || member.emailAddress);
}

/**
 * The OAuth consent screen for the MCP server: which client asks, where it sends the person
 * back (a website by its `https` origin, anything else as an app on this device, with a
 * warning), what it may read (the household, and that it sees what the person sees), and that it
 * changes nothing. Allowing is a sensitive action: it needs a sign-in from the last day and, with
 * two-factor on, the authenticator code. Allow and Cancel both hand the browser back to the client.
 */
export function OAuthConsent({
  request,
  instanceName,
  signedInEmail,
  twoFactorEnabled,
  sessionFresh,
}: OAuthConsentProps) {
  const t = useTranslations("oauthConsent");
  const locale = useLocale();
  const id = useId();
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<ConsentError | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [stale, setStale] = useState(!sessionFresh);

  const client = useQuery({
    queryKey: ["oauth", "public-client", request.clientId],
    queryFn: () => getOAuthClientInfo(request.clientId),
    retry: false,
  });
  const household = useHousehold();

  const clientName = client.data?.client_name?.trim() || null;
  const scopes = OAUTH_CONSENT_SCOPES.filter((scope) =>
    request.scopes.includes(scope),
  );
  const unknownScopes = request.scopes.filter(
    (scope) => !isKnownConsentScope(scope),
  );
  const others = household.data
    ? otherMemberNames(household.data.members, household.data.viewerAppuserKey)
    : [];
  const redirect = request.redirect;

  const signInAgain = async () => {
    const next = `${window.location.pathname}${window.location.search}`;
    await authClient.signOut().catch(() => undefined);
    const login = new URL(`/${locale}/auth/login`, window.location.origin);
    login.searchParams.set("next", next);
    window.location.assign(login.toString());
  };

  const answer = async (accept: boolean) => {
    setPending(accept ? "allow" : "deny");
    setError(null);
    try {
      const url = await submitOAuthConsent({
        accept,
        oauthQuery: request.oauthQuery,
        ...(accept && totpCode.trim() ? { totpCode: totpCode.trim() } : {}),
      });
      window.location.assign(url);
    } catch (caught) {
      const code = ERROR_BY_CODE[getApiErrorCode(caught) ?? ""] ?? "error";
      if (code === "session-not-fresh") setStale(true);
      setError(code);
      setPending(null);
    }
  };

  if (client.isError) {
    return (
      <>
        <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
          {t("invalid-title")}
        </h1>
        <Text variant="mutedText" className="mt-2 text-sm leading-6">
          {t("invalid-body")}
        </Text>
      </>
    );
  }

  if (stale) {
    return (
      <>
        <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
          {t("stale-title")}
        </h1>
        <Text variant="mutedText" className="mt-2 text-sm leading-6">
          {t("stale-body")}
        </Text>
        <Button
          type="button"
          variant="default"
          className="mt-6"
          onClick={() => void signInAgain()}
        >
          {t("sign-in-again")}
        </Button>
      </>
    );
  }

  return (
    <>
      <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
        {clientName
          ? t("title", { client: clientName, instanceName })
          : t("title-unnamed", { instanceName })}
      </h1>
      {signedInEmail ? (
        <Text variant="mutedText" className="mt-2 text-sm leading-6">
          {t("signed-in-as", { email: signedInEmail })}
        </Text>
      ) : null}
      {redirect?.kind === "web" ? (
        <Text variant="mutedText" className="mt-1 text-sm leading-6">
          {t.rich("redirect-web", {
            origin: redirect.origin,
            code: (chunks) => <code className="font-mono">{chunks}</code>,
          })}
        </Text>
      ) : redirect?.kind === "device" ? (
        <Alert variant="warning" className="mt-4">
          <AlertTitle>
            {t.rich("redirect-device", {
              app: redirect.label,
              code: (chunks) => <code className="font-mono">{chunks}</code>,
            })}
          </AlertTitle>
          <AlertDescription>{t("redirect-device-warning")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="border-border mt-6 flex flex-col gap-4 rounded border p-4">
        <Text className="font-medium">{t("household-title")}</Text>
        <Text variant="mutedText" className="text-sm leading-6">
          {others.length === 0
            ? t("household-alone")
            : t("household-with", { members: others.join(", ") })}
        </Text>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-6">
          {scopes.map((scope) => (
            <li key={scope}>
              {t(`scope.${scope === "mcp:read" ? "read" : "offline"}`)}
            </li>
          ))}
          <li>{t("never-writes")}</li>
          {unknownScopes.length > 0 ? (
            <li>{t("scope-unknown", { scopes: unknownScopes.join(", ") })}</li>
          ) : null}
        </ul>
        <Text variant="mutedText" className="text-sm leading-6">
          {t("revoke-hint")}
        </Text>
      </div>

      {twoFactorEnabled ? (
        <div className="mt-6 flex flex-col gap-1.5">
          <Label htmlFor={`${id}-totp`}>{t("totp-label")}</Label>
          <Input
            id={`${id}-totp`}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={totpCode}
            maxLength={6}
            placeholder="123456"
            onChange={(event) => setTotpCode(event.target.value)}
          />
          <Text variant="mutedText">{t("totp-hint")}</Text>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>
            {t(`error-${error === "error" ? "generic" : error}`)}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          variant="default"
          loading={pending === "allow"}
          disabled={
            pending !== null ||
            client.isLoading ||
            (twoFactorEnabled && !totpCode.trim())
          }
          onClick={() => void answer(true)}
        >
          {t("allow")}
        </Button>
        <Button
          type="button"
          variant="outline"
          loading={pending === "deny"}
          disabled={pending !== null}
          onClick={() => void answer(false)}
        >
          {t("deny")}
        </Button>
      </div>
    </>
  );
}

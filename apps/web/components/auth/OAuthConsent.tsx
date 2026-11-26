"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";

import useHousehold from "@/lib/api/household/useHousehold";
import {
  getOAuthClientInfo,
  isKnownConsentScope,
  OAUTH_CONSENT_SCOPES,
  type OAuthConsentRequest,
  submitOAuthConsent,
} from "@/lib/auth/oauth-consent";

import { Alert, AlertDescription } from "../ui/Alert";
import { Button } from "../ui/button";
import { Text } from "../ui/Typography";

export interface OAuthConsentProps {
  request: OAuthConsentRequest;
  instanceName: string;
  signedInEmail: null | string;
}

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
 * back, what it may read (the household it reads, and that it sees what the person sees), and
 * that it changes nothing. Allow and Cancel both hand the browser back to the client.
 */
export function OAuthConsent({
  request,
  instanceName,
  signedInEmail,
}: OAuthConsentProps) {
  const t = useTranslations("oauthConsent");
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [failed, setFailed] = useState(false);

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

  const answer = async (accept: boolean) => {
    setPending(accept ? "allow" : "deny");
    setFailed(false);
    try {
      const url = await submitOAuthConsent({
        accept,
        oauthQuery: request.oauthQuery,
      });
      window.location.assign(url);
    } catch {
      setFailed(true);
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
      {request.redirectHost ? (
        <Text variant="mutedText" className="mt-1 text-sm leading-6">
          {t("redirect-host", { host: request.redirectHost })}
        </Text>
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

      {failed ? (
        <Alert variant="destructive" className="mt-6">
          <AlertDescription>{t("error")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          variant="default"
          loading={pending === "allow"}
          disabled={pending !== null || client.isLoading}
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

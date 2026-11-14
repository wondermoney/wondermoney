"use client";

import { KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/client";
import { getSafeNextPath, withNextParam } from "@/lib/auth/safe-next-path";
import { getBaseUrl, getCallbackURL } from "@/lib/utils/url";

import { Button } from "../ui/button";

/** The API's provider id for single sign-on (`apps/api/src/services/auth/oidc-provider.ts`). */
const OIDC_PROVIDER_ID = "oidc";

interface OidcSignInButtonProps {
  readonly disabled?: boolean;
  /** A household invite from `/join`: `/auth/complete` hands it to the API with the sign-in. */
  readonly inviteToken?: string;
  readonly locale: string;
  /** The operator's `OIDC_DISPLAY_NAME`, from `GET /v1/instance`. */
  readonly name: string;
  /** The `?next=` destination, validated against this origin when the button is pressed. */
  readonly nextParam?: null | string;
  /** The main action when password sign-in is off (`OIDC_ONLY`); a secondary one otherwise. */
  readonly primary?: boolean;
}

/**
 * "Sign in with <name>": the same full-page OAuth flow as Google. The provider returns to the
 * API's `/callback/oidc`, which sets the session and sends the browser to `/auth/complete`
 * (provisioning, or the TOTP step for a two-factor account). A refusal (not in an allowed group,
 * unverified email, sign-up closed) lands on the sign-in error page with the reason.
 */
export function OidcSignInButton({
  disabled,
  inviteToken,
  locale,
  name,
  nextParam = null,
  primary = false,
}: OidcSignInButtonProps) {
  const t = useTranslations();
  const [starting, setStarting] = useState(false);

  const signIn = async () => {
    setStarting(true);
    const callbackURL = new URL(
      withNextParam(
        getCallbackURL(locale),
        getSafeNextPath(nextParam, window.location.origin),
      ),
    );
    if (inviteToken) callbackURL.searchParams.set("invite", inviteToken);
    const { error } = await authClient.signIn.social({
      callbackURL: callbackURL.toString(),
      errorCallbackURL: `${getBaseUrl()}/${locale}/auth/auth-code-error`,
      provider: OIDC_PROVIDER_ID,
    });
    if (error) {
      setStarting(false);
      toast.error(t("sso-sign-in-error", { provider: name }));
    }
  };

  return (
    <Button
      type="button"
      variant={primary ? "default" : "secondary"}
      className="flex w-full items-center justify-center gap-3 font-semibold"
      loading={starting}
      disabled={disabled || starting}
      onClick={() => void signIn()}
    >
      {!starting && <KeyRound className="size-5" aria-hidden="true" />}
      <span className="text-sm leading-6">
        {t("sso-sign-in", { provider: name })}
      </span>
    </Button>
  );
}

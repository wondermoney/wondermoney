import { getTranslations } from "next-intl/server";

import { OAuthConsent } from "@/components/auth/OAuthConsent";
import Logo from "@/components/layout/Logo";
import { Text } from "@/components/ui/Typography";
import {
  isSessionFreshForConsent,
  parseOAuthConsentRequest,
} from "@/lib/auth/oauth-consent";
import { requireServerAuth } from "@/lib/auth/server-auth";
import { getInstanceName } from "@/lib/instance-name.server";

function ConsentShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <Logo />
        {children}
      </div>
    </div>
  );
}

/** The page's query as one string, repeated parameters (`resource`) kept. */
function toQueryString(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value))
      for (const item of value) params.append(key, item);
    else if (value !== undefined) params.append(key, value);
  }
  return params.toString();
}

/**
 * Where the API's OAuth authorization endpoint sends a person for an MCP client such as ChatGPT
 * (`MCP_OAUTH_ENABLED`): both its sign-in and its consent step land here. A signed-out visitor
 * goes through the ordinary sign-in first, by any method and with the second factor, and comes
 * back to this page with the same signed request; then the page asks for consent.
 */
export default async function OAuthConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const t = await getTranslations("oauthConsent");
  const session = await requireServerAuth(locale);
  const consentRequest = parseOAuthConsentRequest(
    toQueryString(await searchParams),
  );
  const instanceName = await getInstanceName();

  if (!consentRequest) {
    return (
      <ConsentShell>
        <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
          {t("invalid-title")}
        </h1>
        <Text variant="mutedText" className="mt-2 text-sm leading-6">
          {t("invalid-body")}
        </Text>
      </ConsentShell>
    );
  }

  const email = session.user.email;
  const twoFactorEnabled = session.user.twoFactorEnabled === true;
  const sessionFresh = isSessionFreshForConsent(session.session.createdAt);
  return (
    <ConsentShell>
      <OAuthConsent
        request={consentRequest}
        instanceName={instanceName}
        signedInEmail={typeof email === "string" ? email : null}
        twoFactorEnabled={twoFactorEnabled}
        sessionFresh={sessionFresh}
      />
    </ConsentShell>
  );
}

"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import MfaForm from "@/components/auth/MfaForm";
import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";
import { getMfaFailureRedirectPath } from "@/lib/auth/mfa-redirect";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";
import { stripLocalePrefix } from "@/lib/navigation/strip-locale-prefix";

export default function MfaPage() {
  const locale = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const t = useTranslations();

  useEffect(() => {
    async function checkMfa() {
      // better-auth has no dedicated client check for "a 2FA challenge is
      // pending" — the short-lived two-factor cookie it sets is httpOnly.
      // The only thing we can confirm client-side is whether a FULL session
      // already exists: if so, there's nothing left to verify here. If not,
      // we assume this page was reached via a pending 2FA challenge (the
      // only legitimate way to land here) and render MfaForm; an invalid or
      // expired challenge then surfaces as a verify failure instead of a
      // silent redirect.
      // STAGING-VERIFY: confirm no other unauthenticated path reaches
      // /auth/mfa directly (e.g. a stale bookmark).
      const { data, error } = await authClient.getSession();
      if (error) {
        router.push(getMfaFailureRedirectPath(locale));
        return;
      }
      if (data?.session) {
        // A full session already exists — no 2FA challenge left to verify.
        const next = getSafeNextPath(
          new URLSearchParams(window.location.search).get("next"),
          window.location.origin,
        );
        // `next` is already localised and this router prepends the
        // locale, so strip it or /en/settings becomes /en/en/settings.
        router.push(next ? stripLocalePrefix(next) : "/");
        return;
      }
      setLoading(false);
    }
    checkMfa();
  }, [locale, router]);

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div>
          {loading ? (
            <Spinner />
          ) : (
            <>
              <Logo />
              <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
                {t("multi-factor-authentication")}
              </h1>
            </>
          )}
        </div>
        {!loading && (
          <>
            <MfaForm />
            {/* Mid-sign-in, so no sign-up link: the only other way out is back to login. */}
            <p className="text-muted-foreground mt-6 text-center text-sm leading-6">
              <Link
                href="/auth/login"
                className="text-primary font-semibold underline underline-offset-2 hover:decoration-2"
              >
                {t("mfa-back-to-login")}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

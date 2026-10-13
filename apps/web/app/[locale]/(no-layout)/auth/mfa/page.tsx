"use client";

import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import MfaForm from "@/components/auth/MfaForm";
import Logo from "@/components/layout/Logo";
import { Link } from "@/components/ui/Link";
import { Spinner } from "@/components/ui/Spinner";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth/client";
import { getMfaFailureRedirectPath } from "@/lib/auth/mfa-redirect";

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
        router.push("/");
        return;
      }
      setLoading(false);
    }
    checkMfa();
  }, [locale, router]);

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-2">
      <div className="relative hidden bg-white lg:block">
        <Image
          src="/undraw_personal_finance.svg"
          alt=""
          fill
          className="mx-auto size-full max-w-3xl p-16 lg:p-20"
        />
      </div>
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg">
          <div>
            {loading ? (
              <Spinner />
            ) : (
              <>
                <Logo />
                <h2 className="mt-8 text-2xl leading-9 font-bold tracking-tight text-gray-900">
                  {t("multi-factor-authentication")}
                </h2>
                <p className="mt-2 text-sm leading-6 text-gray-500">
                  {t("not-a-member")}
                  <Link
                    href="/auth/signup"
                    className="text-brand-700 hover:text-brand-600 ml-1 font-semibold underline underline-offset-2"
                  >
                    {t("create-account-link")}
                  </Link>
                </p>
              </>
            )}
          </div>
          {!loading && <MfaForm />}
        </div>
      </div>
    </div>
  );
}

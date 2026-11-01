import NextLink from "next/link";
import { getTranslations } from "next-intl/server";

import { ReCaptchaProvider } from "@/components/auth/ReCaptchaProvider";
import SignupForm from "@/components/auth/SignupForm";
import Logo from "@/components/layout/Logo";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/components/ui/Link";
import { Text } from "@/components/ui/Typography";
import { instanceConfig } from "@/lib/instance";
import { getInstanceName } from "@/lib/instance-name.server";
import { cn } from "@/lib/utils";
import { createMetadata } from "@/lib/utils/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "navigation" });
  return createMetadata({
    description: t("signup"),
    title: t("signup"),
  });
}

export default async function SignupPage() {
  const { privacyUrl, termsUrl } = instanceConfig;
  const t = await getTranslations();
  const instanceName = await getInstanceName();

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div>
          <Logo />
          <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
            {t("sign-up-title", { instanceName })}
          </h1>
          <p className="text-muted-foreground mt-2 space-x-1 text-sm leading-6">
            <span>{t("sign-up-subtitle")}</span>
            <span>
              {t.rich("already-a-member-login", {
                loginLink: (chunks) => (
                  <Link
                    href="/auth/login"
                    className="text-primary ml-1 font-semibold underline underline-offset-2 hover:decoration-2"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </span>
          </p>
        </div>
        <ReCaptchaProvider>
          <SignupForm />
        </ReCaptchaProvider>
        {/* Only an instance that publishes terms and a privacy policy asks to agree to them. */}
        {termsUrl && privacyUrl && (
          <Text
            variant="mutedText"
            className="mt-6 text-center text-xs text-balance"
          >
            {t.rich("sign-up-agreement", {
              termsLink: (chunks) => (
                <NextLink
                  href={termsUrl}
                  target="_blank"
                  aria-label={t("download-terms-service")}
                  className={cn(
                    buttonVariants({ variant: "link" }),
                    "h-auto p-0 text-xs",
                  )}
                >
                  {chunks}
                </NextLink>
              ),
              privacyLink: (chunks) => (
                <NextLink
                  href={privacyUrl}
                  target="_blank"
                  aria-label={t("download-privacy-policy")}
                  className={cn(
                    buttonVariants({ variant: "link" }),
                    "h-auto p-0 text-xs",
                  )}
                >
                  {chunks}
                </NextLink>
              ),
            })}
          </Text>
        )}
      </div>
    </div>
  );
}

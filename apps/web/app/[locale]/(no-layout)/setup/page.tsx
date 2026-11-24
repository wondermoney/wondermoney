import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { ReCaptchaProvider } from "@/components/auth/ReCaptchaProvider";
import SignupForm from "@/components/auth/SignupForm";
import { InstanceSetupChecklist } from "@/components/instance-setup/InstanceSetupChecklist";
import Logo from "@/components/layout/Logo";
import { instanceConfig } from "@/lib/instance";
import { normalizeInstanceName } from "@/lib/instance-name";
import { getInstanceSetup } from "@/lib/instance-setup.server";
import { setupChecklist } from "@/lib/instance-setup-checklist";
import { createMetadata } from "@/lib/utils/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "instanceSetup" });
  return createMetadata({
    description: t("meta-title"),
    title: t("meta-title"),
  });
}

/**
 * First-run setup of a new server: while it has never had an account, every signed-out visit lands
 * here. The account made here is the instance admin unless single sign-on groups decide
 * (`firstAccountAdmin`), and then the personal onboarding runs as for anyone else. Once the
 * server has an account, this page sends visitors to sign in.
 */
export default async function SetupPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const { instance, setupRequired } = await getInstanceSetup();
  if (!setupRequired || !instance) redirect(`/${locale}/auth/login`);

  const t = await getTranslations("instanceSetup");
  const instanceName = normalizeInstanceName(instance.name);

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg">
        <div>
          <Logo />
          <h1 className="text-foreground mt-8 text-2xl leading-9 font-bold tracking-tight">
            {t("title", { instanceName })}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {/* With OIDC_ADMIN_GROUPS the groups decide admin, the first account included. */}
            {instance.firstAccountAdmin === false
              ? t("description-groups")
              : t("description")}
          </p>
        </div>
        <ReCaptchaProvider>
          <SignupForm submitLabel={t("create-account")} />
        </ReCaptchaProvider>
        <div className="mt-12">
          <InstanceSetupChecklist
            items={setupChecklist(
              instance.features,
              locale,
              instanceConfig.docsUrl,
            )}
          />
        </div>
      </div>
    </div>
  );
}

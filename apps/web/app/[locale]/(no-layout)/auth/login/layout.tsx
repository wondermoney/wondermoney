import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { getInstanceSetup } from "@/lib/instance-setup.server";
import { createMetadata } from "@/lib/utils/metadata";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "navigation" });

  return {
    ...(await createMetadata({ title: t("login"), description: t("login") })),
    // The changelog claim return path can contain an opaque token.
    referrer: "no-referrer",
  };
};

/** A new server has nobody to sign in yet: its first visitor sets it up (`/setup`). */
export default async function PageLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if ((await getInstanceSetup()).setupRequired) redirect(`/${locale}/setup`);
  return children;
}

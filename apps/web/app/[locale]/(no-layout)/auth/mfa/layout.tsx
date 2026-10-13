import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { createMetadata } from "@/lib/utils/metadata";

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "navigation" });

  return createMetadata({ title: t("mfa"), description: t("mfa") });
};

export default function PageLayout({ children }: { children: ReactNode }) {
  return children;
}

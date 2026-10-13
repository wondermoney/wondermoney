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

  return createMetadata({ title: t("portfolio"), description: t("portfolio") });
};

export default function PageLayout({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4">{children}</div>;
}

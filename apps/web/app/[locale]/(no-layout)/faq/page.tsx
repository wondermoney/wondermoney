import { getTranslations, setRequestLocale } from "next-intl/server";

import { FaqContent } from "@/components/faq/FaqContent";
import { createMetadata } from "@/lib/utils/metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "faq" });

  return createMetadata({ title: t("title"), description: t("intro") });
}

export default async function FaqPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Renders in all three supported locales, so there is no redirect here.
  // The root layout already 404s an unknown
  // locale before this page renders.
  setRequestLocale(locale);

  return <FaqContent />;
}

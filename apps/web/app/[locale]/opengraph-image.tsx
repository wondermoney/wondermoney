import { getTranslations } from "next-intl/server";

import { buildOgImageResponse } from "@/lib/og/render-og-image";

export const runtime = "nodejs";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "ogImage" });

  return buildOgImageResponse({ headline: t("generic-headline") });
}

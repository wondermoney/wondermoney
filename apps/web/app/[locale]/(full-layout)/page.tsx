import { setRequestLocale } from "next-intl/server";

import { HomeOverview } from "@/components/home-overview/HomeOverview";

/**
 * Home. Every section loads on its own, so one failed request costs one
 * section, not the page.
 */
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <HomeOverview />;
}

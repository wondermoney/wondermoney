import { getTranslations } from "next-intl/server";

import { createMetadata } from "@/lib/utils/metadata";

import ExplorerClient from "./explorer-client";

interface ExplorerPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ ticker?: string }>;
}

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "navigation" });

  return createMetadata({ title: t("explorer"), description: t("explorer") });
};

export default async function ExplorerPage({
  searchParams,
}: ExplorerPageProps) {
  const { ticker } = await searchParams;

  return <ExplorerClient initialTicker={ticker ?? null} />;
}

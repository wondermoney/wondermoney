import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import { createMetadata } from "@/lib/utils/metadata";

type Props = { children: ReactNode };

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ locale: string }>;
}) => {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "navigation" });

  return createMetadata({ title: t("home"), description: t("home") });
};

// Since we have a `not-found.tsx` page on the root, a layout file
// is required, even if it's just passing children through.
export default function RootLayout({ children }: Props) {
  return children;
}

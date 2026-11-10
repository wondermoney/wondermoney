import { redirect } from "next/navigation";

/**
 * `/home` previewed this home before it replaced the old one at `/`. Kept as a
 * redirect so a saved link still lands.
 */
export default async function HomePreviewRedirect({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}`);
}

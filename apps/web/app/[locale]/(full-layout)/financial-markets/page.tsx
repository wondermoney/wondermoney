import { redirect } from "next/navigation";

// Financial Markets has no index landing page — the bare route (linked from the
// sidebar and the bottom-nav "more" sheet) redirects straight to the Explorer.
export default async function FinancialMarketsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  redirect(`/${locale}/financial-markets/explorer`);
}

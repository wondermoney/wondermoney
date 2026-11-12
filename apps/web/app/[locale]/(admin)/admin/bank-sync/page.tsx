import { notFound } from "next/navigation";

import { BankSyncHealthView } from "@/components/admin/BankSyncHealthView";
import AppShell from "@/components/layout/AppShell";
import { getAdminBankSync } from "@/lib/api/admin/bank-sync-health";
import { getServerApi } from "@/lib/api/api-server";
import { PrivacyModeBoundary } from "@/lib/privacy/PrivacyModeBoundary";

/**
 * Instance admins only. The API decides: it answers 404 to anyone who is not
 * an instance admin, and so does this page, through the locale-level not-found
 * boundary an unknown URL reaches. That is why the route sits outside
 * `(full-layout)`: inside it, a non-admin would get the 404 inside the app
 * shell, which an unknown URL never does, and could tell the page exists.
 * `getServerApi` makes the authoritative session check first.
 */
export default async function AdminBankSyncPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const api = await getServerApi(locale);
  const data = await getAdminBankSync(api);
  if (!data) notFound();

  return (
    <PrivacyModeBoundary>
      <AppShell>
        <BankSyncHealthView health={data.health} failing={data.failing} />
      </AppShell>
    </PrivacyModeBoundary>
  );
}

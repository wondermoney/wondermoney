import { type ReactNode } from "react";

import AppShell from "@/components/layout/AppShell";
import FirstRunOnboardingRedirectGate from "@/components/onboarding/first-run/FirstRunOnboardingRedirectGate";
import { requireServerAuth } from "@/lib/auth/server-auth";
import { PrivacyModeBoundary } from "@/lib/privacy/PrivacyModeBoundary";

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireServerAuth(locale);

  return (
    <PrivacyModeBoundary>
      <FirstRunOnboardingRedirectGate>
        <AppShell>{children}</AppShell>
      </FirstRunOnboardingRedirectGate>
    </PrivacyModeBoundary>
  );
}

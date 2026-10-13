import { type ReactNode } from "react";

import Container from "@/components/layout/Container";
import Wrapper from "@/components/layout/Wrapper";
import FirstRunOnboardingRedirectGate from "@/components/onboarding/first-run/FirstRunOnboardingRedirectGate";
import { requireServerAuth } from "@/lib/auth/server-auth";

import FullLayoutClientChrome from "./FullLayoutClientChrome";
import FullLayoutClientOverlays from "./FullLayoutClientOverlays";

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
    <FirstRunOnboardingRedirectGate>
      <Wrapper>
        <FullLayoutClientChrome />
        <Container>{children}</Container>
        <FullLayoutClientOverlays />
      </Wrapper>
    </FirstRunOnboardingRedirectGate>
  );
}

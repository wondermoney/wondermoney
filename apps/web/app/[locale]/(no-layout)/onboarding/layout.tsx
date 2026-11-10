import type { ReactNode } from "react";

import FirstRunOnboardingRouteShell from "@/components/onboarding/first-run/FirstRunOnboardingRouteShell";
import { PrivacyModeBoundary } from "@/lib/privacy/PrivacyModeBoundary";

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <PrivacyModeBoundary>
      <FirstRunOnboardingRouteShell>{children}</FirstRunOnboardingRouteShell>
    </PrivacyModeBoundary>
  );
}

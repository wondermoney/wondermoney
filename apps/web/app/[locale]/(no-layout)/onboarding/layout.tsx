import type { ReactNode } from "react";

import FirstRunOnboardingRouteShell from "@/components/onboarding/first-run/FirstRunOnboardingRouteShell";

export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <FirstRunOnboardingRouteShell>{children}</FirstRunOnboardingRouteShell>
  );
}

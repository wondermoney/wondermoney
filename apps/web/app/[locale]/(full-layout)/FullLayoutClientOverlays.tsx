"use client";

import dynamic from "next/dynamic";

import { useAdminModuleVisibility } from "@/lib/admin/useAdminModuleVisibility";
import { useUser } from "@/lib/auth/user-context";

const AssistantLauncher = dynamic(
  () => import("@/components/assistant/AssistantLauncher"),
  { ssr: false },
);

// NOTE: MfaReenrollmentGate is mounted globally in app/providers.tsx, not
// here — this overlay tree only covers (full-layout) routes, but the gate
// must block every authenticated route (e.g. (no-layout)/onboarding, which
// FirstRunOnboardingRedirectGate redirects fresh sessions to). See RAD-294.
export default function FullLayoutClientOverlays() {
  const user = useUser();
  const { isModuleVisible } = useAdminModuleVisibility(
    user?.email,
    user?.email_confirmed_at,
  );

  return isModuleVisible("assistant") ? <AssistantLauncher /> : null;
}

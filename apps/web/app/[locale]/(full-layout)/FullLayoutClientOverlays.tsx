"use client";

import dynamic from "next/dynamic";

import PasskeyOffer from "@/components/auth/PasskeyOffer";
import { RuleSuggestionEditorHost } from "@/components/rules/RuleSuggestionEditorHost";
import { useFeature } from "@/lib/api/instance/useInstance";

const AssistantLauncher = dynamic(
  () => import("@/components/assistant/AssistantLauncher"),
  { ssr: false },
);

export default function FullLayoutClientOverlays() {
  // The assistant is available to every account; it is hidden only when this
  // server has no assistant model configured (`/v1/instance` features).
  const assistantAvailable = useFeature((features) => features.ai.assistant);

  return (
    <>
      {assistantAvailable ? <AssistantLauncher /> : null}
      {/* After a password sign-in, the one-time offer to add a passkey. */}
      <PasskeyOffer />
      {/* The rule editor a "categorize transactions like this" prompt opens. */}
      <RuleSuggestionEditorHost />
    </>
  );
}

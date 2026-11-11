"use client";

import { MessageSquareMore } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import useAssistantConsent from "@/lib/api/assistant/useAssistantConsent";
import useAiHidden from "@/lib/api/user-preferences/useAiHidden";

const AssistantPanel = dynamic(() => import("./AssistantPanel"), {
  ssr: false,
});

export default function AssistantLauncher() {
  const t = useTranslations("assistant");
  const [open, setOpen] = useState(false);
  const { data: consent } = useAssistantConsent();
  const aiHidden = useAiHidden();

  // Hiding AI turns the launcher and the panel off; the person's own choice to
  // dismiss the launcher hides it while the assistant stays available.
  if (aiHidden || consent?.launcherHidden) {
    return null;
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="border-border/70 bg-background/95 fixed right-4 bottom-24 z-40 gap-2 rounded-full px-4 py-3 shadow-lg backdrop-blur md:right-6 md:bottom-6"
        onClick={() => setOpen(true)}
        data-testid="assistant-launcher"
      >
        <MessageSquareMore className="size-4" />
        <span>{t("launcher")}</span>
      </Button>

      {open ? <AssistantPanel open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

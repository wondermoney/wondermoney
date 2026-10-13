"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

import AssistantChat from "@/components/assistant/AssistantChat";
import AssistantConsentScreen from "@/components/assistant/AssistantConsentScreen";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import type { AssistantConsent } from "@/lib/api/assistant/types";
import useAssistantConsent from "@/lib/api/assistant/useAssistantConsent";
import useUpdateAssistantConsent from "@/lib/api/assistant/useUpdateAssistantConsent";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/utils/useMediaQuery";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function PanelChrome({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("assistant");

  return (
    <div
      className="bg-background flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="assistant-panel"
    >
      <div className="border-border/70 flex items-center justify-between gap-3 border-b px-5 py-4 md:px-6">
        <div className="min-w-0">
          <DialogPrimitive.Title
            id="assistant-panel-title"
            className="text-sm leading-5 font-medium"
          >
            {t("title")}
          </DialogPrimitive.Title>
          <p
            id="assistant-panel-description"
            className="text-muted-foreground text-xs leading-5"
          >
            {t("panel.subtitle")}
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t("close")}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function DesktopPanel({
  open,
  onOpenChange,
  onClose,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
}>) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="bg-overlay/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50" />
        <DialogPrimitive.Content
          aria-describedby="assistant-panel-description"
          aria-labelledby="assistant-panel-title"
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right fixed top-0 right-0 z-50 flex h-dvh w-[min(100vw,30rem)] flex-col overflow-hidden border-l shadow-2xl outline-none",
          )}
        >
          <PanelChrome onClose={onClose}>{children}</PanelChrome>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function MobilePanel({
  open,
  onOpenChange,
  onClose,
  children,
}: React.PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
}>) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="border-border/70 h-[88dvh] overflow-hidden rounded-t-[24px]">
        <PanelChrome onClose={onClose}>{children}</PanelChrome>
      </DrawerContent>
    </Drawer>
  );
}

export default function AssistantPanel({ open, onOpenChange }: Props) {
  const t = useTranslations("assistant");
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const queryClient = useQueryClient();
  const updateConsent = useUpdateAssistantConsent();
  const {
    data: consent,
    isError: consentIsError,
    isLoading: consentIsLoading,
  } = useAssistantConsent();
  const stopRef = useRef<(() => Promise<void>) | null>(null);

  const assistantEnabled = consent?.assistantEnabled ?? false;

  useEffect(() => {
    if (!open) {
      stopRef.current?.();
    }
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      void stopRef.current?.();
    }
    onOpenChange(nextOpen);
  };

  async function writeConsent(nextConsent: AssistantConsent) {
    queryClient.setQueryData(["assistant", "consent"], nextConsent);
  }

  async function enableAssistant() {
    const nextConsent = await updateConsent.mutateAsync({
      assistantEnabled: true,
      launcherHidden: false,
    });
    await writeConsent(nextConsent);
  }

  async function dismissAssistant() {
    const nextConsent = await updateConsent.mutateAsync({
      assistantEnabled: false,
      launcherHidden: true,
    });
    await writeConsent(nextConsent);
    handleOpenChange(false);
  }

  const content = consentIsLoading ? (
    <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-sm">
      {t("panel.loading")}
    </div>
  ) : consentIsError ? (
    <div className="text-destructive-text flex h-full items-center justify-center px-6 text-center text-sm">
      {t("panel.error")}
    </div>
  ) : assistantEnabled ? (
    <AssistantChat onStopChange={(stop) => (stopRef.current = stop)} />
  ) : (
    <AssistantConsentScreen
      onEnable={enableAssistant}
      onDismiss={dismissAssistant}
      isPending={updateConsent.isPending}
    />
  );

  return (
    <div>
      {isDesktop ? (
        <DesktopPanel
          open={open}
          onOpenChange={handleOpenChange}
          onClose={() => handleOpenChange(false)}
        >
          {content}
        </DesktopPanel>
      ) : (
        <MobilePanel
          open={open}
          onOpenChange={handleOpenChange}
          onClose={() => handleOpenChange(false)}
        >
          {content}
        </MobilePanel>
      )}
    </div>
  );
}

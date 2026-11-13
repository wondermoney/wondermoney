"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { isSimplefinEnabled } from "@/lib/api/banking/useSimplefin";
import { useConfirmedFeature } from "@/lib/api/instance/useInstance";

import SimplefinConnectDialog from "./SimplefinConnectDialog";

/**
 * True once the server has said SimpleFIN is on. It is off by default and the connect call fails
 * on a server without it, so the option stays hidden until the instance description confirms it.
 */
export function useSimplefinAvailable(): boolean {
  return useConfirmedFeature(isSimplefinEnabled);
}

/** "Connect with SimpleFIN" and its dialog, on a server that offers SimpleFIN; nothing otherwise. */
export default function SimplefinConnectButton() {
  const t = useTranslations("simplefin");
  const available = useSimplefinAvailable();
  const [open, setOpen] = useState(false);

  if (!available) return null;

  return (
    <SimplefinConnectDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button type="button" variant="secondary" className="gap-1.5">
          <Plus className="size-4" aria-hidden="true" />
          {t("connect")}
        </Button>
      }
    />
  );
}

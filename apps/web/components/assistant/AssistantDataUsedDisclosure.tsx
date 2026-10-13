"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

type Props = {
  className?: string;
};

export default function AssistantDataUsedDisclosure({ className }: Props) {
  const t = useTranslations("assistant");

  return (
    <details
      className={cn(
        "group rounded-2xl border border-border/70 bg-muted/30 p-3 text-sm",
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-left font-medium text-foreground">
        <span className="flex items-center gap-2">
          <ShieldCheck className="text-muted-foreground size-4 shrink-0" />
          <span>{t("chat.dataUsed.title")}</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>

      <div className="text-muted-foreground mt-3 space-y-2 leading-6">
        <p>{t("chat.dataUsed.description")}</p>
        <ul className="space-y-1 pl-4">
          <li>{t("chat.dataUsed.readOnly")}</li>
          <li>{t("chat.dataUsed.temporary")}</li>
          <li>{t("chat.dataUsed.tools")}</li>
        </ul>
      </div>
    </details>
  );
}

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
        "group rounded-lg border border-border/70 bg-muted/30 p-3 text-sm",
        className,
      )}
    >
      <summary className="focus-visible:ring-ring flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-left font-medium text-foreground focus-visible:ring-2 focus-visible:outline-hidden">
        <span className="flex items-center gap-2">
          <ShieldCheck className="text-muted-foreground size-4 shrink-0" />
          <span>{t("chat.dataUsed.title")}</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform duration-[var(--duration-short)] ease-out group-open:rotate-180 motion-reduce:transition-none" />
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

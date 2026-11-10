"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  usePrivacyMode,
  usePrivacyModeShortcut,
} from "@/lib/privacy/usePrivacyMode";
import { cn } from "@/lib/utils";

/**
 * The privacy mode switch. A toggle button (`aria-pressed`) rather than a
 * menu item, so its state is announced and it is one action from anywhere.
 *
 * `row` sits in the sidebar's footer beside Settings and Help; `icon` sits in
 * the mobile top bar beside the person's menu, with a 44px target.
 */
export default function PrivacyModeToggle({
  variant,
  className,
}: {
  variant: "row" | "icon";
  className?: string;
}) {
  const t = useTranslations("privacy-mode");
  const { hidden, toggle } = usePrivacyMode();
  const label = hidden ? t("show-amounts") : t("hide-amounts");
  const Icon = hidden ? EyeOffIcon : EyeIcon;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={hidden}
      aria-keyshortcuts="Shift+P"
      title={`${label} (${t("shortcut-hint")})`}
      className={cn(
        "focus-visible:ring-ring flex items-center rounded-md transition-colors duration-[var(--duration-micro)] ease-out focus-visible:ring-2 focus-visible:outline-hidden motion-reduce:transition-none",
        variant === "row"
          ? "text-muted-foreground hover:bg-foreground/5 hover:text-foreground h-9 gap-3 px-2.5 text-sm"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground size-11 justify-center",
        className,
      )}
      {...(variant === "icon" ? { "aria-label": label } : {})}
    >
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      {variant === "row" ? label : null}
    </button>
  );
}

/**
 * Shift+P anywhere in the signed-in shell. A toast confirms the change, since
 * a keyboard toggle has no button under the pointer to show its new state.
 */
export function PrivacyModeShortcut() {
  const t = useTranslations("privacy-mode");
  const onToggle = useCallback(
    (hidden: boolean) => {
      toast(hidden ? t("amounts-hidden") : t("amounts-shown"), {
        id: "privacy-mode",
      });
    },
    [t],
  );
  usePrivacyModeShortcut(onToggle);
  return null;
}

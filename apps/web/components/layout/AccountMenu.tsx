"use client";

import { Avatar, AvatarFallback } from "@radix-ui/react-avatar";
import {
  ChevronDown,
  ChevronsUpDown,
  Command as CommandIcon,
  FlaskConical,
  HelpCircleIcon,
  Lightbulb,
  LogOut,
  Moon,
  SettingsIcon,
  Sun,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useState } from "react";

import { Link } from "@/components/ui/Link";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { useIsDemoProfile } from "@/lib/api/user/useProfile";
import { useUser } from "@/lib/auth/user-context";
import { useSignOut } from "@/lib/auth/useSignOut";
import { instanceConfig } from "@/lib/instance";
import { useHydrated } from "@/lib/utils/useHydrated";

import { openCommandPalette } from "./command-palette-store";
import Feedback from "./Feedback";
import VersionInfo from "./VersionInfo";

const CHANGELOG_URL = "https://wondermoney.canny.io/changelog";

export const menuRowClass =
  "text-foreground hover:bg-foreground/5 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-[var(--duration-micro)] ease-out motion-reduce:transition-none";

function ThemeSwitch() {
  const t = useTranslations();
  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  // The resolved theme is unknown until hydration; render a stable label first.
  const isDark = hydrated && resolvedTheme === "dark";

  return (
    <button
      type="button"
      className={menuRowClass}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? (
        <Sun className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="size-4 shrink-0" aria-hidden="true" />
      )}
      {isDark ? t("top-bar.light-mode") : t("top-bar.dark-mode")}
    </button>
  );
}

/**
 * The person's menu: what's new, feedback, the theme, log out and the version.
 * At the foot of the sidebar (`placement="sidebar"`) it opens upwards and
 * leaves out Settings and Help, which sit just above it there; in the mobile
 * bar it carries them too.
 */
export default function AccountMenu({
  placement,
}: {
  placement: "sidebar" | "bar";
}) {
  const t = useTranslations();
  const signOut = useSignOut();
  const user = useUser();
  const isDemoProfile = useIsDemoProfile({ fetch: false });
  const [open, setOpen] = useState(false);
  const handle = user?.email?.split("@")[0];
  const displayName = user?.name?.trim() || handle;
  const initials = (
    user?.name?.trim()
      ? user.name
          .trim()
          .split(/\s+/)
          .map((part) => part[0])
          .slice(0, 2)
          .join("")
      : handle?.slice(0, 2)
  )?.toUpperCase();
  const isDemo =
    isDemoProfile ||
    (instanceConfig.demoEmail !== null &&
      user?.email === instanceConfig.demoEmail);
  const inSidebar = placement === "sidebar";

  const logout = () => signOut("/auth/login");

  const avatar = (
    <Avatar className="bg-muted text-foreground border-input flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {inSidebar ? (
        <PopoverTrigger
          className="hover:bg-foreground/5 flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors duration-[var(--duration-micro)] ease-out motion-reduce:transition-none"
          aria-label={t("open-user-menu")}
        >
          {avatar}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-foreground truncate text-sm font-medium">
              {displayName}
            </span>
            {user?.email ? (
              <span className="text-muted-foreground truncate text-xs">
                {user.email}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
        </PopoverTrigger>
      ) : (
        <PopoverTrigger
          className="hover:bg-foreground/5 flex h-10 items-center gap-2 rounded-md px-2 transition-colors duration-[var(--duration-micro)] ease-out motion-reduce:transition-none"
          aria-label={t("open-user-menu")}
        >
          {avatar}
          <ChevronDown
            className="text-muted-foreground size-4"
            aria-hidden="true"
          />
        </PopoverTrigger>
      )}
      <PopoverContent
        side={inSidebar ? "top" : "bottom"}
        align={inSidebar ? "start" : "end"}
        className="w-60 p-2"
      >
        {!inSidebar && user?.email ? (
          <p className="text-muted-foreground truncate px-3 pt-1 pb-2 text-xs">
            {user.email}
          </p>
        ) : null}
        {isDemo ? (
          <p className="bg-primary/10 text-primary mx-1 mb-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
            <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {t("demo-mode")}
              <span className="text-muted-foreground block text-xs">
                {t("demo-mode-restricted")}
              </span>
            </span>
          </p>
        ) : null}
        <ul className="flex flex-col">
          <li>
            <button
              type="button"
              className={menuRowClass}
              aria-keyshortcuts="Meta+K Control+K"
              onClick={() => {
                setOpen(false);
                openCommandPalette();
              }}
            >
              <CommandIcon className="size-4 shrink-0" aria-hidden="true" />
              {t("command-palette.menu-item")}
              <span
                className="text-muted-foreground ml-auto text-xs"
                aria-hidden="true"
              >
                {t("command-palette.shortcut")}
              </span>
            </button>
          </li>
          {inSidebar ? null : (
            <li>
              <Link
                href="/settings"
                className={menuRowClass}
                onClick={() => setOpen(false)}
              >
                <SettingsIcon className="size-4 shrink-0" aria-hidden="true" />
                {t("settings")}
              </Link>
            </li>
          )}
          <li>
            <Link href={CHANGELOG_URL} className={menuRowClass}>
              <Lightbulb className="size-4 shrink-0" aria-hidden="true" />
              {t("whats-new")}
            </Link>
          </li>
          {inSidebar ? null : (
            <li>
              <Link href={instanceConfig.docsUrl} className={menuRowClass}>
                <HelpCircleIcon
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                {t("help")}
              </Link>
            </li>
          )}
          <li>
            <ThemeSwitch />
          </li>
        </ul>
        <div className="px-1 pt-2">
          <Feedback />
        </div>
        <Separator className="my-2" />
        <button
          type="button"
          className={menuRowClass}
          onClick={() => void logout()}
        >
          <LogOut className="size-4 shrink-0" aria-hidden="true" />
          {t("logout")}
        </button>
        <div className="px-3 pt-1">
          <VersionInfo />
        </div>
      </PopoverContent>
    </Popover>
  );
}

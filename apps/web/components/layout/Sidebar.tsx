"use client";

import { HelpCircleIcon, SettingsIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Link } from "@/components/ui/Link";
import { usePathname } from "@/i18n/navigation";
import { instanceConfig } from "@/lib/instance";
import { cn } from "@/lib/utils";

import AccountMenu from "./AccountMenu";
import Logo from "./Logo";
import {
  currentChild,
  isWithin,
  NAVIGATION_GROUPS,
  type NavigationItem,
} from "./navigation";
import PrivacyModeToggle from "./PrivacyModeToggle";
import { useVisibleNavigation } from "./useVisibleNavigation";

const rowClass =
  "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors duration-[var(--duration-micro)] ease-out motion-reduce:transition-none focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-hidden";
const idleRowClass =
  "text-muted-foreground hover:bg-foreground/5 hover:text-foreground";
const currentRowClass = "bg-primary/10 text-primary font-medium";

/**
 * One destination. A section with pages of its own lists them beneath it
 * while you are inside it; the section itself then reads as the heading of
 * that list, and the current page carries the violet.
 */
function Destination({
  item,
  pathname,
}: {
  item: NavigationItem;
  pathname: string;
}) {
  const t = useTranslations();
  const within = isWithin(pathname, item.href);
  const open = within && item.children !== undefined;
  const child = open ? currentChild(item, pathname) : undefined;
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href}
        aria-current={within && !open ? "page" : undefined}
        className={cn(
          rowClass,
          open
            ? "text-foreground hover:bg-foreground/5 font-medium"
            : within
              ? currentRowClass
              : idleRowClass,
        )}
      >
        <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
        {t(item.labelKey)}
      </Link>
      {open ? (
        <ul
          aria-label={t(item.labelKey)}
          className="mt-0.5 mb-1 ml-8 flex flex-col gap-0.5"
        >
          {item.children?.map((page) => {
            const current = child?.id === page.id;
            return (
              <li key={page.id}>
                <Link
                  href={page.href}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    rowClass,
                    current ? currentRowClass : idleRowClass,
                  )}
                >
                  {t(page.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The desktop shell's navigation: the destinations in their three groups,
 * then Settings, Help and the person's menu at the foot. Under `lg` the
 * bottom tab bar and the mobile top bar take over.
 */
export default function Sidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const items = useVisibleNavigation();
  const ungrouped = items.filter((item) => item.group === undefined);

  return (
    <aside className="border-border bg-background sticky top-0 hidden h-dvh w-62 shrink-0 flex-col border-r lg:flex">
      <div className="px-5.5 pt-4 pb-2">
        <Logo className="h-10 w-28" />
      </div>
      <nav
        aria-label={t("navigation.sidebar-nav")}
        className="flex-1 overflow-y-auto px-3 pb-4"
      >
        <ul className="flex flex-col gap-0.5">
          {ungrouped.map((item) => (
            <Destination key={item.id} item={item} pathname={pathname} />
          ))}
        </ul>
        {NAVIGATION_GROUPS.map((group) => {
          const members = items.filter((item) => item.group === group.id);
          if (members.length === 0) return null;
          const headingId = `sidebar-group-${group.id}`;
          return (
            <div key={group.id} className="mt-6">
              <p
                id={headingId}
                className="text-muted-foreground px-2.5 pb-1.5 text-xs"
              >
                {t(group.labelKey)}
              </p>
              <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
                {members.map((item) => (
                  <Destination key={item.id} item={item} pathname={pathname} />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="border-border flex flex-col gap-0.5 border-t p-3">
        <Link
          href="/settings"
          aria-current={isWithin(pathname, "/settings") ? "page" : undefined}
          className={cn(
            rowClass,
            isWithin(pathname, "/settings") ? currentRowClass : idleRowClass,
          )}
        >
          <SettingsIcon className="size-5" strokeWidth={1.75} aria-hidden="true" />
          {t("settings")}
        </Link>
        <Link
          href={instanceConfig.docsUrl}
          className={cn(rowClass, idleRowClass)}
        >
          <HelpCircleIcon
            className="size-5"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          {t("help")}
        </Link>
        <PrivacyModeToggle variant="row" />
        <div className="mt-2">
          <AccountMenu placement="sidebar" />
        </div>
      </div>
    </aside>
  );
}

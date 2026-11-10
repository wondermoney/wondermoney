"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/components/ui/Link";
import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import AccountMenu from "./AccountMenu";
import Logo from "./Logo";
import {
  currentChild,
  currentSection,
  type NavigationItem,
} from "./navigation";
import PrivacyModeToggle from "./PrivacyModeToggle";
import { useVisibleNavigation } from "./useVisibleNavigation";

/** The current section's pages, as a tab row under the bar. */
function SectionTabs({ items }: { items: NavigationItem[] }) {
  const t = useTranslations();
  const pathname = usePathname();
  const section = currentSection(items, pathname);
  if (!section?.children) return null;
  const current = currentChild(section, pathname);

  return (
    <nav aria-label={t(section.labelKey)} className="border-border border-t">
      <ul className="mx-auto flex max-w-[85rem] gap-6 overflow-x-auto px-4">
        {section.children.map((child) => {
          const active = current?.id === child.id;
          return (
            <li key={child.id} className="shrink-0">
              <Link
                href={child.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center text-sm font-medium whitespace-nowrap transition-colors duration-[var(--duration-micro)] motion-reduce:transition-none",
                  active
                    ? "text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(child.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The shell's bar under `lg`: the wordmark, the person's menu, and the current
 * section's pages as tabs. The destinations are in the bottom tab bar; on
 * desktop the sidebar carries all of it.
 */
export default function TopBar() {
  const items = useVisibleNavigation();

  return (
    <header className="border-border bg-background sticky top-0 z-40 border-b lg:hidden">
      <div className="flex h-16 items-center gap-6 px-4">
        <Logo className="h-10 w-28 shrink-0" />
        <div className="ml-auto flex items-center gap-1">
          <PrivacyModeToggle variant="icon" />
          <AccountMenu placement="bar" />
        </div>
      </div>
      <SectionTabs items={items} />
    </header>
  );
}

"use client";

import { Briefcase, Home, Landmark, LayoutGrid, PieChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

import { Link } from "../ui/Link";
import BottomNavMoreSheet from "./BottomNavMoreSheet";

const tabs = [
  { id: "home", href: "/", icon: Home, labelKey: "navigation.home" },
  {
    id: "accounts",
    href: "/accounts",
    icon: Landmark,
    labelKey: "navigation.accounts",
  },
  {
    id: "budgets",
    href: "/budgets",
    icon: PieChart,
    labelKey: "navigation.budgets",
  },
  {
    id: "portfolio",
    href: "/portfolio",
    icon: Briefcase,
    labelKey: "navigation.portfolio",
  },
] as const;

export default function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations();
  const [moreOpen, setMoreOpen] = useState(false);
  const visibleTabs = tabs;

  const isTabActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  // More tab is active when the sheet is open OR when no primary tab matches the current path
  const isCoveredByPrimaryTab = visibleTabs.some((tab) =>
    isTabActive(tab.href),
  );
  const isMoreActive = moreOpen || !isCoveredByPrimaryTab;

  return (
    <>
      <nav
        aria-label={t("navigation.bottom-nav")}
        className="border-border bg-background fixed right-0 bottom-0 left-0 z-50 border-t lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        data-testid="bottom-nav"
      >
        <ul className="flex h-16 items-center">
          {visibleTabs.map((tab) => {
            const active = isTabActive(tab.href);
            return (
              <li key={tab.id} className="flex-1">
                <Link
                  href={tab.href}
                  className="flex flex-col items-center gap-0.5 py-2"
                  aria-current={active ? "page" : undefined}
                  data-testid={`bottom-nav-${tab.id}`}
                >
                  <tab.icon
                    className={cn(
                      "size-5",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                    strokeWidth={active ? 2 : 1.5}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      "text-xs",
                      active
                        ? "text-foreground font-medium"
                        : "text-muted-foreground",
                    )}
                  >
                    {t(tab.labelKey)}
                  </span>
                </Link>
              </li>
            );
          })}

          {/* More tab */}
          <li className="flex-1">
            <button
              className="flex w-full flex-col items-center gap-0.5 py-2"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              data-testid="bottom-nav-more"
            >
              <LayoutGrid
                className={cn(
                  "size-5",
                  isMoreActive ? "text-foreground" : "text-muted-foreground",
                )}
                strokeWidth={isMoreActive ? 2 : 1.5}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "text-xs",
                  isMoreActive
                    ? "text-foreground font-medium"
                    : "text-muted-foreground",
                )}
              >
                {t("more")}
              </span>
            </button>
          </li>
        </ul>
      </nav>

      <BottomNavMoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  );
}

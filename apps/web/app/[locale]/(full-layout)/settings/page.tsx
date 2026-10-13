"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import Profile from "@/components/settings/Profile";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePathname, useRouter } from "@/i18n/navigation";

const Security = dynamic(() => import("@/components/settings/Security"));
const Privacy = dynamic(() => import("@/components/settings/Privacy"));
const Connections = dynamic(
  () => import("@/components/settings/Connections/Connections"),
);
const BankProvider = dynamic(
  () => import("@/components/settings/BankProvider/EnableBankingKeySettings"),
);
const Appearance = dynamic(() => import("@/components/settings/Appearance"));
const Assistant = dynamic(() => import("@/components/settings/Assistant"));
const UserCategoriesTable = dynamic(
  () => import("@/components/settings/Categories"),
);
const Household = dynamic(() => import("@/components/settings/Household"));
const Notifications = dynamic(
  () => import("@/components/settings/Notifications"),
);

const tabs = [
  { name: "profile", label: "navigation.profile", Component: Profile },
  { name: "security", label: "navigation.security", Component: Security },
  { name: "privacy", label: "navigation.privacy", Component: Privacy },
  {
    name: "bank-provider",
    label: "navigation.bank-provider",
    Component: BankProvider,
  },
  {
    name: "connections",
    label: "navigation.connections",
    Component: Connections,
  },
  {
    name: "appearance",
    label: "navigation.appearance",
    Component: Appearance,
  },
  { name: "assistant", label: "navigation.assistant", Component: Assistant },
  {
    name: "categories",
    label: "navigation.categories",
    Component: UserCategoriesTable,
  },
  { name: "household", label: "navigation.household", Component: Household },
  {
    name: "notifications",
    label: "navigation.notifications",
    Component: Notifications,
  },
];

/**
 * Grouping for the mobile select (RAD-590). Ten flat entries in a dropdown
 * is reachable but not scannable — the grouping is by what the person is doing,
 * matching how the sidebar rail already splits Day-to-day / Investments /
 * Planning rather than by which service backs each screen.
 *
 * Desktop tabs are deliberately left flat: they fit at 1280px in English and
 * a working surface was not worth restructuring. Other locales can still run
 * wider than the container, so the desktop bar also scrolls with a fade
 * affordance — see the RAD-664 comment below.
 */
const TAB_GROUPS: readonly { label: string; tabs: readonly string[] }[] = [
  { label: "navigation.settings-group-account", tabs: ["profile", "security", "privacy", "household"] },
  { label: "navigation.settings-group-money", tabs: ["bank-provider", "connections", "categories"] },
  { label: "navigation.settings-group-preferences", tabs: ["appearance", "assistant", "notifications"] },
];

const SettingsPage = () => {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const router = useRouter();
  const pathname = usePathname();
  const selectedTabConfig =
    tabs.find((tab) => tab.name === tabParam) ??
    tabs.find((tab) => tab.name === "profile") ??
    tabs[0];
  const selectedTab = selectedTabConfig?.name ?? "profile";
  const SelectedComponent = selectedTabConfig?.Component;

  // RAD-664 — the desktop tab bar was assumed to fit flat at `lg` (see the
  // RAD-590 comment below), which held for English but not for pt-PT: longer
  // labels ("Agregado familiar", "Notificações") push the strip past its
  // container with no scrollbar and no cue, so the last tab clips mid-word.
  // Rather than hardcode a locale-specific breakpoint, the strip now scrolls
  // and reports its own overflow state so a fade only renders on the edge
  // that actually has more content — mirrors the scroll-affordance pattern
  // in components/ui/Table/Table.tsx.
  const tabListRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollAffordance = useCallback(() => {
    const el = tabListRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = tabListRef.current;
    if (!el) return;
    updateScrollAffordance();
    el.addEventListener("scroll", updateScrollAffordance, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollAffordance);
    resizeObserver.observe(el);
    return () => {
      el.removeEventListener("scroll", updateScrollAffordance);
      resizeObserver.disconnect();
    };
  }, [updateScrollAffordance]);

  // Get a new searchParams string by merging the current searchParams with a provided key/value
  // pair
  const createQueryString = useCallback(
    (name: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set(name, value);

      return params.toString();
    },
    [searchParams],
  );

  const handleTabChange = (tab: string) => {
    router.push(pathname + "?" + createQueryString("tab", tab));
  };

  return (
    <PageShell>
      {/* RAD-566 — this route had no <h1> at all. Until RAD-557 it opened on
          the sidebar's group <h2>, which hid that; with the nav out of the
          outline a screen reader's heading list started at the first tab
          panel's own heading. */}
      <PageHeader
        title={t("navigation.settings")}
      />
      <Tabs value={selectedTab} onValueChange={handleTabChange}>
        {/* RAD-590 — the settings tabs do not fit a horizontal bar below `lg`.
            `overflow-x-auto` made them reachable but not discoverable: measured
            at 360px, four were visible and the rest ran off the edge (including
            Household and Notifications) with no fade, no gradient and
            a zero-height scrollbar, so the right edge read as the end of the
            list. Still three short at 768px, hence the `lg` breakpoint rather
            than `sm`. A select names the current section and shows all of them
            in one tap. Both controls drive the same `?tab=` param. */}
        <div className="lg:hidden">
          <label className="sr-only" htmlFor="settings-section">
            {t("navigation.settings")}
          </label>
          <Select value={selectedTab} onValueChange={handleTabChange}>
            <SelectTrigger id="settings-section" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TAB_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{t(group.label)}</SelectLabel>
                  {group.tabs.map((name) => {
                    const tab = tabs.find((candidate) => candidate.name === name);
                    return tab ? (
                      <SelectItem key={tab.name} value={tab.name}>
                        {t(tab.label)}
                      </SelectItem>
                    ) : null;
                  })}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative hidden lg:block">
          <TabsList
            ref={tabListRef}
            className="w-full justify-start overflow-x-auto"
          >
            {tabs.map((tab) => (
              <TabsTrigger key={tab.name} value={tab.name}>
                {t(tab.label)}
              </TabsTrigger>
            ))}
          </TabsList>
          {canScrollLeft && (
            <div
              aria-hidden="true"
              className="from-muted pointer-events-none absolute inset-y-0 left-0 z-10 w-8 rounded-l-md bg-linear-to-r to-transparent"
            />
          )}
          {canScrollRight && (
            <div
              aria-hidden="true"
              className="from-muted pointer-events-none absolute inset-y-0 right-0 z-10 w-8 rounded-r-md bg-linear-to-l to-transparent"
            />
          )}
        </div>
        {tabs.map((tab) => (
          <TabsContent key={tab.name} value={tab.name}>
            {tab.name === selectedTab ? <SelectedComponent /> : null}
          </TabsContent>
        ))}
      </Tabs>
    </PageShell>
  );
};

export default SettingsPage;

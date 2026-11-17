"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import BankConnectionReturn from "@/components/settings/BankConnectionReturn";
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
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useFeature } from "@/lib/api/instance/useInstance";
import useAiHidden from "@/lib/api/user-preferences/useAiHidden";
import { useHydrated } from "@/lib/utils/useHydrated";

const Security = dynamic(() => import("@/components/settings/Security"));
const ApiTokens = dynamic(() => import("@/components/settings/ApiTokens"));
const ConnectAiClient = dynamic(
  () => import("@/components/settings/ConnectAiClient"),
);
const CalendarFeed = dynamic(
  () => import("@/components/settings/CalendarFeed"),
);
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
const Tags = dynamic(() => import("@/components/settings/Tags"));
const Rules = dynamic(() => import("@/components/settings/Rules"));
const Household = dynamic(() => import("@/components/settings/Household"));
const Notifications = dynamic(
  () => import("@/components/settings/Notifications"),
);

const tabs = [
  { name: "profile", label: "navigation.profile", Component: Profile },
  { name: "security", label: "navigation.security", Component: Security },
  { name: "api-tokens", label: "navigation.api-tokens", Component: ApiTokens },
  {
    name: "calendar-feed",
    label: "navigation.calendar-feed",
    Component: CalendarFeed,
  },
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
  { name: "tags", label: "navigation.tags", Component: Tags },
  { name: "rules", label: "navigation.rules", Component: Rules },
  { name: "household", label: "navigation.household", Component: Household },
  {
    name: "notifications",
    label: "navigation.notifications",
    Component: Notifications,
  },
];

/** Settings destinations grouped by task, at every viewport width. */
const TAB_GROUPS: readonly { label: string; tabs: readonly string[] }[] = [
  {
    label: "navigation.settings-group-account",
    tabs: [
      "profile",
      "security",
      "api-tokens",
      "calendar-feed",
      "privacy",
      "household",
    ],
  },
  {
    label: "navigation.settings-group-money",
    tabs: ["bank-provider", "connections", "categories", "tags", "rules"],
  },
  {
    label: "navigation.settings-group-preferences",
    tabs: ["appearance", "assistant", "notifications"],
  },
];

const SettingsPage = () => {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const router = useRouter();
  const pathname = usePathname();
  // The Assistant tab holds the assistant's settings and the Pending changes
  // list. A server with no assistant model can still take proposals from an
  // MCP client, so the tab stays while MCP is on (and the person has not hidden
  // AI); with neither there is nothing to show, so the tab goes and
  // `?tab=assistant` falls back to Profile like any unknown tab.
  //
  // Read only after hydration. The server has no `/v1/instance` answer and
  // renders the tab; the sidebar, hydrated first, has often fetched it by the
  // time this segment hydrates, so a server with no assistant dropped the tab
  // mid-hydration and React threw away the whole tab strip (a hydration
  // mismatch on every hard load of /settings).
  const hydrated = useHydrated();
  const assistantFeature = useFeature((features) => features.ai.assistant);
  // An older API that does not report `mcp` reads as on, like every other feature.
  const mcpFeature = useFeature((features) => features.mcp !== false);
  const aiHidden = useAiHidden();
  const assistantAvailable =
    !hydrated || assistantFeature || (mcpFeature && !aiHidden);
  const visibleTabs = tabs.filter(
    (tab) => tab.name !== "assistant" || assistantAvailable,
  );
  const selectedTabConfig =
    visibleTabs.find((tab) => tab.name === tabParam) ??
    visibleTabs.find((tab) => tab.name === "profile") ??
    visibleTabs[0];
  const selectedTab = selectedTabConfig?.name ?? "profile";
  const SelectedComponent = selectedTabConfig?.Component;

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
      {/* The route's own <h1>: the top bar's navigation is not part of the
          outline, so without it a screen reader's heading list would start at
          the first tab panel's own heading. */}
      <PageHeader title={t("navigation.settings")} />
      <BankConnectionReturn />
      <Tabs value={selectedTab} activationMode="manual">
        <TabsList
          aria-label={t("navigation.settings")}
          className="border-border hidden h-auto flex-wrap justify-start gap-1 rounded-none border-b bg-transparent p-0 pb-2 lg:flex"
        >
          {visibleTabs.map((tab) => (
            <TabsTrigger
              key={tab.name}
              value={tab.name}
              asChild
              className="data-[state=active]:border-primary data-[state=active]:text-primary min-h-10 rounded-none border-b-2 border-transparent bg-transparent px-3 shadow-none data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              <Link href={pathname + "?" + createQueryString("tab", tab.name)}>
                {t(tab.label)}
              </Link>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="w-full lg:hidden">
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
                    const tab = visibleTabs.find(
                      (candidate) => candidate.name === name,
                    );
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
        <TabsContent
          value={selectedTab}
          className="pt-6"
          aria-label={t(selectedTabConfig.label)}
        >
          {SelectedComponent ? (
            selectedTab === "api-tokens" ? (
              <div className="flex flex-col gap-10">
                <SelectedComponent />
                <ConnectAiClient />
              </div>
            ) : (
              <SelectedComponent />
            )
          ) : null}
        </TabsContent>
      </Tabs>
    </PageShell>
  );
};

export default SettingsPage;

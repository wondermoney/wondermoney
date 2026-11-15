import { useState } from "react";
import { Dialog, DialogPanel, Disclosure } from "@headlessui/react";
import {
  BookOpen,
  ChartPie,
  ChevronDown,
  FileText,
  Landmark,
  Menu,
  Shield,
  Tag,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import logo from "../../assets/logo.png";
import { type RouteId, toLocalizedPath, toToolsHubPath } from "@/lib/routes";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import { buildToolsHub, type ToolsHubTool } from "@/lib/toolsCatalog";
import { toolsMenuClickEvent } from "@/lib/toolsMenuTracking";
import { getTranslations } from "@/lib/translations";
import type { Lang } from "@/lib/i18nLocale";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { useNavMenus } from "./useNavMenus";

export type Props = {
  locale: Lang;
};

const triggerClassName =
  "flex items-center gap-x-1 rounded-sm text-sm font-medium leading-6 text-ink-2 transition-colors hover:text-foreground aria-expanded:text-foreground";
const chevronClassName =
  "h-4 w-4 flex-none text-muted-foreground transition-transform duration-150 motion-reduce:transition-none";

export default function Header({ locale }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menus = useNavMenus<"features" | "tools">("header-menu");
  const t = getTranslations(locale);
  const homeHref = `/${locale}`;
  const toolsHubHref = toToolsHubPath(locale);
  // The catalog's task groups: a tool added to the catalog appears here and in the drawer.
  const toolGroups = buildToolsHub(locale);
  const ctaUrl = useCtaUrl();

  const trackToolClick = (tool: ToolsHubTool) =>
    pushGtmEvent(toolsMenuClickEvent(tool));

  const featureItems: Array<{
    nameKey: string;
    descKey: string;
    routeId: RouteId;
    icon: typeof Landmark;
  }> = [
    {
      nameKey: "header.nav.accounts.name",
      descKey: "header.nav.accounts.description",
      routeId: "featureAccounts",
      icon: Landmark,
    },
    {
      nameKey: "header.nav.budgeting.name",
      descKey: "header.nav.budgeting.description",
      routeId: "featureBudgeting",
      icon: BookOpen,
    },
    {
      nameKey: "header.nav.categorization.name",
      descKey: "header.nav.categorization.description",
      routeId: "featureCategorization",
      icon: Tag,
    },
    {
      nameKey: "header.nav.portfolio.name",
      descKey: "header.nav.portfolio.description",
      routeId: "featurePortfolio",
      icon: ChartPie,
    },
    {
      nameKey: "header.nav.reports.name",
      descKey: "header.nav.reports.description",
      routeId: "featureReports",
      icon: FileText,
    },
    {
      nameKey: "header.nav.privacy.name",
      descKey: "header.nav.privacy.description",
      routeId: "featurePrivacy",
      icon: Shield,
    },
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md">
      <nav
        className="relative mx-auto flex h-16 max-w-7xl items-center gap-x-6 px-6 lg:gap-x-10 lg:px-8"
        aria-label="Global"
      >
        {/* Logo */}
        <div className="flex">
          <a href={homeHref} className="flex items-center">
            <img src={logo.src} alt="WonderMoney" className="h-7 lg:h-8" />
          </a>
        </div>

        {/* Mobile menu button */}
        <div className="ml-auto flex lg:hidden">
          <button
            type="button"
            className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-foreground"
            onClick={() => setMobileMenuOpen(true)}
          >
            <span className="sr-only">{t("header.openMainMenu")}</span>
            <Menu className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>

        {/* Desktop nav */}
        <div className="hidden lg:flex lg:flex-1 lg:items-center lg:gap-x-7 lg:self-stretch">
          {/* Features dropdown */}
          <div
            {...menus.rootProps("features")}
            className="relative flex items-center self-stretch"
          >
            <button
              {...menus.triggerProps("features")}
              className={triggerClassName}
            >
              {t("header.features")}
              <ChevronDown
                className={cn(
                  chevronClassName,
                  menus.openId === "features" && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            {/* The top padding bridges the gap to the trigger, so the pointer can cross it. */}
            <div
              {...menus.panelProps("features")}
              className="absolute left-1/2 top-full z-50 w-72 -translate-x-1/2 pt-1"
            >
              <div className="overflow-hidden rounded-card border border-border bg-card py-2 shadow-lg">
                {featureItems.map((item) => (
                  <a
                    key={item.nameKey}
                    href={toLocalizedPath(item.routeId, locale)}
                    className="group flex items-center gap-x-4 px-4 py-3 text-sm leading-6 hover:bg-accent"
                    onClick={menus.close}
                  >
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-paper-2 group-hover:bg-background">
                      <item.icon
                        className="h-5 w-5 text-muted-foreground group-hover:text-primary"
                        aria-hidden="true"
                      />
                    </div>
                    <div>
                      <span className="block font-semibold text-foreground">
                        {t(item.nameKey)}
                      </span>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t(item.descKey)}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>

          {/* Tools mega menu: the panel spans the nav, positioned against it, not the trigger */}
          <div
            {...menus.rootProps("tools")}
            className="flex items-center self-stretch"
          >
            <button {...menus.triggerProps("tools")} className={triggerClassName}>
              {t("header.tools")}
              <ChevronDown
                className={cn(
                  chevronClassName,
                  menus.openId === "tools" && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            <div
              {...menus.panelProps("tools")}
              data-tools-menu
              className="absolute inset-x-6 top-full z-50 pt-1 lg:inset-x-8"
            >
              <div className="max-h-[calc(100vh-5rem)] overflow-y-auto rounded-card border border-border bg-card shadow-lg">
                <div className="grid auto-cols-fr grid-flow-col gap-x-8 px-6 py-6">
                  {toolGroups.map((group) => (
                    <div key={group.id}>
                      <p
                        id={`header-tools-${group.anchor}`}
                        className="text-sm text-muted-foreground"
                      >
                        {t(`tools.hub.groups.${group.id}.title`)}
                      </p>
                      <ul
                        aria-labelledby={`header-tools-${group.anchor}`}
                        className="mt-3 space-y-1"
                      >
                        {group.tools.map((tool) => (
                          <li key={tool.key}>
                            <a
                              href={tool.href}
                              className="-mx-2 block rounded-md px-2 py-1.5 text-sm font-medium leading-6 text-foreground transition-colors hover:bg-accent hover:text-primary motion-reduce:transition-none"
                              onClick={() => {
                                trackToolClick(tool);
                                menus.close();
                              }}
                              onAuxClick={(event) => {
                                if (event.button === 1) trackToolClick(tool);
                              }}
                            >
                              {t(`tools.${tool.key}.shortName`)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-x-6 border-t border-border px-6 py-4">
                  <p className="text-sm text-muted-foreground">
                    {t("tools.hub.description")}
                  </p>
                  <a
                    href={toolsHubHref}
                    className="shrink-0 rounded-sm text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
                    onClick={menus.close}
                  >
                    {t("header.toolsMenu.seeAll")}
                  </a>
                </div>
              </div>
            </div>
          </div>

          <a
            href="https://app.wonder.money/faq"
            className="rounded-sm text-sm font-medium leading-6 text-ink-2 transition-colors hover:text-foreground"
          >
            {t("header.faq")}
          </a>
          <a
            href={toLocalizedPath("pageAbout", locale)}
            className="rounded-sm text-sm font-medium leading-6 text-ink-2 transition-colors hover:text-foreground"
          >
            {t("header.about")}
          </a>
        </div>

        {/* Desktop CTAs */}
        <div className="hidden lg:flex lg:items-center lg:gap-x-3">
          <Button asChild variant="link" className="text-foreground">
            <a href="https://app.wonder.money/auth/login">
              {t("header.login")}
            </a>
          </Button>
          <Button asChild size="sm">
            <a
              href={ctaUrl}
              onClick={() =>
                pushGtmEvent({
                  event: "cta_click",
                  cta_position: "header",
                  page_type: getPageType(),
                })
              }
            >
              {t("global.mainCta")}
            </a>
          </Button>
        </div>
      </nav>

      {/* Mobile menu */}
      <Dialog
        className="lg:hidden"
        open={mobileMenuOpen}
        onClose={setMobileMenuOpen}
      >
        <div className="fixed inset-0 z-10" />
        <DialogPanel className="fixed inset-y-0 right-0 z-10 w-full overflow-y-auto border-l border-border bg-background px-6 py-6 sm:max-w-sm">
          <div className="flex items-center justify-between">
            <a href={homeHref} className="-m-1.5 p-1.5">
              <span className="sr-only">WonderMoney</span>
              <img className="h-8 w-auto" src={logo.src} alt="WonderMoney" />
            </a>
            <button
              type="button"
              className="-m-2.5 rounded-md p-2.5 text-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              <span className="sr-only">{t("header.closeMenu")}</span>
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-6 flow-root">
            <div className="-my-6 divide-y divide-border">
              <div className="space-y-2 py-6">
                {/* Features accordion */}
                <Disclosure as="div" className="-mx-3">
                  {({ open }) => (
                    <>
                      <Disclosure.Button className="flex w-full items-center justify-between rounded-lg py-2 pl-3 pr-3.5 text-base font-semibold leading-7 text-foreground hover:bg-accent">
                        {t("header.features")}
                        <ChevronDown
                          className={cn(
                            open ? "rotate-180" : "",
                            "h-5 w-5 flex-none transition-transform",
                          )}
                          aria-hidden="true"
                        />
                      </Disclosure.Button>
                      <Disclosure.Panel className="mt-2 space-y-1">
                        {featureItems.map((item) => (
                          <Disclosure.Button
                            key={item.nameKey}
                            as="a"
                            href={toLocalizedPath(item.routeId, locale)}
                            className="flex items-center gap-x-3 rounded-lg py-2 pl-6 pr-3 text-sm font-semibold leading-7 text-foreground hover:bg-accent"
                          >
                            <item.icon
                              className="h-4 w-4 text-muted-foreground"
                              aria-hidden="true"
                            />
                            {t(item.nameKey)}
                          </Disclosure.Button>
                        ))}
                      </Disclosure.Panel>
                    </>
                  )}
                </Disclosure>

                {/* Tools accordion */}
                <Disclosure as="div" className="-mx-3">
                  {({ open }) => (
                    <>
                      <Disclosure.Button className="flex w-full items-center justify-between rounded-lg py-2 pl-3 pr-3.5 text-base font-semibold leading-7 text-foreground hover:bg-accent">
                        {t("header.tools")}
                        <ChevronDown
                          className={cn(
                            open ? "rotate-180" : "",
                            "h-5 w-5 flex-none transition-transform",
                          )}
                          aria-hidden="true"
                        />
                      </Disclosure.Button>
                      <Disclosure.Panel
                        className="mt-2 space-y-3"
                        data-tools-drawer
                      >
                        {toolGroups.map((group) => (
                          <div key={group.id}>
                            <p
                              id={`drawer-tools-${group.anchor}`}
                              className="py-1 pl-6 pr-3 text-sm text-muted-foreground"
                            >
                              {t(`tools.hub.groups.${group.id}.title`)}
                            </p>
                            <ul
                              aria-labelledby={`drawer-tools-${group.anchor}`}
                              className="space-y-1"
                            >
                              {group.tools.map((tool) => (
                                <li key={tool.key}>
                                  <a
                                    href={tool.href}
                                    className="block rounded-lg py-2 pl-6 pr-3 text-sm font-semibold leading-7 text-foreground hover:bg-accent"
                                    onClick={() => trackToolClick(tool)}
                                  >
                                    {t(`tools.${tool.key}.shortName`)}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        <a
                          href={toolsHubHref}
                          className="block rounded-lg py-2 pl-6 pr-3 text-sm font-semibold leading-7 text-primary hover:bg-accent"
                        >
                          {t("header.toolsMenu.seeAll")}
                        </a>
                      </Disclosure.Panel>
                    </>
                  )}
                </Disclosure>

                <a
                  href="https://app.wonder.money/faq"
                  className="-mx-3 block rounded-lg px-3 py-2 text-base font-semibold leading-7 text-foreground hover:bg-accent"
                >
                  {t("header.faq")}
                </a>
                <a
                  href={toLocalizedPath("pageAbout", locale)}
                  className="-mx-3 block rounded-lg px-3 py-2 text-base font-semibold leading-7 text-foreground hover:bg-accent"
                >
                  {t("header.about")}
                </a>
              </div>
              <div className="py-6 flex flex-col gap-3">
                <Button asChild size="lg">
                  <a
                    href={ctaUrl}
                    onClick={() =>
                      pushGtmEvent({
                        event: "cta_click",
                        cta_position: "header_mobile",
                        page_type: getPageType(),
                      })
                    }
                  >
                    {t("global.mainCta")}
                  </a>
                </Button>
                <a
                  href="https://app.wonder.money/auth/login"
                  className="rounded-lg border border-border px-3 py-2.5 text-center text-base font-semibold leading-7 text-foreground hover:bg-accent"
                >
                  {t("header.login")}
                </a>
              </div>
            </div>
          </div>
        </DialogPanel>
      </Dialog>
    </header>
  );
}

import { useState, type MouseEvent, type ReactNode } from "react";
import { Dialog, DialogPanel, Disclosure } from "@headlessui/react";
import { ChevronDown, Menu, X } from "lucide-react";
import { LAYER } from "@/lib/layers";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import logo from "../../assets/logo.png";
import { toLocalizedPath, toToolsHubPath } from "@/lib/routes";
import { pushGtmEvent, getPageType } from "@/lib/gtm";
import { FEATURE_MENU, FEATURE_MENU_GROUPS } from "@/lib/featureMenu";
import {
  buildHeaderToolMenus,
  type ToolsHubTool,
  type ToolsMenuGroup,
} from "@/lib/toolsCatalog";
import { toolsMenuClickEvent, type ToolsNavMenu } from "@/lib/toolsMenuTracking";
import { getTranslations } from "@/lib/translations";
import type { Lang } from "@/lib/i18nLocale";
import { useCtaUrl } from "@/hooks/useCtaUrl";
import { useNavMenus } from "./useNavMenus";

export type Props = {
  locale: Lang;
};

type MenuId = "features" | "tools" | "comparators";

const triggerClassName =
  "flex items-center gap-x-1 whitespace-nowrap rounded-sm text-sm font-medium leading-6 text-ink-2 transition-colors hover:text-foreground aria-expanded:text-foreground";
const chevronClassName =
  "h-4 w-4 flex-none text-muted-foreground transition-transform duration-150 motion-reduce:transition-none";
/** A panel row with an icon tile, a name and one line under it: features and comparators. */
const tileLinkClassName =
  "group flex items-start gap-x-3 rounded-md p-3 transition-colors hover:bg-accent motion-reduce:transition-none";
const tileClassName =
  "flex h-9 w-9 flex-none items-center justify-center rounded-md border border-border bg-background";
const tileIconClassName =
  "h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-primary motion-reduce:transition-none";
/** The thin outline icon before a tool's name, in the Tools menu and the drawer. */
const toolIconClassName =
  "h-4 w-4 flex-none text-muted-foreground transition-colors group-hover:text-primary motion-reduce:transition-none";
const drawerAccordionClassName =
  "flex w-full items-center justify-between rounded-lg py-2 pl-3 pr-3.5 text-base font-semibold leading-7 text-foreground hover:bg-accent";
const drawerRowClassName =
  "group flex items-center gap-x-3 rounded-lg py-2 pl-6 pr-3 text-sm font-medium leading-6 text-foreground hover:bg-accent";
const drawerHeadingClassName = "pb-1 pl-6 pr-3 text-sm font-medium text-foreground";
const drawerSubheadingClassName = "pb-0.5 pl-6 pr-3 pt-2 text-xs text-muted-foreground";

function DrawerAccordion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Disclosure as="div" className="-mx-3">
      {({ open }) => (
        <>
          <Disclosure.Button className={drawerAccordionClassName}>
            {label}
            <ChevronDown
              className={cn(
                open ? "rotate-180" : "",
                "h-5 w-5 flex-none transition-transform motion-reduce:transition-none",
              )}
              aria-hidden="true"
            />
          </Disclosure.Button>
          {children}
        </>
      )}
    </Disclosure>
  );
}

export default function Header({ locale }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menus = useNavMenus<MenuId>("header-menu");
  const t = getTranslations(locale);
  const homeHref = `/${locale}`;
  const toolsHubHref = toToolsHubPath(locale);
  // The catalog's task groups, split under their subgroups, and its comparators: a tool added
  // to the catalog appears in its menu here and in the drawer.
  const { columns: toolColumns, comparators } = buildHeaderToolMenus(locale);
  const toolGroups = toolColumns.flat();
  const ctaUrl = useCtaUrl();

  const trackToolClick = (
    tool: ToolsHubTool,
    position: "header" | "drawer",
    menu: ToolsNavMenu,
  ) => pushGtmEvent(toolsMenuClickEvent(tool, position, menu));
  // The short name, or the full title for a tool whose short name is still missing in this
  // locale, so one missing key never fails every page (toolsCatalog.test.ts requires it).
  const toolName = (tool: ToolsHubTool) =>
    t(`tools.${tool.key}.shortName`, {
      defaultValue: t(`tools.${tool.key}.title`),
    });
  const toolLinkProps = (
    tool: ToolsHubTool,
    position: "header" | "drawer",
    menu: ToolsNavMenu,
  ) => ({
    href: tool.href,
    onClick: () => {
      trackToolClick(tool, position, menu);
      if (position === "header") menus.close();
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button === 1) trackToolClick(tool, position, menu);
    },
  });
  const sectionHeadingId = (
    where: "header" | "drawer",
    group: ToolsMenuGroup,
    subgroup: string | null,
  ) => `${where}-tools-${group.anchor}${subgroup ? `-${subgroup}` : ""}`;
  const sectionHeading = (group: ToolsMenuGroup, subgroup: string | null) =>
    subgroup
      ? t(`header.toolsMenu.subgroups.${subgroup}`)
      : t(`tools.hub.groups.${group.id}.title`);

  return (
    <header
      className={cn(
        "sticky top-0 border-b border-border bg-background/95 backdrop-blur-md",
        LAYER.header,
      )}
    >
      <nav
        className="relative mx-auto flex h-16 max-w-7xl items-center gap-x-6 px-6 lg:gap-x-8 lg:px-8 xl:gap-x-10"
        aria-label="Global"
      >
        {/* Logo */}
        <div className="flex flex-none">
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
        <div className="hidden lg:flex lg:flex-1 lg:items-center lg:gap-x-6 lg:self-stretch xl:gap-x-7">
          {/* Features mega menu: one column per group, spanning the nav like the tools menu */}
          <div
            {...menus.rootProps("features")}
            className="flex items-center self-stretch"
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
              data-features-menu
              className="absolute inset-x-6 top-full z-50 pt-1 lg:inset-x-8"
            >
              <div className="grid max-h-[calc(100vh-5rem)] grid-cols-3 gap-1 overflow-y-auto rounded-card border border-border bg-card p-2 shadow-lg">
                {FEATURE_MENU_GROUPS.map((group) => (
                  <ul key={group} className="min-w-0 space-y-1" data-features-group={group}>
                    {FEATURE_MENU.filter((item) => item.group === group).map((item) => (
                      <li key={item.routeId}>
                        <a
                          href={toLocalizedPath(item.routeId, locale)}
                          className={tileLinkClassName}
                          onClick={menus.close}
                        >
                          <span className={tileClassName}>
                            <item.icon
                              className={tileIconClassName}
                              strokeWidth={1.5}
                              aria-hidden="true"
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium leading-5 text-foreground">
                              {t(`header.nav.${item.key}.name`)}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                              {t(`header.nav.${item.key}.description`)}
                            </span>
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
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
                {/* The hub link sits at the top, where nothing fixed to the viewport's foot covers it. */}
                <div className="flex items-center justify-between gap-x-6 border-b border-border px-6 py-3">
                  <p className="text-sm font-medium text-foreground">
                    {t("tools.hub.title")}
                  </p>
                  <a
                    href={toolsHubHref}
                    className="shrink-0 rounded-sm text-sm font-medium text-primary underline decoration-primary/40 underline-offset-4 hover:opacity-80"
                    onClick={menus.close}
                  >
                    {t("header.toolsMenu.seeAll")}
                  </a>
                </div>
                <div className="grid grid-cols-3 gap-x-8 px-6 py-5">
                  {toolColumns.map((column) => (
                    <div key={column[0].id} className="min-w-0 space-y-6">
                      {column.map((group) => (
                        <div key={group.id}>
                          <p
                            id={sectionHeadingId("header", group, null)}
                            className="border-b border-border pb-2 text-sm font-medium text-foreground"
                          >
                            {t(`tools.hub.groups.${group.id}.title`)}
                          </p>
                          {group.sections.map((section) => (
                            <div key={section.subgroup ?? "group"} className="mt-3">
                              {section.subgroup && (
                                <p
                                  id={sectionHeadingId("header", group, section.subgroup)}
                                  className="mb-1 text-xs leading-5 text-muted-foreground"
                                >
                                  {sectionHeading(group, section.subgroup)}
                                </p>
                              )}
                              <ul
                                aria-labelledby={sectionHeadingId(
                                  "header",
                                  group,
                                  section.subgroup,
                                )}
                              >
                                {section.tools.map((tool) => (
                                  <li key={tool.key}>
                                    <a
                                      {...toolLinkProps(tool, "header", "tools")}
                                      className="group -mx-2 flex items-center gap-x-2.5 rounded-md px-2 py-1 text-sm leading-6 text-foreground transition-colors hover:bg-accent hover:text-primary motion-reduce:transition-none"
                                    >
                                      <tool.icon
                                        className={toolIconClassName}
                                        strokeWidth={1.5}
                                        aria-hidden="true"
                                      />
                                      <span className="min-w-0">{toolName(tool)}</span>
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="border-t border-border px-6 py-3 text-sm text-muted-foreground">
                  {t("tools.hub.description")}
                </p>
              </div>
            </div>
          </div>

          {/* Comparators dropdown: the pages comparing offers from providers */}
          <div
            {...menus.rootProps("comparators")}
            className="relative flex items-center self-stretch"
          >
            <button
              {...menus.triggerProps("comparators")}
              className={triggerClassName}
            >
              {t("header.comparators")}
              <ChevronDown
                className={cn(
                  chevronClassName,
                  menus.openId === "comparators" && "rotate-180",
                )}
                aria-hidden="true"
              />
            </button>
            <div
              {...menus.panelProps("comparators")}
              data-comparators-menu
              className="absolute left-1/2 top-full z-50 w-[38rem] -translate-x-1/2 pt-1"
            >
              <div className="overflow-hidden rounded-card border border-border bg-card shadow-lg">
                <ul className="grid grid-cols-2 gap-1 p-2">
                  {comparators.map((tool) => (
                    <li key={tool.key}>
                      <a
                        {...toolLinkProps(tool, "header", "comparators")}
                        className={tileLinkClassName}
                      >
                        <span className={tileClassName}>
                          <tool.icon
                            className={tileIconClassName}
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium leading-5 text-foreground">
                            {toolName(tool)}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                            {t(`header.comparatorsMenu.items.${tool.key}`, {
                              defaultValue: "",
                            })}
                          </span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border px-5 py-3 text-xs leading-5 text-muted-foreground">
                  {t("header.comparatorsMenu.description")}
                </p>
              </div>
            </div>
          </div>

          <a
            href="https://app.wonder.money/faq"
            className="whitespace-nowrap rounded-sm text-sm font-medium leading-6 text-ink-2 transition-colors hover:text-foreground"
          >
            {t("header.faq")}
          </a>
          <a
            href={toLocalizedPath("pageAbout", locale)}
            className="whitespace-nowrap rounded-sm text-sm font-medium leading-6 text-ink-2 transition-colors hover:text-foreground"
          >
            {t("header.about")}
          </a>
        </div>

        {/* Desktop CTAs */}
        <div className="hidden lg:flex lg:flex-none lg:items-center lg:gap-x-3">
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
        {/* Above the banner, the header and the sticky CTA, so a tap lands in the drawer (src/lib/layers.ts) */}
        <div className={cn("fixed inset-0", LAYER.drawer)} />
        <DialogPanel
          className={cn(
            "fixed inset-y-0 right-0 w-full overflow-y-auto border-l border-border bg-background px-6 py-6 sm:max-w-sm",
            LAYER.drawer,
          )}
        >
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
                <DrawerAccordion label={t("header.features")}>
                  <Disclosure.Panel
                    as="ul"
                    className="mt-2 space-y-1"
                    data-features-drawer
                  >
                    {FEATURE_MENU.map((item) => (
                      <li key={item.routeId}>
                        <a
                          href={toLocalizedPath(item.routeId, locale)}
                          className={drawerRowClassName}
                        >
                          <item.icon
                            className={toolIconClassName}
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          {t(`header.nav.${item.key}.name`)}
                        </a>
                      </li>
                    ))}
                  </Disclosure.Panel>
                </DrawerAccordion>

                <DrawerAccordion label={t("header.tools")}>
                  <Disclosure.Panel
                    className="mt-2 space-y-4"
                    data-tools-drawer
                  >
                    {toolGroups.map((group) => (
                      <div key={group.id}>
                        <p
                          id={sectionHeadingId("drawer", group, null)}
                          className={drawerHeadingClassName}
                        >
                          {t(`tools.hub.groups.${group.id}.title`)}
                        </p>
                        {group.sections.map((section) => (
                          <div key={section.subgroup ?? "group"}>
                            {section.subgroup && (
                              <p
                                id={sectionHeadingId("drawer", group, section.subgroup)}
                                className={drawerSubheadingClassName}
                              >
                                {sectionHeading(group, section.subgroup)}
                              </p>
                            )}
                            <ul
                              aria-labelledby={sectionHeadingId(
                                "drawer",
                                group,
                                section.subgroup,
                              )}
                            >
                              {section.tools.map((tool) => (
                                <li key={tool.key}>
                                  <a
                                    {...toolLinkProps(tool, "drawer", "tools")}
                                    className={drawerRowClassName}
                                  >
                                    <tool.icon
                                      className={toolIconClassName}
                                      strokeWidth={1.5}
                                      aria-hidden="true"
                                    />
                                    {toolName(tool)}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ))}
                    <a
                      href={toolsHubHref}
                      className="block rounded-lg py-2 pl-6 pr-3 text-sm font-semibold leading-6 text-primary hover:bg-accent"
                    >
                      {t("header.toolsMenu.seeAll")}
                    </a>
                  </Disclosure.Panel>
                </DrawerAccordion>

                <DrawerAccordion label={t("header.comparators")}>
                  <Disclosure.Panel
                    as="ul"
                    className="mt-2 space-y-1"
                    data-comparators-drawer
                  >
                    {comparators.map((tool) => (
                      <li key={tool.key}>
                        <a
                          {...toolLinkProps(tool, "drawer", "comparators")}
                          className={drawerRowClassName}
                        >
                          <tool.icon
                            className={toolIconClassName}
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                          {toolName(tool)}
                        </a>
                      </li>
                    ))}
                  </Disclosure.Panel>
                </DrawerAccordion>

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

// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Calculator } from "lucide-react";
import { createConsentDecision, writeConsentDecision } from "@/lib/consent";
import { FEATURE_MENU, FEATURE_MENU_GROUPS } from "@/lib/featureMenu";
import { FEATURE_ROUTE_IDS, SUPPORTED_LANGS, toLocalizedPath, toToolsHubPath } from "@/lib/routes";
import { TOOLS_CATALOG, buildHeaderToolMenus, type ToolCatalogEntry } from "@/lib/toolsCatalog";
import { getTranslations } from "@/lib/translations";
import { ConsentBanner } from "./ConsentBanner";
import Header from "./Header";
import PivotAnnouncementBanner from "./PivotAnnouncementBanner";
import StickyMobileCta from "./StickyMobileCta";
import { HOVER_CLOSE_DELAY_MS, HOVER_OPEN_DELAY_MS } from "./useNavMenus";

// Entries a test adds to the catalog, as a new tool would be added to TOOLS_CATALOG.
const added = vi.hoisted(() => ({ entries: [] as ToolCatalogEntry[] }));

vi.mock("@/lib/toolsCatalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/toolsCatalog")>();
  return {
    ...actual,
    buildHeaderToolMenus: (lang: Parameters<typeof actual.buildHeaderToolMenus>[0]) =>
      actual.buildHeaderToolMenus(lang, [...actual.TOOLS_CATALOG, ...added.entries]),
  };
});

vi.mock("@/lib/translations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/translations")>();
  return {
    ...actual,
    getTranslations: (lang: Parameters<typeof actual.getTranslations>[0]) => {
      const t = actual.getTranslations(lang);
      return ((key: string, options?: Record<string, unknown>) =>
        key === "tools.testOnlyPlanner.shortName"
          ? "Test-only planner"
          : key === "tools.testOnlyPlanner.title"
            ? "Test-only planner calculator"
          : key === "tools.testUnnamedPlanner.title"
            ? "Test-only planner with no short name"
            : t(key, options)) as typeof t;
    },
  };
});

const en = getTranslations("en");

beforeEach(() => {
  window.localStorage.clear();
  window.dataLayer = [];
  // Clicking a link would make jsdom attempt a navigation it doesn't implement.
  document.addEventListener("click", preventNavigation, true);
});

afterEach(() => {
  cleanup();
  added.entries = [];
  vi.useRealTimers();
  document.removeEventListener("click", preventNavigation, true);
});

function preventNavigation(event: Event) {
  if ((event.target as Element | null)?.closest?.("a[href]")) event.preventDefault();
}

type MenuName = "features" | "tools" | "comparators";

function trigger(name: MenuName) {
  return screen.getByRole("button", { name: en(`header.${name}`) });
}

/** The element hover is measured on: the trigger's wrapper, which also holds the panel. */
function menuRoot(name: MenuName) {
  return trigger(name).parentElement!;
}

function panel(name: MenuName) {
  return document.getElementById(trigger(name).getAttribute("aria-controls")!)!;
}

function expanded(name: MenuName) {
  return trigger(name).getAttribute("aria-expanded") === "true";
}

const mouse = { pointerType: "mouse" };

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Header tools menu", () => {
  it("lists every tool but the comparators under its group and subgroup, with an icon, after the hub link", () => {
    render(<Header locale="en" />);
    const tools = panel("tools");
    const { columns } = buildHeaderToolMenus("en");
    const groups = columns.flat();

    for (const group of groups) {
      expect(within(tools).getByText(en(`tools.hub.groups.${group.id}.title`))).toBeTruthy();
      for (const section of group.sections) {
        const list = within(tools).getByRole("list", {
          name: section.subgroup
            ? en(`header.toolsMenu.subgroups.${section.subgroup}`)
            : en(`tools.hub.groups.${group.id}.title`),
          hidden: true,
        });
        const links = within(list).getAllByRole("link", { hidden: true });
        expect(links.map((link) => link.getAttribute("href"))).toEqual(section.tools.map((tool) => tool.href));
        expect(links.map((link) => link.textContent)).toEqual(
          section.tools.map((tool) => en(`tools.${tool.key}.shortName`)),
        );
        for (const link of links) expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull();
      }
    }
    // Three columns, the last holding the two short groups.
    expect(groups.map((group) => group.id)).toEqual(["budgetAndSave", "borrowAndBuyHome", "investAndGrow", "trackWealth"]);
    const all = within(tools).getAllByRole("link", { hidden: true });
    // At the top, where the consent card fixed to the viewport's foot can't cover it.
    expect(all[0]).toHaveProperty("textContent", en("header.toolsMenu.seeAll"));
    expect(all[0].getAttribute("href")).toBe(toToolsHubPath("en"));
    expect(all).toHaveLength(TOOLS_CATALOG.filter((tool) => !("comparator" in tool)).length + 1);
  });

  it("shows a tool added to the catalog in the desktop menu and the mobile drawer", async () => {
    added.entries = [{ key: "testOnlyPlanner", routeId: "toolMortgage", group: "trackWealth", icon: Calculator }];
    const user = userEvent.setup();
    render(<Header locale="en" />);
    const href = toLocalizedPath("toolMortgage", "en");
    const groupName = en("tools.hub.groups.trackWealth.title");

    const desktopGroup = within(panel("tools")).getByRole("list", { name: groupName, hidden: true });
    expect(within(desktopGroup).getByRole("link", { name: "Test-only planner", hidden: true })).toHaveProperty(
      "pathname",
      href,
    );

    await user.click(screen.getByRole("button", { name: en("header.openMainMenu") }));
    await user.click(screen.getByRole("button", { name: en("header.tools") }));
    const drawer = document.querySelector<HTMLElement>("[data-tools-drawer]")!;
    const drawerGroup = within(drawer).getByRole("list", { name: groupName });
    expect(within(drawerGroup).getByRole("link", { name: "Test-only planner" })).toHaveProperty("pathname", href);
    expect(within(drawer).getByRole("link", { name: en("header.toolsMenu.seeAll") })).toHaveProperty(
      "pathname",
      toToolsHubPath("en"),
    );
  });

  it("names a tool by its title while its short name is missing, instead of failing the page", () => {
    added.entries = [{ key: "testUnnamedPlanner", routeId: "toolMortgage", group: "trackWealth", icon: Calculator }];
    render(<Header locale="en" />);

    const desktopGroup = within(panel("tools")).getByRole("list", {
      name: en("tools.hub.groups.trackWealth.title"),
      hidden: true,
    });
    expect(
      within(desktopGroup).getByRole("link", { name: "Test-only planner with no short name", hidden: true }),
    ).toHaveProperty("pathname", toLocalizedPath("toolMortgage", "en"));
  });

  it("has no Resources menu: its only link, the hub, moved into Tools", () => {
    render(<Header locale="en" />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      en("header.openMainMenu"),
      en("header.features"),
      en("header.tools"),
      en("header.comparators"),
    ]);
  });

  it.each(SUPPORTED_LANGS)("server-renders every %s tool link and the hub link, with the panel hidden", (lang) => {
    const html = renderToString(<Header locale={lang} />);
    const t = getTranslations(lang);

    const { columns, comparators } = buildHeaderToolMenus(lang);
    const menuTools = columns.flat().flatMap((group) => group.sections.flatMap((section) => section.tools));
    for (const tool of [...menuTools, ...comparators]) {
      expect(html).toContain(`href="${tool.href}"`);
      expect(html).toContain(`>${escapeHtml(t(`tools.${tool.key}.shortName`))}</span>`);
    }
    for (const routeId of FEATURE_ROUTE_IDS) expect(html).toContain(`href="${toLocalizedPath(routeId, lang)}"`);
    expect(html).toContain(`href="${toToolsHubPath(lang)}"`);
    for (const name of ["features", "tools", "comparators"]) {
      expect(html).toMatch(new RegExp(`id="header-menu-${name}"[^>]*hidden=""`));
      expect(html).toMatch(new RegExp(`aria-expanded="false" aria-controls="header-menu-${name}"`));
    }
  });
});

describe("Header features menu", () => {
  it("lists every feature page, one column per group, each with its icon, name and description", () => {
    render(<Header locale="en" />);
    const features = panel("features");
    const links = within(features).getAllByRole("link", { hidden: true });

    expect(links.map((link) => link.getAttribute("href")).sort()).toEqual(
      FEATURE_ROUTE_IDS.map((routeId) => toLocalizedPath(routeId, "en")).sort(),
    );
    for (const item of FEATURE_MENU) {
      const link = within(features).getByRole("link", { name: new RegExp(`^${en(`header.nav.${item.key}.name`)}`), hidden: true });
      expect(link.getAttribute("href")).toBe(toLocalizedPath(item.routeId, "en"));
      expect(link.textContent).toContain(en(`header.nav.${item.key}.description`));
      expect(link.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
    const columns = [...features.querySelectorAll<HTMLElement>("ul[data-features-group]")];
    expect(columns.map((column) => column.dataset.featuresGroup)).toEqual([...FEATURE_MENU_GROUPS]);
    expect(columns[0].parentElement!.className).toContain(`grid-cols-${FEATURE_MENU_GROUPS.length}`);
    for (const column of columns) {
      const hrefs = [...column.querySelectorAll("a")].map((link) => link.getAttribute("href"));
      expect(hrefs).toEqual(
        FEATURE_MENU.filter((item) => item.group === column.dataset.featuresGroup).map((item) =>
          toLocalizedPath(item.routeId, "en"),
        ),
      );
    }
  });

  it("carries every feature page into the mobile drawer", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);
    await user.click(screen.getByRole("button", { name: en("header.openMainMenu") }));
    await user.click(screen.getByRole("button", { name: en("header.features") }));

    const drawer = document.querySelector<HTMLElement>("[data-features-drawer]")!;
    expect(within(drawer).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      FEATURE_MENU.map((item) => toLocalizedPath(item.routeId, "en")),
    );
  });
});

describe("Header comparators menu", () => {
  it("lists every comparator with its icon and line, and the Tools menu leaves them out", () => {
    render(<Header locale="en" />);
    const { comparators } = buildHeaderToolMenus("en");
    const links = within(panel("comparators")).getAllByRole("link", { hidden: true });

    expect(comparators.map((tool) => tool.key)).toEqual([
      "electricityTariffComparison",
      "fuelPrices",
      "freeBankAccounts",
      "termDepositOffers",
      "remuneratedAccounts",
      "brokerFees",
      "pprComparison",
    ]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(comparators.map((tool) => tool.href));
    for (const [index, tool] of comparators.entries()) {
      expect(links[index].textContent).toBe(
        en(`tools.${tool.key}.shortName`) + en(`header.comparatorsMenu.items.${tool.key}`),
      );
      expect(links[index].querySelector("svg[aria-hidden='true']")).not.toBeNull();
    }
    const toolHrefs = within(panel("tools"))
      .getAllByRole("link", { hidden: true })
      .map((link) => link.getAttribute("href"));
    for (const tool of comparators) expect(toolHrefs).not.toContain(tool.href);
  });

  it("shows a comparator added to the catalog in its menu and drawer, not in Tools", async () => {
    added.entries = [
      { key: "testOnlyPlanner", routeId: "toolMortgage", group: "budgetAndSave", icon: Calculator, comparator: true },
    ];
    const user = userEvent.setup();
    render(<Header locale="en" />);

    expect(within(panel("comparators")).getByRole("link", { name: /^Test-only planner/, hidden: true })).toBeTruthy();
    expect(within(panel("tools")).queryByRole("link", { name: /Test-only planner/, hidden: true })).toBeNull();

    await user.click(screen.getByRole("button", { name: en("header.openMainMenu") }));
    await user.click(screen.getByRole("button", { name: en("header.comparators") }));
    const drawer = document.querySelector<HTMLElement>("[data-comparators-drawer]")!;
    expect(within(drawer).getByRole("link", { name: "Test-only planner" })).toHaveProperty(
      "pathname",
      toLocalizedPath("toolMortgage", "en"),
    );
    await user.click(screen.getByRole("button", { name: en("header.tools") }));
    const toolsDrawer = document.querySelector<HTMLElement>("[data-tools-drawer]")!;
    expect(within(toolsDrawer).queryByRole("link", { name: "Test-only planner" })).toBeNull();
  });

  it("opens on hover, switches with the other menus and closes with Escape, back to its trigger", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);

    trigger("comparators").focus();
    await user.keyboard("{ArrowDown}");
    expect(expanded("comparators")).toBe(true);
    expect(document.activeElement).toBe(within(panel("comparators")).getAllByRole("link")[0]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(within(panel("comparators")).getAllByRole("link").at(-1));
    await user.keyboard("{Escape}");
    expect(expanded("comparators")).toBe(false);
    expect(document.activeElement).toBe(trigger("comparators"));

    vi.useFakeTimers();
    fireEvent.pointerEnter(menuRoot("tools"), mouse);
    advance(HOVER_OPEN_DELAY_MS);
    expect(expanded("tools")).toBe(true);
    fireEvent.pointerLeave(menuRoot("tools"), mouse);
    fireEvent.pointerEnter(menuRoot("comparators"), mouse);
    expect(expanded("comparators")).toBe(true);
    expect(expanded("tools")).toBe(false);
    fireEvent.pointerLeave(menuRoot("comparators"), mouse);
    advance(HOVER_CLOSE_DELAY_MS);
    expect(expanded("comparators")).toBe(false);
  });
});

describe("Header menus on hover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("opens after the pointer rests on the trigger, and closes after it leaves", () => {
    render(<Header locale="en" />);

    fireEvent.pointerEnter(menuRoot("tools"), mouse);
    advance(HOVER_OPEN_DELAY_MS - 1);
    expect(expanded("tools")).toBe(false);
    advance(1);
    expect(expanded("tools")).toBe(true);
    expect(panel("tools").hidden).toBe(false);

    fireEvent.pointerLeave(menuRoot("tools"), mouse);
    advance(HOVER_CLOSE_DELAY_MS - 1);
    expect(expanded("tools")).toBe(true);
    advance(1);
    expect(expanded("tools")).toBe(false);
    expect(panel("tools").hidden).toBe(true);
  });

  it("opens nothing when the pointer only crosses the trigger", () => {
    render(<Header locale="en" />);

    fireEvent.pointerEnter(menuRoot("features"), mouse);
    advance(HOVER_OPEN_DELAY_MS / 2);
    fireEvent.pointerLeave(menuRoot("features"), mouse);
    advance(1_000);

    expect(expanded("features")).toBe(false);
  });

  it("stays open while the pointer moves from the trigger into the panel", () => {
    render(<Header locale="en" />);
    fireEvent.pointerEnter(menuRoot("tools"), mouse);
    advance(HOVER_OPEN_DELAY_MS);
    const firstLink = within(panel("tools")).getAllByRole("link")[0];

    // The panel sits inside the trigger's wrapper, so crossing from one to the other leaves
    // nothing; a pointer that overshoots and comes back within the close delay keeps it open.
    fireEvent.pointerLeave(menuRoot("tools"), mouse);
    advance(HOVER_CLOSE_DELAY_MS - 10);
    fireEvent.pointerEnter(firstLink, mouse);
    advance(1_000);
    expect(expanded("tools")).toBe(true);
  });

  it("keeps a panel open while focus is in it, wherever the mouse goes", () => {
    render(<Header locale="en" />);
    fireEvent.keyDown(trigger("tools"), { key: "ArrowDown" });
    const firstLink = within(panel("tools")).getAllByRole("link")[0];
    expect(document.activeElement).toBe(firstLink);

    fireEvent.pointerEnter(menuRoot("tools"), mouse);
    fireEvent.pointerLeave(menuRoot("tools"), mouse);
    advance(1_000);

    expect(expanded("tools")).toBe(true);
    expect(document.activeElement).toBe(firstLink);
  });

  it("hands focus to the new trigger when the mouse switches away from a focused panel", () => {
    render(<Header locale="en" />);
    fireEvent.keyDown(trigger("features"), { key: "ArrowDown" });
    expect(panel("features").contains(document.activeElement)).toBe(true);

    fireEvent.pointerEnter(menuRoot("tools"), mouse);

    expect(expanded("tools")).toBe(true);
    expect(expanded("features")).toBe(false);
    expect(document.activeElement).toBe(trigger("tools"));
  });

  it("leaves focus alone on a mouse switch when it wasn't in the old panel", () => {
    render(<Header locale="en" />);
    const faq = screen.getByRole("link", { name: en("header.faq") });
    act(() => faq.focus());
    fireEvent.pointerEnter(menuRoot("features"), mouse);
    advance(HOVER_OPEN_DELAY_MS);

    fireEvent.pointerEnter(menuRoot("tools"), mouse);

    expect(expanded("tools")).toBe(true);
    expect(document.activeElement).toBe(faq);
  });

  it("switches straight to another menu when one is open, keeping one open at a time", () => {
    render(<Header locale="en" />);
    fireEvent.pointerEnter(menuRoot("features"), mouse);
    advance(HOVER_OPEN_DELAY_MS);
    expect(expanded("features")).toBe(true);

    fireEvent.pointerLeave(menuRoot("features"), mouse);
    fireEvent.pointerEnter(menuRoot("tools"), mouse);

    expect(expanded("tools")).toBe(true);
    expect(expanded("features")).toBe(false);
  });

  it("keeps a menu the mouse just opened open when the trigger is then clicked", () => {
    render(<Header locale="en" />);
    fireEvent.pointerEnter(menuRoot("tools"), mouse);
    advance(HOVER_OPEN_DELAY_MS);

    fireEvent.pointerDown(trigger("tools"), mouse);
    fireEvent.click(trigger("tools"), { detail: 1 });
    expect(expanded("tools")).toBe(true);

    fireEvent.pointerDown(trigger("tools"), mouse);
    fireEvent.click(trigger("tools"), { detail: 1 });
    expect(expanded("tools")).toBe(false);
  });

  it("ignores hover from touch: a tap opens the menu and another tap closes it", () => {
    render(<Header locale="en" />);
    const touch = { pointerType: "touch" };

    fireEvent.pointerEnter(menuRoot("tools"), touch);
    advance(1_000);
    expect(expanded("tools")).toBe(false);

    fireEvent.pointerDown(trigger("tools"), touch);
    fireEvent.click(trigger("tools"), { detail: 1 });
    fireEvent.pointerLeave(menuRoot("tools"), touch);
    advance(1_000);
    expect(expanded("tools")).toBe(true);

    fireEvent.pointerDown(trigger("tools"), touch);
    fireEvent.click(trigger("tools"), { detail: 1 });
    expect(expanded("tools")).toBe(false);
  });

  it("closes on a click outside the menu", () => {
    render(<Header locale="en" />);
    fireEvent.pointerDown(trigger("tools"), { pointerType: "touch" });
    fireEvent.click(trigger("tools"), { detail: 1 });
    expect(expanded("tools")).toBe(true);

    fireEvent.pointerDown(document.body, mouse);
    expect(expanded("tools")).toBe(false);
  });
});

describe("Header menus from the keyboard", () => {
  it("reaches each trigger with Tab and wires aria-controls to its panel", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);

    const reached: Element[] = [];
    for (let i = 0; i < 5; i++) {
      await user.tab();
      reached.push(document.activeElement!);
    }

    expect(reached).toContain(trigger("features"));
    expect(reached).toContain(trigger("tools"));
    expect(reached).toContain(trigger("comparators"));
    for (const name of ["features", "tools", "comparators"] as const) {
      expect(trigger(name).getAttribute("aria-expanded")).toBe("false");
      expect(panel(name)).not.toBeNull();
      expect(panel(name).hidden).toBe(true);
    }
  });

  it("toggles with Enter and Space, and Escape closes it and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);
    trigger("tools").focus();

    await user.keyboard("{Enter}");
    expect(expanded("tools")).toBe(true);
    expect(document.activeElement).toBe(trigger("tools"));
    await user.keyboard(" ");
    expect(expanded("tools")).toBe(false);
    await user.keyboard(" ");
    expect(expanded("tools")).toBe(true);

    await user.tab();
    expect(panel("tools").contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(expanded("tools")).toBe(false);
    expect(document.activeElement).toBe(trigger("tools"));
  });

  it("opens on the first or last link with the arrow keys and moves through the links", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);
    trigger("tools").focus();

    await user.keyboard("{ArrowDown}");
    expect(expanded("tools")).toBe(true);
    const links = within(panel("tools")).getAllByRole("link");
    expect(document.activeElement).toBe(links[0]);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[1]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(links.at(-1));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(links[0]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(links.at(-1));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(links[0]);

    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger("tools"));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(within(panel("tools")).getAllByRole("link").at(-1));
  });

  it("closes when focus leaves the menu", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);
    trigger("features").focus();
    await user.keyboard("{Enter}");
    expect(expanded("features")).toBe(true);

    act(() => trigger("tools").focus());
    expect(expanded("features")).toBe(false);
  });
});

describe("Header tools menu analytics", () => {
  function grantAnalytics(analytics: boolean) {
    writeConsentDecision(window.localStorage, createConsentDecision({ analytics, ads: false }));
  }

  function navClicks() {
    return (window.dataLayer ?? []).filter(
      (entry) => (entry as { event?: string }).event === "nav_click",
    );
  }

  it("sends one nav_click with the hub's tool id, its group and the page type", async () => {
    grantAnalytics(true);
    const user = userEvent.setup();
    render(<Header locale="en" />);
    trigger("tools").focus();
    await user.keyboard("{Enter}");

    await user.click(within(panel("tools")).getByRole("link", { name: en("tools.compoundInterest.shortName") }));

    expect(navClicks()).toEqual([
      {
        event: "nav_click",
        tool: "compound_interest",
        group: "investAndGrow",
        nav_position: "header",
        nav_menu: "tools",
        page_type: "homepage",
      },
    ]);
  });

  it("names the Comparators menu in the event, from the panel and from the drawer", async () => {
    grantAnalytics(true);
    const user = userEvent.setup();
    render(<Header locale="en" />);
    trigger("comparators").focus();
    await user.keyboard("{Enter}");
    await user.click(
      within(panel("comparators")).getByRole("link", { name: new RegExp(`^${en("tools.brokerFees.shortName")}`) }),
    );

    await user.click(screen.getByRole("button", { name: en("header.openMainMenu") }));
    await user.click(screen.getByRole("button", { name: en("header.comparators") }));
    const drawer = document.querySelector<HTMLElement>("[data-comparators-drawer]")!;
    await user.click(within(drawer).getByRole("link", { name: en("tools.pprComparison.shortName") }));

    expect(navClicks()).toEqual([
      {
        event: "nav_click",
        tool: "broker_fees",
        group: "investAndGrow",
        nav_position: "header",
        nav_menu: "comparators",
        page_type: "homepage",
      },
      {
        event: "nav_click",
        tool: "ppr_comparison",
        group: "investAndGrow",
        nav_position: "drawer",
        nav_menu: "comparators",
        page_type: "homepage",
      },
    ]);
  });

  it("sends it from the mobile drawer too", async () => {
    grantAnalytics(true);
    const user = userEvent.setup();
    render(<Header locale="en" />);
    await user.click(screen.getByRole("button", { name: en("header.openMainMenu") }));
    await user.click(screen.getByRole("button", { name: en("header.tools") }));

    const drawer = document.querySelector<HTMLElement>("[data-tools-drawer]")!;
    await user.click(within(drawer).getByRole("link", { name: en("tools.fire.shortName") }));

    expect(navClicks()).toEqual([
      {
        event: "nav_click",
        tool: "fire",
        group: "investAndGrow",
        nav_position: "drawer",
        nav_menu: "tools",
        page_type: "homepage",
      },
    ]);
  });

  it("sends nothing without analytics consent, and nothing for the hub link", async () => {
    grantAnalytics(false);
    const user = userEvent.setup();
    render(<Header locale="en" />);
    trigger("tools").focus();
    await user.keyboard("{Enter}");
    await user.click(within(panel("tools")).getByRole("link", { name: en("tools.netWorth.shortName") }));
    expect(navClicks()).toEqual([]);

    grantAnalytics(true);
    trigger("tools").focus();
    await user.keyboard("{Enter}");
    await user.click(within(panel("tools")).getByRole("link", { name: en("header.toolsMenu.seeAll") }));
    expect(navClicks()).toEqual([]);
  });
});

describe("Header drawer stacking", () => {
  /**
   * The z-index an element stacks at against the rest of the page: that of its outermost
   * ancestor carrying a `z-*` class, the layer that starts its stacking context at the root.
   */
  function rootLayer(element: Element): number {
    let level: number | undefined;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const match = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(node.getAttribute("class") ?? "");
      if (match) level = Number(match[1]);
    }
    if (level === undefined) throw new Error("element has no z-index layer");
    return level;
  }

  it.each(SUPPORTED_LANGS)("keeps the drawer and banner controls usable in %s", async (locale) => {
    const user = userEvent.setup();
    const t = getTranslations(locale);
    render(
      <>
        <PivotAnnouncementBanner locale={locale} />
        <Header locale={locale} />
        <ConsentBanner locale={locale} />
        <StickyMobileCta locale={locale} />
      </>,
    );
    const dismissLabel = t("global.pivotBanner.dismissLabel");
    const dismiss = await screen.findByRole("button", { name: dismissLabel });
    const consent = screen.getByRole("complementary", { name: t("global.consent.title") });
    const stickyCta = screen.getByText(t("global.mainCtaMicrocopy"));

    await user.click(screen.getByRole("button", { name: t("header.openMainMenu") }));
    const close = screen.getByRole("button", { name: t("header.closeMenu") });
    const firstRow = screen.getByRole("button", { name: t("header.features") });

    const banner = rootLayer(dismiss);
    const header = rootLayer(document.querySelector("header")!);
    for (const control of [close, firstRow]) {
      expect(rootLayer(control)).toBeGreaterThan(header);
      expect(rootLayer(control)).toBeGreaterThan(banner);
      expect(rootLayer(control)).toBeGreaterThan(rootLayer(stickyCta));
      expect(rootLayer(control)).toBeLessThan(rootLayer(consent));
    }
    expect(header).toBeGreaterThan(banner);

    await user.click(firstRow);
    expect(firstRow.getAttribute("aria-expanded")).toBe("true");
    await user.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(dismiss);
    expect(screen.queryByRole("button", { name: dismissLabel })).toBeNull();
  });

  it("raises the drawer backdrop with its panel", async () => {
    const user = userEvent.setup();
    render(<Header locale="en" />);
    await user.click(screen.getByRole("button", { name: en("header.openMainMenu") }));

    const panel = screen.getByRole("button", { name: en("header.closeMenu") }).closest("[id^=headlessui-dialog-panel]")!;
    const backdrop = panel.previousElementSibling!;
    expect(rootLayer(backdrop)).toBe(rootLayer(panel));
    expect(rootLayer(backdrop)).toBeGreaterThan(rootLayer(document.querySelector("header")!));
  });
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;");
}

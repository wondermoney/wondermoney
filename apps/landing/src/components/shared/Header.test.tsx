// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createConsentDecision, writeConsentDecision } from "@/lib/consent";
import { SUPPORTED_LANGS, toLocalizedPath, toToolsHubPath } from "@/lib/routes";
import { TOOLS_CATALOG, buildToolsHub, type ToolCatalogEntry } from "@/lib/toolsCatalog";
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
    buildToolsHub: (lang: Parameters<typeof actual.buildToolsHub>[0]) =>
      actual.buildToolsHub(lang, [...actual.TOOLS_CATALOG, ...added.entries]),
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

function trigger(name: "features" | "tools") {
  return screen.getByRole("button", { name: en(`header.${name}`) });
}

/** The element hover is measured on: the trigger's wrapper, which also holds the panel. */
function menuRoot(name: "features" | "tools") {
  return trigger(name).parentElement!;
}

function panel(name: "features" | "tools") {
  return document.getElementById(trigger(name).getAttribute("aria-controls")!)!;
}

function expanded(name: "features" | "tools") {
  return trigger(name).getAttribute("aria-expanded") === "true";
}

const mouse = { pointerType: "mouse" };

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Header tools menu", () => {
  it("lists every catalog tool under its group, with its short name and link, after the hub link", () => {
    render(<Header locale="en" />);
    const tools = panel("tools");

    for (const group of buildToolsHub("en")) {
      const list = within(tools).getByRole("list", {
        name: en(`tools.hub.groups.${group.id}.title`),
        hidden: true,
      });
      const links = within(list).getAllByRole("link", { hidden: true });
      expect(links.map((link) => link.getAttribute("href"))).toEqual(group.tools.map((tool) => tool.href));
      expect(links.map((link) => link.textContent)).toEqual(
        group.tools.map((tool) => en(`tools.${tool.key}.shortName`)),
      );
    }
    const all = within(tools).getAllByRole("link", { hidden: true });
    // At the top, where the consent card fixed to the viewport's foot can't cover it.
    expect(all[0]).toHaveProperty("textContent", en("header.toolsMenu.seeAll"));
    expect(all[0].getAttribute("href")).toBe(toToolsHubPath("en"));
    expect(all).toHaveLength(TOOLS_CATALOG.length + 1);
  });

  it("shows a tool added to the catalog in the desktop menu and the mobile drawer", async () => {
    added.entries = [{ key: "testOnlyPlanner", routeId: "toolMortgage", group: "trackWealth" }];
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
    added.entries = [{ key: "testUnnamedPlanner", routeId: "toolMortgage", group: "trackWealth" }];
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
    ]);
  });

  it.each(SUPPORTED_LANGS)("server-renders every %s tool link and the hub link, with the panel hidden", (lang) => {
    const html = renderToString(<Header locale={lang} />);
    const t = getTranslations(lang);

    for (const tool of buildToolsHub(lang).flatMap((group) => group.tools)) {
      expect(html).toContain(`href="${tool.href}"`);
      expect(html).toContain(`>${escapeHtml(t(`tools.${tool.key}.shortName`))}</a>`);
    }
    expect(html).toContain(`href="${toToolsHubPath(lang)}"`);
    expect(html).toMatch(/id="header-menu-tools"[^>]*hidden=""/);
    expect(html).toMatch(/aria-expanded="false" aria-controls="header-menu-tools"/);
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
    for (let i = 0; i < 4; i++) {
      await user.tab();
      reached.push(document.activeElement!);
    }

    expect(reached).toContain(trigger("features"));
    expect(reached).toContain(trigger("tools"));
    for (const name of ["features", "tools"] as const) {
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
      { event: "nav_click", tool: "fire", group: "investAndGrow", nav_position: "drawer", page_type: "homepage" },
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

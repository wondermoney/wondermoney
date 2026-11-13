import {
  BarChart3,
  Briefcase,
  Building2,
  CandlestickChart,
  Home,
  Landmark,
  type LucideIcon,
  PieChart,
  ReceiptText,
  Target,
  Users,
} from "lucide-react";

/**
 * The product's destinations, in render order, for the sidebar and the mobile
 * section tabs. A section with `children` lists them under itself in the
 * sidebar, and as a tab row on mobile, while you are inside it.
 */
export type NavigationChild = {
  id: string;
  labelKey: string;
  href: string;
};

/**
 * The sidebar's groups, by what the person is doing rather than which API
 * serves it: money moving now, money invested, money planned for.
 */
export const NAVIGATION_GROUPS = [
  { id: "day-to-day", labelKey: "navigation.group-day-to-day" },
  { id: "investments", labelKey: "navigation.group-investments" },
  { id: "planning", labelKey: "navigation.group-planning" },
] as const;

export type NavigationGroupId = (typeof NAVIGATION_GROUPS)[number]["id"];

export type NavigationItem = {
  id: string;
  labelKey: string;
  href: string;
  icon: LucideIcon;
  /** The sidebar group it renders under; absent renders above the groups. */
  group?: NavigationGroupId;
  children?: NavigationChild[];
  /** Dropped when this server does not offer what the module needs. */
  requires?: "marketData";
  /** Dropped until the person turns preview features on (`<PreviewGate>`'s nav equivalent). */
  preview?: boolean;
};

export const NAVIGATION: NavigationItem[] = [
  { id: "home", labelKey: "navigation.home", href: "/", icon: Home },
  {
    id: "accounts",
    labelKey: "navigation.accounts",
    href: "/accounts",
    icon: Landmark,
    group: "day-to-day",
    children: [
      {
        id: "accounts.overview",
        labelKey: "navigation.overview",
        href: "/accounts",
      },
      {
        id: "accounts.transactions",
        labelKey: "navigation.transactions",
        href: "/accounts/transactions",
      },
      {
        id: "accounts.recurring",
        labelKey: "navigation.bills-subscriptions",
        href: "/accounts/recurring",
      },
    ],
  },
  {
    id: "loans",
    labelKey: "navigation.loans",
    href: "/loans",
    icon: ReceiptText,
    group: "day-to-day",
  },
  {
    id: "budgets",
    labelKey: "navigation.budgets",
    href: "/budgets",
    icon: PieChart,
    group: "day-to-day",
  },
  {
    id: "groups",
    labelKey: "navigation.groups",
    href: "/groups",
    icon: Users,
    group: "day-to-day",
  },
  {
    id: "portfolio",
    labelKey: "navigation.portfolio",
    href: "/portfolio",
    icon: Briefcase,
    group: "investments",
    children: [
      {
        id: "portfolio.overview",
        labelKey: "navigation.overview",
        href: "/portfolio",
      },
      {
        id: "portfolio.transactions",
        labelKey: "navigation.transactions",
        href: "/portfolio/transactions",
      },
    ],
  },
  {
    id: "assets",
    labelKey: "navigation.assets",
    href: "/assets",
    icon: Building2,
    group: "investments",
  },
  {
    id: "financial-markets",
    labelKey: "navigation.financial-markets",
    href: "/financial-markets",
    icon: CandlestickChart,
    group: "investments",
    requires: "marketData",
    children: [
      {
        id: "financial-markets.explorer",
        labelKey: "navigation.explorer",
        href: "/financial-markets/explorer",
      },
      {
        id: "financial-markets.watchlist",
        labelKey: "navigation.watchlist",
        href: "/financial-markets/watchlist",
      },
    ],
  },
  {
    id: "goals",
    labelKey: "navigation.goals",
    href: "/goals",
    icon: Target,
    group: "planning",
  },
  {
    id: "reports",
    labelKey: "navigation.reports",
    href: "/reports",
    icon: BarChart3,
    group: "planning",
  },
];

/** A destination is current on its own path and everything under it; Home only on `/`. */
export function isWithin(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The section whose tab row belongs on this path, if it has one. */
export function currentSection(
  items: NavigationItem[],
  pathname: string,
): NavigationItem | undefined {
  return items.find((item) => item.children && isWithin(pathname, item.href));
}

/** The one child tab that is current: the longest matching href wins. */
export function currentChild(
  section: NavigationItem,
  pathname: string,
): NavigationChild | undefined {
  return [...(section.children ?? [])]
    .filter((child) => isWithin(pathname, child.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

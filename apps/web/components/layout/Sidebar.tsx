"use client";

import { Avatar, AvatarFallback } from "@radix-ui/react-avatar";
import { useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  ChevronRight,
  ChevronUpIcon,
  FlaskConical,
  HelpCircleIcon,
  Home,
  Landmark,
  Lightbulb,
  LogOut,
  PieChart,
  ReceiptText,
  SettingsIcon,
  Target,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import AnimatedCollapsible from "@/components/layout/AnimatedCollapsible";
import { SidebarNavGroup } from "@/components/layout/SidebarNavGroup";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useFeature } from "@/lib/api/instance/useInstance";
import { authClient } from "@/lib/auth/client";
import { useUser } from "@/lib/auth/user-context";
import { instanceConfig } from "@/lib/instance";
import { cn } from "@/lib/utils";

import { Collapsible, CollapsibleTrigger } from "../ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Link } from "../ui/Link";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";
import { Text } from "../ui/Typography";
import Feedback from "./Feedback";
import Logo from "./Logo";

type NavigationItem = {
  id: string;
  name: string;
  href: string;
  icon?: any;
  /** Which labelled group this item renders under. Absent = ungrouped, top. */
  group?: string;
  open?: boolean;
  showChildren?: boolean;
  children?: Omit<NavigationItem, "children" | "icon">[];
};

/**
 * Eight top-level destinations in one flat list gave the rail no shape — the
 * eye had to read all eight to find one. They are grouped by what the person
 * is doing rather than by which API serves them: money moving now, money
 * invested, money planned for.
 *
 * The order is the render order. `navigation` below stays flat so the
 * disclosure state logic doesn't have to care about grouping.
 */
const NAVIGATION_GROUPS = [
  { id: "day-to-day", label: "navigation.group-day-to-day" },
  { id: "investments", label: "navigation.group-investments" },
  { id: "planning", label: "navigation.group-planning" },
] as const;

const navigation: NavigationItem[] = [
  { id: "home", name: "navigation.home", href: "/", icon: Home },
  {
    id: "accounts",
    name: "navigation.accounts",
    href: "/accounts",
    icon: Landmark,
    group: "day-to-day",
    open: false,
    showChildren: true,
    children: [
      {
        id: "accounts.overview",
        name: "navigation.overview",
        href: "/accounts",
      },
      {
        id: "accounts.transactions",
        name: "navigation.transactions",
        href: "/accounts/transactions",
      },
      {
        id: "accounts.recurring",
        name: "navigation.bills-subscriptions",
        href: "/accounts/recurring",
      },
    ],
  },
  {
    id: "loans",
    name: "navigation.loans",
    href: "/loans",
    icon: ReceiptText,
    group: "day-to-day",
  },
  {
    id: "budgets",
    name: "navigation.budgets",
    href: "/budgets",
    icon: PieChart,
    group: "day-to-day",
  },
  {
    id: "portfolio",
    name: "navigation.portfolio",
    href: "/portfolio",
    icon: Briefcase,
    group: "investments",
    open: false,
    showChildren: true,
    children: [
      {
        id: "portfolio.overview",
        name: "navigation.overview",
        href: "/portfolio",
      },
      {
        id: "portfolio.transactions",
        name: "navigation.transactions",
        href: "/portfolio/transactions",
      },
    ],
  },
  {
    id: "goals",
    name: "navigation.goals",
    href: "/goals",
    icon: Target,
    group: "planning",
  },
  {
    id: "financial-markets",
    name: "navigation.financial-markets",
    icon: BarChart3,
    href: "/financial-markets",
    group: "investments",
    open: false,
    showChildren: true,
    children: [
      {
        id: "financial-markets.explorer",
        name: "navigation.explorer",
        href: "/financial-markets/explorer",
      },
      {
        id: "financial-markets.watchlist",
        name: "navigation.watchlist",
        href: "/financial-markets/watchlist",
      },
    ],
  },
  {
    id: "reports",
    name: "navigation.reports",
    href: "/reports",
    icon: BookOpen,
    group: "planning",
  },
];

const userNavigation = [
  { name: "settings", href: "/settings", icon: SettingsIcon },
  {
    name: "whats-new",
    href: "https://wondermoney.canny.io/changelog",
    icon: Lightbulb,
  },
];

export default function Sidebar() {
  const shouldReduceMotion = useReducedMotion();
  const posthog = usePostHog();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations();
  const queryClient = useQueryClient();

  const user = useUser();
  const userInitials = user?.email?.split("@")[0].slice(0, 2).toUpperCase();
  const userTrimmedEmail = user?.email?.split("@")[0];
  const marketDataAvailable = useFeature((features) => features.marketData);

  const [navigationState, setNavigationState] = useState(() => {
    return navigation.map((item) => {
      if (pathname.startsWith(item.href) && item.children) {
        return { ...item, open: true };
      }
      return item;
    });
  });

  // Every module is available to every account. The only thing that drops one
  // from the rail is this server not offering what it needs (`/v1/instance`).
  const visibleNavigationState = navigationState.filter(
    (item) => item.id !== "financial-markets" || marketDataAvailable,
  );

  const handleDisclosureToggle = (itemId: string) => {
    setNavigationState((state) =>
      state.map((item) => {
        if (item.id === itemId) {
          return { ...item, open: !item.open };
        }
        return item;
      }),
    );
  };

  const isItemCurrent = (href: string) =>
    href === "/" ? pathname === href : pathname.startsWith(href);

  /**
   * Active and hover were both `bg-accent`, on a shell painted `bg-muted` — and
   * those two tokens are byte-identical in both halves. The current-page marker
   * therefore measured 1.00:1 and was invisible; the rail never told you where
   * you were.
   *
   * The tint is /5, not /10. The rail sits on `bg-muted`, not on the canvas,
   * and in the dark half `--primary` is the *light* end of the ramp — so a
   * 10% wash of it lightens the row toward its own text and lands on 4.42:1,
   * measured in-browser. At /5 it is 5.99:1 light and 4.81:1 dark. The 2px
   * left rule is the load-bearing cue; the wash is support.
   *
   * Active is brand violet (the ratio DESIGN.md
   * §2 already assigns to active navigation) plus that rule, so the state does
   * not rest on colour alone. Hover is a neutral wash rather than a
   * surface token, because `--background` and `--muted` are only 1.04:1 apart —
   * any hover built from those two would be just as invisible as what it
   * replaces.
   */
  const navRowClass = (current: boolean, filled: boolean) =>
    cn(
      "group relative flex w-full items-center gap-x-2 rounded-md p-2 text-left text-sm leading-6 font-semibold",
      "transition-colors duration-[var(--duration-micro)] ease-out",
      "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:content-['']",
      current
        ? cn("text-primary before:bg-primary", filled && "bg-primary/5")
        : "text-foreground hover:bg-foreground/5 before:bg-transparent",
    );

  const navSubRowClass = (current: boolean) =>
    cn(
      "relative block rounded-md py-2 pr-2 pl-9 text-sm leading-6",
      "transition-colors duration-[var(--duration-micro)] ease-out",
      "before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:content-['']",
      current
        ? "bg-primary/5 text-primary font-medium before:bg-primary"
        : "text-muted-foreground hover:text-foreground hover:bg-foreground/5 before:bg-transparent",
    );

  const collapseAll = () =>
    setNavigationState((state) =>
      state.map((navItem) => ({ ...navItem, open: false })),
    );

  const renderNavigationItem = (item: NavigationItem) => {
    const isCurrent = isItemCurrent(item.href);

    if (!item.children) {
      return (
        <li key={item.id}>
          <Link
            href={item.href}
            aria-current={isCurrent ? "page" : undefined}
            className={navRowClass(isCurrent, true)}
            onClick={collapseAll}
          >
            <item.icon
              className="size-5 shrink-0"
              aria-hidden="true"
              strokeWidth={2}
            />
            {t(item.name)}
          </Link>
        </li>
      );
    }

    // The fill marks the *page*; a section parent gets colour and the rule but
    // no fill, so an expanded section and its open child don't both shout.
    // The trigger does not require `isCurrent && item.open`, or a collapsed
    // section would look inactive while you were standing in it.
    return (
      <li key={item.id}>
        <Collapsible
          open={!!item.open}
          onOpenChange={() => handleDisclosureToggle(item.id)}
          defaultOpen={item.open}
        >
          <CollapsibleTrigger className={navRowClass(isCurrent, false)}>
            <item.icon
              className="size-5 shrink-0"
              aria-hidden="true"
              strokeWidth={2}
            />
            {t(item.name)}
            <motion.div
              initial={false}
              animate={{ rotate: item.open ? 90 : 0 }}
              transition={
                shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.2, ease: [0.65, 0, 0.35, 1] }
              }
              className="ml-auto"
            >
              <ChevronRight className="size-5 opacity-60" aria-hidden="true" />
            </motion.div>
          </CollapsibleTrigger>
          <AnimatedCollapsible open={!!item.open} className="mt-1">
            <ul role="list" className="space-y-1">
              {item.children.map((subItem) => {
                const isSubCurrent = subItem.href === pathname;
                return (
                  <li key={subItem.id}>
                    <Link
                      href={subItem.href}
                      aria-current={isSubCurrent ? "page" : undefined}
                      className={navSubRowClass(isSubCurrent)}
                      onClick={() => {
                        setNavigationState((state) => {
                          if (
                            item.children?.some(
                              (child) => child.id === subItem.id,
                            )
                          ) {
                            return state.map((navItem) => ({
                              ...navItem,
                              open: navItem.id === item.id,
                            }));
                          }
                          return state.map((navItem) => ({
                            ...navItem,
                            open: false,
                          }));
                        });
                      }}
                    >
                      {t(subItem.name)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </AnimatedCollapsible>
        </Collapsible>
      </li>
    );
  };

  const onLogoutClickHandler = async () => {
    await queryClient.cancelQueries();
    queryClient.removeQueries();
    await authClient.signOut().catch((signOutError) => {
      console.error("Error logging out", signOutError);
    });
    posthog.reset();
    router.push("/auth/login");
  };

  return (
    <>
      <aside className="hidden lg:relative lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-3 lg:block">
        {/* Static sidebar for desktop */}
        {/* Sticky in its own column, not fixed to the viewport: a fixed sidebar
            started at the very top and slid over anything above the layout
            (the hosted pivot banner ran under the logo). The absolute wrapper
            keeps its full-viewport height out of the grid's row sizing. */}
        <div className="lg:absolute lg:inset-0">
          <div className="hidden lg:sticky lg:top-0 lg:z-50 lg:flex lg:h-dvh lg:w-56 lg:flex-col">
            <nav
              aria-label={t("navigation.sidebar-nav")}
              className="flex h-full flex-col overflow-y-auto p-4 pr-2"
            >
              <div className="flex items-center justify-center">
                <Logo />
              </div>
              <Separator orientation="horizontal" className="my-2" />
              <ul role="list" className="flex flex-1 flex-col">
                <li>
                  <ul role="list" className="space-y-1">
                    {visibleNavigationState
                      .filter((item) => !item.group)
                      .map(renderNavigationItem)}
                  </ul>
                  {/* Group labels are navigation structure, not document
                    structure — see SidebarNavGroup for why they do not
                    carry a heading level. */}
                  {NAVIGATION_GROUPS.map((group) => {
                    const items = visibleNavigationState.filter(
                      (item) => item.group === group.id,
                    );
                    if (items.length === 0) return null;
                    return (
                      <SidebarNavGroup
                        key={group.id}
                        id={group.id}
                        label={t(group.label)}
                      >
                        {items.map(renderNavigationItem)}
                      </SidebarNavGroup>
                    );
                  })}
                </li>
                <li className="mt-auto pt-6">
                  <ul className="space-y-2">
                    <li>
                      <Feedback />
                    </li>
                    {instanceConfig.demoEmail !== null &&
                      user?.email === instanceConfig.demoEmail && (
                        <li>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                {/* /5 not /10 — same reason as the nav rows: this sits on the bg-muted
                                rail, and a 10% wash of the dark half's light --primary
                                lightens the chip toward its own text. */}
                                <div className="bg-primary/5 flex items-center justify-center gap-2 rounded py-2">
                                  <FlaskConical className="text-primary size-5" />
                                  <Text className="text-primary">
                                    {t("demo-mode")}
                                  </Text>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{t("demo-mode-restricted")}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </li>
                      )}
                    <li>
                      <Link
                        href={instanceConfig.docsUrl}
                        className="text-foreground hover:bg-foreground/5 group flex items-center gap-x-2 rounded-md p-2 text-sm leading-6 font-semibold transition-colors duration-[var(--duration-micro)] ease-out"
                      >
                        <HelpCircleIcon
                          className="text-foreground size-5 shrink-0"
                          aria-hidden="true"
                          strokeWidth={2}
                        />
                        {t("help")}
                      </Link>
                    </li>
                    <Separator orientation="horizontal" className="my-2" />
                    <li>
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex w-full items-center">
                          <span className="sr-only">{t("open-user-menu")}</span>
                          <Avatar>
                            <AvatarFallback>{userInitials}</AvatarFallback>
                          </Avatar>
                          <span className="hidden w-full items-center justify-between lg:flex">
                            <span className="ml-4 flex min-w-0 flex-col">
                              <span
                                className="text-foreground truncate text-xs leading-6 font-semibold"
                                aria-hidden="true"
                              >
                                {userTrimmedEmail ?? (
                                  <Skeleton className="h-5 w-30 rounded-full" />
                                )}
                              </span>
                            </span>
                            <ChevronUpIcon
                              className="text-muted-foreground ml-2 size-5"
                              aria-hidden="true"
                            />
                          </span>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {userNavigation.map((item) => (
                            <DropdownMenuItem key={item.name}>
                              <item.icon
                                className="text-foreground mr-3 size-4"
                                aria-hidden="true"
                                strokeWidth={1}
                              />
                              <Link href={item.href}>{t(item.name)}</Link>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            key="logout"
                            onClick={onLogoutClickHandler}
                          >
                            <LogOut
                              className="text-foreground mr-3 size-4"
                              strokeWidth={1}
                            />
                            {t("logout")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                    <li>
                      <Text variant="mutedText" className="text-right text-xs">
                        v{process.env.PKG_VERSION}
                      </Text>
                    </li>
                  </ul>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </aside>
    </>
  );
}

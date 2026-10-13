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
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import { useState } from "react";

import AdminModuleVisibilityDialog from "@/components/admin/AdminModuleVisibilityDialog";
import AnimatedCollapsible from "@/components/layout/AnimatedCollapsible";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { AdminModuleId } from "@/lib/admin/module-visibility";
import { useAdminModuleVisibility } from "@/lib/admin/useAdminModuleVisibility";
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
  open?: boolean;
  showChildren?: boolean;
  children?: Omit<NavigationItem, "children" | "icon">[];
};

const navigation: NavigationItem[] = [
  { id: "home", name: "navigation.home", href: "/", icon: Home },
  {
    id: "accounts",
    name: "navigation.accounts",
    href: "/accounts",
    icon: Landmark,
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
    id: "credits",
    name: "navigation.credits",
    href: "/credits",
    icon: ReceiptText,
  },
  {
    id: "budgets",
    name: "navigation.budgets",
    href: "/budgets",
    icon: PieChart,
  },
  {
    id: "portfolio",
    name: "navigation.portfolio",
    href: "/portfolio",
    icon: Briefcase,
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
  },
  {
    id: "financial-markets",
    name: "navigation.financial-markets",
    icon: BarChart3,
    href: "/financial-markets",
    open: false,
    showChildren: true,
    children: [
      {
        id: "financial-markets.explorer",
        name: "navigation.explorer",
        href: "/financial-markets/explorer",
      },
      {
        id: "financial-markets.screener",
        name: "navigation.screener",
        href: "/financial-markets/screener",
      },
      {
        id: "financial-markets.news",
        name: "navigation.news",
        href: "/financial-markets/news",
      },
    ],
  },
  {
    id: "reports",
    name: "navigation.reports",
    href: "/reports",
    icon: BookOpen,
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

const adminNavigationModuleByItemId: Partial<Record<string, AdminModuleId>> = {
  credits: "credits",
  goals: "goals",
  "financial-markets": "financialMarkets",
};

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
  const {
    isAdmin,
    visibility,
    isModuleVisible,
    setModuleVisible,
    showAllAdminModules,
    viewAsRegularUser,
  } = useAdminModuleVisibility(user?.email, user?.email_confirmed_at);

  const [adminVisibilityOpen, setAdminVisibilityOpen] = useState(false);

  const [navigationState, setNavigationState] = useState(() => {
    return navigation.map((item) => {
      if (pathname.startsWith(item.href) && item.children) {
        return { ...item, open: true };
      }
      return item;
    });
  });

  const filteredNavigationState = navigationState
    .filter((item) => {
      const moduleId = adminNavigationModuleByItemId[item.id];
      return !moduleId || isModuleVisible(moduleId);
    })
    .map((item) => {
      if (item.id !== "accounts" || isModuleVisible("recurring")) {
        return item;
      }

      return {
        ...item,
        children: item.children?.filter(
          (child) => child.id !== "accounts.recurring",
        ),
      };
    });

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
      <aside className="hidden lg:col-start-1 lg:col-end-2 lg:row-start-1 lg:row-end-2 lg:block">
        {/* Static sidebar for desktop */}
        <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-56 lg:flex-col">
          <nav className="flex h-full flex-col overflow-y-auto p-4 pr-2">
            <div className="flex items-center justify-center">
              <Logo />
            </div>
            <Separator orientation="horizontal" className="my-2" />
            <ul role="list" className="flex flex-1 flex-col justify-between">
              <li>
                <ul role="list" className="space-y-1">
                  {filteredNavigationState.map((item) => {
                    const isCurrent =
                      item.href === "/"
                        ? item.href === pathname
                        : pathname.startsWith(item.href);
                    return (
                      <li key={item.name}>
                        {!item.children ? (
                          <Link
                            href={item.href}
                            className={cn(
                              isCurrent ? "bg-accent" : "hover:bg-accent",
                              "text-foreground group flex items-center gap-x-2 rounded-md p-2 text-sm leading-6 font-semibold",
                            )}
                            onClick={() => {
                              setNavigationState((state) =>
                                state.map((navItem) => ({
                                  ...navItem,
                                  open: false,
                                })),
                              );
                            }}
                          >
                            <item.icon
                              className="text-foreground size-5 shrink-0"
                              aria-hidden="true"
                              strokeWidth={2}
                            />
                            {t(item.name)}
                          </Link>
                        ) : (
                          <Collapsible
                            open={!!item.open}
                            onOpenChange={() => handleDisclosureToggle(item.id)}
                            defaultOpen={item.open}
                          >
                            <CollapsibleTrigger
                              className={cn(
                                isCurrent && item.open
                                  ? "bg-accent"
                                  : "hover:bg-accent",
                                "text-foreground flex w-full items-center gap-x-2 rounded-md p-2 text-left text-sm leading-6 font-semibold",
                              )}
                            >
                              <item.icon
                                className="text-foreground size-5 shrink-0"
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
                                    : { duration: 0.2, ease: "easeInOut" }
                                }
                                className="ml-auto"
                              >
                                <ChevronRight
                                  className="text-muted-foreground size-5"
                                  aria-hidden="true"
                                />
                              </motion.div>
                            </CollapsibleTrigger>
                            <AnimatedCollapsible
                              open={!!item.open}
                              className="mt-1 pl-2"
                            >
                              <ul>
                                {item.children.map((subItem) => {
                                  const isSubCurrent =
                                    subItem.href === pathname;
                                  return (
                                    <li key={subItem.name}>
                                      {/* 44px */}
                                      <Link
                                        href={subItem.href}
                                        className={cn(
                                          isSubCurrent
                                            ? "bg-accent"
                                            : "hover:bg-accent",
                                          "text-foreground block rounded-md py-2 pr-2 pl-9 text-sm leading-6",
                                        )}
                                        onClick={() => {
                                          setNavigationState((state) => {
                                            if (
                                              item.children?.some(
                                                (child) =>
                                                  child.id === subItem.id,
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
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
              <li>
                <ul className="space-y-2">
                  <li>
                    <Feedback />
                  </li>
                  {isAdmin && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setAdminVisibilityOpen(true)}
                        className="text-foreground hover:bg-accent group flex w-full items-center gap-x-2 rounded-md p-2 text-sm leading-6 font-semibold"
                      >
                        <SlidersHorizontal
                          className="text-foreground size-5 shrink-0"
                          aria-hidden="true"
                          strokeWidth={2}
                        />
                        {t("navigation.admin-visibility")}
                      </button>
                    </li>
                  )}
                  {instanceConfig.demoEmail !== null && user?.email === instanceConfig.demoEmail && (
                    <li>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center justify-center gap-2 rounded bg-violet-100 py-2 shadow-xs dark:bg-violet-950/50">
                              <FlaskConical className="size-5 text-violet-700 dark:text-violet-300" />
                              <Text className="text-violet-700 dark:text-violet-300">
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
                      className="text-foreground hover:bg-accent group flex items-center gap-x-2 rounded-md p-2 text-sm leading-6 font-semibold"
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
                        <span className="sr-only">Open user menu</span>
                        <Avatar>
                          <AvatarFallback>{userInitials}</AvatarFallback>
                        </Avatar>
                        <span className="hidden w-full justify-between lg:flex lg:items-center">
                          <span
                            className="text-foreground ml-4 truncate text-xs leading-6 font-semibold"
                            aria-hidden="true"
                          >
                            {userTrimmedEmail ?? (
                              <Skeleton className="h-5 w-30 rounded-full" />
                            )}
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
      </aside>
      <AdminModuleVisibilityDialog
        open={adminVisibilityOpen}
        onOpenChange={setAdminVisibilityOpen}
        visibility={visibility}
        setModuleVisible={setModuleVisible}
        showAllAdminModules={showAllAdminModules}
        viewAsRegularUser={viewAsRegularUser}
      />
    </>
  );
}

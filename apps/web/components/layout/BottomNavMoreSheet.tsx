"use client";

import {
  BarChart3,
  BookOpen,
  Building2,
  CalendarClock,
  FlaskConical,
  HandCoins,
  HelpCircleIcon,
  Landmark,
  Lightbulb,
  LogOut,
  ReceiptText,
  SettingsIcon,
  Target,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useFeature } from "@/lib/api/instance/useInstance";
import { useIsDemoProfile } from "@/lib/api/user/useProfile";
import { useUser } from "@/lib/auth/user-context";
import { useSignOut } from "@/lib/auth/useSignOut";
import { instanceConfig } from "@/lib/instance";
import { cn } from "@/lib/utils";

import { Link } from "../ui/Link";
import { Separator } from "../ui/separator";
import { Text } from "../ui/Typography";
import Feedback from "./Feedback";
import { mobileMoreAccountsItems } from "./mobile-more-nav-items";
import VersionInfo from "./VersionInfo";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function BottomNavMoreSheet({ open, onOpenChange }: Props) {
  const t = useTranslations();
  const user = useUser();
  const signOut = useSignOut();
  const isDemo =
    useIsDemoProfile({ fetch: false }) ||
    (instanceConfig.demoEmail !== null &&
      user?.email === instanceConfig.demoEmail);
  const marketDataAvailable = useFeature((features) => features.marketData);

  const userInitials = user?.email?.split("@")[0].slice(0, 2).toUpperCase();
  const userTrimmedEmail = user?.email?.split("@")[0];
  const close = () => onOpenChange(false);

  const onLogoutClickHandler = () => {
    close();
    return signOut("/auth/login");
  };

  const itemClass =
    "text-foreground hover:bg-accent flex w-full items-center gap-3 px-6 py-3 text-sm";
  const accountItemIcons = {
    "accounts.overview": Landmark,
    "accounts.transactions": ReceiptText,
    "accounts.recurring": CalendarClock,
  } as const;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto px-0 pb-0"
        data-testid="more-sheet"
      >
        <SheetTitle className="sr-only">{t("more")}</SheetTitle>

        {/* User header */}
        <div className="flex items-center gap-3 px-6 py-4">
          <Avatar>
            <AvatarFallback className="bg-muted text-foreground text-sm font-semibold">
              {userInitials}
            </AvatarFallback>
          </Avatar>
          <span className="text-foreground truncate text-sm font-semibold">
            {userTrimmedEmail}
          </span>
        </div>

        <Separator />

        <ul className="py-2" aria-label={t("navigation.accounts")}>
          {mobileMoreAccountsItems.map((item) => {
            const Icon = accountItemIcons[item.id];
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  onClick={close}
                  className={itemClass}
                  data-testid={`more-sheet-${item.id}`}
                >
                  <Icon className="size-5 shrink-0" strokeWidth={1.5} />
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>

        <Separator />

        {/* Primary secondary items */}
        <ul className="py-2">
          <li>
            <Link href="/settings" onClick={close} className={itemClass}>
              <SettingsIcon className="size-5 shrink-0" strokeWidth={1.5} />
              {t("settings")}
            </Link>
          </li>
          <li>
            <Link
              href={instanceConfig.docsUrl}
              onClick={close}
              className={itemClass}
            >
              <HelpCircleIcon className="size-5 shrink-0" strokeWidth={1.5} />
              {t("help")}
            </Link>
          </li>
          <li className="px-6 py-3">
            {/* Feedback opens its own DrawerDialog overlay — intentionally does not close the More sheet */}
            <Feedback />
          </li>
          <li>
            <Link
              href="https://wondermoney.canny.io/changelog"
              onClick={close}
              className={itemClass}
            >
              <Lightbulb className="size-5 shrink-0" strokeWidth={1.5} />
              {t("whats-new")}
            </Link>
          </li>
        </ul>

        {/* Hidden only when this server has no market-data provider */}
        {marketDataAvailable && (
          <>
            <Separator />
            <ul className="py-2">
              <li>
                <Link
                  href="/financial-markets"
                  onClick={close}
                  className={itemClass}
                >
                  <BarChart3 className="size-5 shrink-0" strokeWidth={1.5} />
                  {t("navigation.financial-markets")}
                </Link>
              </li>
            </ul>
          </>
        )}

        <Separator />
        <ul className="py-2">
          <li>
            <Link
              href="/loans"
              onClick={close}
              className={itemClass}
              data-testid="more-sheet-loans"
            >
              <HandCoins className="size-5 shrink-0" strokeWidth={1.5} />
              {t("navigation.loans")}
            </Link>
          </li>
          <li>
            <Link href="/groups" onClick={close} className={itemClass}>
              <Users className="size-5 shrink-0" strokeWidth={1.5} />
              {t("navigation.groups")}
            </Link>
          </li>
          <li>
            <Link href="/assets" onClick={close} className={itemClass}>
              <Building2 className="size-5 shrink-0" strokeWidth={1.5} />
              {t("navigation.assets")}
            </Link>
          </li>
          <li>
            <Link href="/goals" onClick={close} className={itemClass}>
              <Target className="size-5 shrink-0" strokeWidth={1.5} />
              {t("navigation.goals")}
            </Link>
          </li>
          <li>
            <Link href="/reports" onClick={close} className={itemClass}>
              <BookOpen className="size-5 shrink-0" strokeWidth={1.5} />
              {t("navigation.reports")}
            </Link>
          </li>
        </ul>

        {/* Demo mode badge */}
        {isDemo && (
          <>
            <Separator />
            <div className="bg-primary/10 mx-6 my-3 flex items-center justify-center gap-2 rounded py-2">
              <FlaskConical className="text-primary size-5" />
              <Text className="text-primary">{t("demo-mode")}</Text>
            </div>
          </>
        )}

        <Separator />

        {/* Logout + version */}
        <ul
          className="py-2"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)",
          }}
        >
          <li>
            <button
              onClick={onLogoutClickHandler}
              className={cn(itemClass, "text-left")}
              data-testid="more-sheet-logout"
            >
              <LogOut className="size-5 shrink-0" strokeWidth={1.5} />
              {t("logout")}
            </button>
          </li>
          <li className="px-6 py-1">
            <VersionInfo />
          </li>
        </ul>
      </SheetContent>
    </Sheet>
  );
}

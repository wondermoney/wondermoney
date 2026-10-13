"use client";

import { CreditCard, LineChart, PiggyBank, TrendingUp, Wallet } from "lucide-react";
import { useTranslations } from "next-intl";

import { instanceConfig } from "@/lib/instance";
import { cn } from "@/lib/utils";

import FirstRunIconTile, { type FirstRunIconTone } from "./FirstRunIconTile";

/**
 * Decorative, mock-data dashboard preview shown alongside the onboarding copy.
 * It is intentionally non-interactive and reads its strings from the existing
 * `onboarding.firstRun.preview.*` i18n namespace. Hand-rolled SVG (not Recharts)
 * keeps this lightweight — it is an aspirational preview, not a live chart.
 */
type Variant = "netWorth" | "accounts";

const DONUT = [
  { key: "housing", pct: 34, dot: "bg-primary", stroke: "text-primary" },
  { key: "food", pct: 22, dot: "bg-blue-500", stroke: "text-blue-500" },
  { key: "transport", pct: 14, dot: "bg-amber-500", stroke: "text-amber-500" },
  { key: "other", pct: 30, dot: "bg-muted-foreground/40", stroke: "text-muted-foreground/40" },
] as const;

export default function FirstRunProductWindow({
  variant = "netWorth",
  className,
}: {
  variant?: Variant;
  className?: string;
}) {
  const t = useTranslations("onboarding.firstRun.preview");

  return (
    <div
      className={cn(
        "border-border bg-card w-full overflow-hidden rounded-2xl border shadow-sm",
        className,
      )}
      aria-hidden
    >
      <div className="border-border/70 flex items-center gap-2 border-b px-4 py-2.5">
        <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
        <span className="bg-muted-foreground/25 size-2.5 rounded-full" />
        <span className="text-muted-foreground ml-2 font-mono text-xs">
          {instanceConfig.appHost} / dashboard
        </span>
      </div>

      {variant === "netWorth" ? (
        <NetWorthBody t={t} />
      ) : (
        <AccountsBody t={t} />
      )}
    </div>
  );
}

function NetWorthBody({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="space-y-5 p-5">
      <div>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("welcome.netWorthLabel")}
        </p>
        <div className="mt-1 flex items-end justify-between">
          <span className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
            {t("welcome.netWorthValue")}
          </span>
          <span className="flex items-center gap-1 text-sm font-medium text-emerald-500 dark:text-emerald-400">
            <TrendingUp className="size-4" />
            {t("common.deltaValue")}
          </span>
        </div>
      </div>

      <Sparkline />

      <div className="grid grid-cols-2 gap-3">
        <MiniAccount
          icon={Wallet}
          tone="violet"
          label={t("account.currentAccountLabel")}
          value={t("account.currentAccountValue")}
        />
        <MiniAccount
          icon={PiggyBank}
          tone="sky"
          label={t("account.savingsLabel")}
          value={t("account.savingsValue")}
        />
      </div>

      <div className="border-border bg-muted/30 flex items-center gap-4 rounded-xl border p-4">
        <Donut center={t("welcome.budgetValue")} />
        <ul className="min-w-0 flex-1 space-y-1.5">
          {DONUT.map((seg) => (
            <li key={seg.key} className="flex items-center gap-2 text-xs">
              <span className={cn("size-2 rounded-full", seg.dot)} />
              <span className="text-muted-foreground flex-1 truncate">
                {t(`common.categories.${seg.key}`)}
              </span>
              <span className="font-mono font-medium tabular-nums">{seg.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AccountsBody({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t("account.sectionLabel")}
          </p>
          <span className="mt-1 block font-mono text-3xl font-semibold tracking-tight tabular-nums">
            {t("account.totalValue")}
          </span>
        </div>
        <span className="text-muted-foreground text-xs">{t("account.totalLabel")}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <MiniAccount
          icon={Wallet}
          tone="violet"
          label={t("account.currentAccountLabel")}
          value={t("account.currentAccountValue")}
        />
        <MiniAccount
          icon={PiggyBank}
          tone="sky"
          label={t("account.savingsLabel")}
          value={t("account.savingsValue")}
        />
        <MiniAccount
          icon={CreditCard}
          tone="rose"
          label={t("account.creditCardLabel")}
          value={t("account.creditCardValue")}
          negative
        />
        <MiniAccount
          icon={LineChart}
          tone="green"
          label={t("common.portfolioLabel")}
          value={t("common.portfolioValue")}
        />
      </div>
    </div>
  );
}

function MiniAccount({
  icon,
  tone,
  label,
  value,
  negative,
}: {
  icon: React.ComponentProps<typeof FirstRunIconTile>["icon"];
  tone: FirstRunIconTone;
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="border-border bg-background flex items-center gap-3 rounded-xl border p-3">
      <FirstRunIconTile icon={icon} tone={tone} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground truncate text-xs">{label}</p>
        <p
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            negative && "text-rose-500 dark:text-rose-400",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function Sparkline() {
  return (
    <svg
      viewBox="0 0 300 80"
      preserveAspectRatio="none"
      className="h-16 w-full text-emerald-500 dark:text-emerald-400"
    >
      <defs>
        <linearGradient id="fr-spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0,60 L30,52 L60,56 L90,44 L120,48 L150,36 L180,40 L210,28 L240,32 L270,18 L300,10 L300,80 L0,80 Z"
        fill="url(#fr-spark)"
      />
      <path
        d="M0,60 L30,52 L60,56 L90,44 L120,48 L150,36 L180,40 L210,28 L240,32 L270,18 L300,10"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Donut({ center }: { center: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="relative size-[76px] shrink-0">
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          className="text-muted/60"
          stroke="currentColor"
          strokeWidth="10"
        />
        {DONUT.map((seg) => {
          const len = (seg.pct / 100) * c;
          const el = (
            <circle
              key={seg.key}
              cx="40"
              cy="40"
              r={r}
              fill="none"
              className={seg.stroke}
              stroke="currentColor"
              strokeWidth="10"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-semibold tabular-nums">
        {center}
      </span>
    </div>
  );
}

"use client";

import {
  Briefcase,
  Eye,
  EyeOff,
  Landmark,
  type LucideIcon,
  Moon,
  PieChart,
  Plus,
  ReceiptText,
  SettingsIcon,
  Sun,
  Target,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import AccountAddModal from "@/components/account/AccountCreateModal";
import AccountAddOfflineModal from "@/components/account/AccountCreateOfflineModal";
import AccountAddSyncModal from "@/components/account/AccountCreateSyncModal";
import AccountTransactionAddModal from "@/components/account/AccountTransactionAddModal";
import AccountTransactionImportModal from "@/components/account/AccountTransactionImportModal";
import GoalCreateDialog from "@/components/goals/GoalCreateDialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useRouter } from "@/i18n/navigation";
import { writableAccounts } from "@/lib/account/account-access";
import useAccounts from "@/lib/api/account/useAccounts";
import useBudgetsFull from "@/lib/api/budget/useBudgetsFull";
import useGoals from "@/lib/api/goals/useGoals";
import { useFeature } from "@/lib/api/instance/useInstance";
import useLoans from "@/lib/api/loan/useLoans";
import usePortfolios from "@/lib/api/portfolio/usePortfolios";
import { usePrivacyMode } from "@/lib/privacy/usePrivacyMode";
import { useHydrated } from "@/lib/utils/useHydrated";

import {
  closeCommandPalette,
  getCommandPaletteTrigger,
  toggleCommandPalette,
  useCommandPaletteOpen,
} from "./command-palette-store";
import { useVisibleNavigation } from "./useVisibleNavigation";

/**
 * Typing in a field must not have the hotkey stolen: text inputs, textareas,
 * selects and contenteditable capture Cmd/Ctrl+K first. The palette's own
 * search input is the one exception — while it is open, the hotkey toggles.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** English search terms per navigation label key, so "budgets" finds Orçamentos. */
const NAV_KEYWORDS: Record<string, string[]> = {
  "navigation.home": ["home", "dashboard", "overview", "start"],
  "navigation.accounts": ["accounts", "bank", "balances", "ledger"],
  "navigation.overview": ["overview", "summary"],
  "navigation.transactions": ["transactions", "ledger", "history", "activity"],
  "navigation.bills-subscriptions": ["bills", "subscriptions", "recurring"],
  "navigation.loans": ["loans", "debt", "credit", "borrow"],
  "navigation.budgets": ["budgets", "budget", "spending plan", "envelope"],
  "navigation.portfolio": ["portfolio", "investments", "broker", "holdings"],
  "navigation.assets": ["assets", "property", "home", "vehicle", "valuables"],
  "navigation.financial-markets": ["financial markets", "markets", "stocks", "etf", "prices"],
  "navigation.explorer": ["explorer", "markets", "search assets", "quotes"],
  "navigation.watchlist": ["watchlist", "favorites", "markets"],
  "navigation.goals": ["goals", "savings", "targets", "plans"],
  "navigation.reports": ["reports", "analytics", "charts", "insights"],
};

/** The settings page's tabs, reached as `/settings?tab=<name>`. */
const SETTINGS_TABS = [
  { name: "profile", labelKey: "navigation.profile", keywords: ["profile", "user", "name", "email"] },
  { name: "security", labelKey: "navigation.security", keywords: ["security", "password", "mfa", "2fa", "login"] },
  { name: "privacy", labelKey: "navigation.privacy", keywords: ["privacy", "data", "sharing"] },
  { name: "bank-provider", labelKey: "navigation.bank-provider", keywords: ["bank provider", "open banking", "credentials", "api key"] },
  { name: "connections", labelKey: "navigation.connections", keywords: ["connections", "banks", "institutions", "linked accounts"] },
  { name: "appearance", labelKey: "navigation.appearance", keywords: ["appearance", "theme", "display", "language"] },
  { name: "assistant", labelKey: "navigation.assistant", keywords: ["assistant", "ai", "model"] },
  { name: "categories", labelKey: "navigation.categories", keywords: ["categories", "spending categories"] },
  { name: "tags", labelKey: "navigation.tags", keywords: ["tags", "labels"] },
  { name: "rules", labelKey: "navigation.rules", keywords: ["rules", "automation", "auto categorize"] },
  { name: "currencies", labelKey: "navigation.currencies", keywords: ["currencies", "fx", "exchange rates"] },
  { name: "household", labelKey: "navigation.household", keywords: ["household", "family", "sharing", "members"] },
  { name: "notifications", labelKey: "navigation.notifications", keywords: ["notifications", "email", "alerts"] },
] as const;

type PaletteGroupId =
  | "go-to"
  | "accounts"
  | "budgets"
  | "goals"
  | "portfolios"
  | "loans"
  | "actions";

/** Lowercase and strip diacritics, so "orcamentos" matches a query for "orçamentos". */
function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * The palette matches on the localized label and on the English keywords, per
 * word of the query: a word matches if it appears in the label, or in (or as a
 * prefix of) one of the keywords, so "budgets" still finds the "budget" keyword.
 */
function itemMatches(query: string, item: PaletteItem): boolean {
  const words = normalizeText(query).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const label = normalizeText(item.label);
  const keywords = normalizeText(item.keywords.join(" ")).split(/\s+/);
  return words.every(
    (word) =>
      label.includes(word) ||
      keywords.some(
        (keyword) =>
          keyword.includes(word) ||
          keyword.startsWith(word) ||
          word.startsWith(keyword),
      ),
  );
}

/** 0 = label starts with the query, 1 = label contains it, 2 = keyword match. */
function itemRank(query: string, item: PaletteItem): number {
  const q = normalizeText(query).trim();
  if (!q) return 0;
  const label = normalizeText(item.label);
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  return 2;
}

interface PaletteItem {
  id: string;
  group: PaletteGroupId;
  label: string;
  /** English terms the item also matches on, whatever the locale. */
  keywords: string[];
  icon?: LucideIcon;
  run: () => void;
}

/**
 * The Cmd+K command palette, mounted once in the app shell. Three kinds of
 * entries: every sidebar destination (plus the settings tabs), the person's
 * accounts, budgets, goals, portfolios and loans from the react-query cache,
 * and the shell-level actions. Navigation and the "create" actions reuse the
 * exact mechanisms their buttons use — `router.push`, or the same dialog
 * components the pages open.
 */
export default function CommandPalette() {
  const t = useTranslations();
  const tp = useTranslations("command-palette");
  const tPrivacy = useTranslations("privacy-mode");
  const router = useRouter();
  const open = useCommandPaletteOpen();

  const navItems = useVisibleNavigation();
  const canImportFiles = useFeature((features) => features.fileStorage);
  const assistantAvailable = useFeature((features) => features.ai.assistant);

  const accountsQuery = useAccounts();
  const budgetsQuery = useBudgetsFull();
  const goalsQuery = useGoals();
  const portfoliosQuery = usePortfolios();
  const loansQuery = useLoans();
  const loading = [
    accountsQuery,
    budgetsQuery,
    goalsQuery,
    portfoliosQuery,
    loansQuery,
  ].some((query) => query.isPending);

  const { resolvedTheme, setTheme } = useTheme();
  const hydrated = useHydrated();
  const isDark = hydrated && resolvedTheme === "dark";
  const { hidden, toggle } = usePrivacyMode();

  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [addSyncOpen, setAddSyncOpen] = useState(false);
  const [addOfflineOpen, setAddOfflineOpen] = useState(false);
  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [search, setSearch] = useState("");
  // The query state lives here while the dialog content unmounts on close, so
  // clear it whenever the palette opens — adjusted during render, like the
  // comboboxes do, not in an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) setSearch("");
  }

  // Cmd+K / Ctrl+K anywhere in the signed-in shell, except while typing in a
  // field that captures it. Inside the open palette the hotkey toggles shut.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "KeyK" || event.altKey || event.repeat) return;
      if (!event.metaKey && !event.ctrlKey) return;
      const target = event.target;
      const inPalette =
        target instanceof HTMLElement &&
        target.closest("[cmdk-root]") !== null;
      if (isEditableTarget(target) && !inPalette) return;
      event.preventDefault();
      toggleCommandPalette();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const accounts = accountsQuery.data?.accounts ?? [];
  // Transactions are added and imported only into accounts the person may change.
  const editableAccounts = writableAccounts(accounts);
  const budgets = budgetsQuery.data?.budgets ?? [];
  const goals = goalsQuery.data?.goals ?? [];
  const portfolios = portfoliosQuery.data?.portfolios ?? [];
  const loans = loansQuery.data?.loans ?? [];
  const now = new Date();

  const goToItems: PaletteItem[] = [];
  for (const item of navItems) {
    goToItems.push({
      id: `nav:${item.id}`,
      group: "go-to",
      label: t(item.labelKey),
      keywords: NAV_KEYWORDS[item.labelKey] ?? [item.id],
      icon: item.icon,
      run: () => router.push(item.href),
    });
    for (const child of item.children ?? []) {
      goToItems.push({
        id: `nav:${child.id}`,
        group: "go-to",
        label: t(child.labelKey),
        keywords: NAV_KEYWORDS[child.labelKey] ?? [child.id],
        run: () => router.push(child.href),
      });
    }
  }
  goToItems.push({
    id: "nav:settings",
    group: "go-to",
    label: t("settings"),
    keywords: ["settings", "preferences", "configuration"],
    icon: SettingsIcon,
    run: () => router.push("/settings"),
  });
  for (const tab of SETTINGS_TABS) {
    if (tab.name === "assistant" && !assistantAvailable) continue;
    goToItems.push({
      id: `settings:${tab.name}`,
      group: "go-to",
      label: t(tab.labelKey),
      keywords: [tab.name, ...tab.keywords],
      run: () => router.push(`/settings?tab=${tab.name}`),
    });
  }

  const entityItems: PaletteItem[] = [
    ...accounts.map((account) => ({
      id: `account:${account.accountKey}`,
      group: "accounts" as const,
      label: account.accountName ?? t("navigation.account"),
      keywords: ["account", "bank"],
      icon: Landmark,
      run: () => router.push(`/accounts/${account.accountKey}`),
    })),
    ...budgets.map((budget) => ({
      id: `budget:${budget.budgetKey}`,
      group: "budgets" as const,
      label: budget.name,
      keywords: ["budget"],
      icon: PieChart,
      run: () =>
        router.push(
          `/budgets/${budget.budgetKey}/${now.getFullYear()}/${now.getMonth() + 1}`,
        ),
    })),
    ...goals.map((goal) => ({
      id: `goal:${goal.goalKey}`,
      group: "goals" as const,
      label: goal.name,
      keywords: ["goal", "target", "savings"],
      icon: Target,
      run: () => router.push(`/goals/${goal.goalKey}`),
    })),
    ...portfolios.map((portfolio) => ({
      id: `portfolio:${portfolio.portfolioKey}`,
      group: "portfolios" as const,
      label: portfolio.name,
      keywords: ["portfolio", "investment", "broker"],
      icon: Briefcase,
      run: () => router.push(`/portfolio/${portfolio.portfolioKey}`),
    })),
    ...loans.map((loan) => ({
      id: `loan:${loan.loanKey}`,
      group: "loans" as const,
      label: loan.name,
      keywords: ["loan", "debt", "mortgage"],
      icon: ReceiptText,
      run: () => router.push(`/loans/${loan.loanKey}`),
    })),
  ];

  const togglePrivacyMode = () => {
    const next = !hidden;
    toggle();
    toast(next ? tPrivacy("amounts-hidden") : tPrivacy("amounts-shown"), {
      id: "privacy-mode",
    });
  };

  const actionItems: PaletteItem[] = [];
  if (editableAccounts.length > 0) {
    actionItems.push({
      id: "action:add-transaction",
      group: "actions",
      label: t("add-transaction"),
      keywords: ["add transaction", "new transaction", "expense", "income"],
      icon: Plus,
      run: () => setAddTransactionOpen(true),
    });
    // CSV uploads go through file storage; a server without it offers none.
    if (canImportFiles) {
      actionItems.push({
        id: "action:import-csv",
        group: "actions",
        label: t("import-transactions"),
        keywords: ["import", "csv", "statement", "transactions"],
        icon: Upload,
        run: () => setImportOpen(true),
      });
    }
  }
  actionItems.push(
    {
      id: "action:create-budget",
      group: "actions",
      label: t("create-budget"),
      keywords: ["create budget", "new budget", "wizard"],
      icon: PieChart,
      // The budgets page's create button routes to the wizard; so does this.
      run: () => router.push("/budgets/wizard"),
    },
    {
      id: "action:create-goal",
      group: "actions",
      label: t("goals.create"),
      keywords: ["create goal", "new goal"],
      icon: Target,
      run: () => setCreateGoalOpen(true),
    },
    {
      id: "action:add-account",
      group: "actions",
      label: t("add-account"),
      keywords: ["add account", "new account", "bank", "link"],
      icon: Landmark,
      run: () => setAddAccountOpen(true),
    },
    {
      id: "action:toggle-theme",
      group: "actions",
      label: isDark ? t("top-bar.light-mode") : t("top-bar.dark-mode"),
      keywords: ["theme", "dark mode", "light mode", "appearance"],
      icon: isDark ? Sun : Moon,
      run: () => setTheme(isDark ? "light" : "dark"),
    },
    {
      id: "action:toggle-privacy-mode",
      group: "actions",
      label: hidden ? tPrivacy("show-amounts") : tPrivacy("hide-amounts"),
      keywords: ["privacy", "hide amounts", "show amounts", "mask"],
      icon: hidden ? EyeOff : Eye,
      run: togglePrivacyMode,
    },
  );

  const allGroups: {
    id: PaletteGroupId;
    heading: string;
    items: PaletteItem[];
  }[] = [
    { id: "go-to", heading: tp("groups.go-to"), items: goToItems },
    {
      id: "accounts",
      heading: t("navigation.accounts"),
      items: entityItems.filter((item) => item.group === "accounts"),
    },
    {
      id: "budgets",
      heading: t("navigation.budgets"),
      items: entityItems.filter((item) => item.group === "budgets"),
    },
    {
      id: "goals",
      heading: t("navigation.goals"),
      items: entityItems.filter((item) => item.group === "goals"),
    },
    {
      id: "portfolios",
      heading: t("navigation.portfolio"),
      items: entityItems.filter((item) => item.group === "portfolios"),
    },
    {
      id: "loans",
      heading: t("navigation.loans"),
      items: entityItems.filter((item) => item.group === "loans"),
    },
    { id: "actions", heading: tp("groups.actions"), items: actionItems },
  ];

  // cmdk's own filter ranks by its scorer and its group reordering is broken
  // for spaced headings, so the palette filters itself (`shouldFilter={false}`)
  // and holds the selection on the first — best — visible item.
  const groups = allGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => itemMatches(search, item))
        .sort((a, b) => itemRank(search, a) - itemRank(search, b)),
    }))
    .filter((group) => group.items.length > 0);
  const firstVisible = groups[0]?.items[0];

  const select = (item: PaletteItem) => {
    closeCommandPalette();
    item.run();
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) closeCommandPalette();
        }}
      >
        <DialogContent
          className="gap-0 overflow-hidden p-0 shadow-lg sm:max-w-lg"
          aria-modal="true"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            // Hand focus back to the trigger: the button that opened the
            // palette, or whatever had focus when the hotkey fired.
            const trigger = getCommandPaletteTrigger();
            if (trigger && trigger.isConnected) {
              event.preventDefault();
              trigger.focus();
            }
          }}
        >
          <DialogTitle className="sr-only">{tp("title")}</DialogTitle>
          <Command
            label={tp("title")}
            shouldFilter={false}
            value={
              firstVisible ? `${firstVisible.label} ${firstVisible.id}` : undefined
            }
            className="[&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]]:pr-12 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:gap-2 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-4"
          >
            <CommandInput
              placeholder={tp("placeholder")}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {loading ? (
                <CommandLoading label={tp("loading")}>
                  {tp("loading")}
                </CommandLoading>
              ) : null}
              {!loading ? <CommandEmpty>{tp("empty")}</CommandEmpty> : null}
              {groups.map((group) => (
                <CommandGroup key={group.id} heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.id}
                      value={`${item.label} ${item.id}`}
                      keywords={item.keywords}
                      onSelect={() => select(item)}
                    >
                      {item.icon ? (
                        <item.icon
                          className="size-4 shrink-0 opacity-70"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="truncate">{item.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      {/* The shell-level action dialogs — the same components the pages open
          from their buttons, driven here through their own isOpen/setOpen. */}
      {editableAccounts.length > 0 ? (
        <AccountTransactionAddModal
          isOpen={addTransactionOpen}
          setOpen={setAddTransactionOpen}
          accounts={editableAccounts}
          trigger={null}
        />
      ) : null}
      {editableAccounts.length > 0 && canImportFiles ? (
        <AccountTransactionImportModal
          isOpen={importOpen}
          setOpen={setImportOpen}
          accounts={editableAccounts}
          trigger={null}
        />
      ) : null}
      <AccountAddModal
        isOpen={addAccountOpen}
        setOpen={setAddAccountOpen}
        onAddSyncAccountClick={() => {
          setAddAccountOpen(false);
          setAddSyncOpen(true);
        }}
        onAddOfflineAccountClick={() => {
          setAddAccountOpen(false);
          setAddOfflineOpen(true);
        }}
        trigger={false}
      />
      <AccountAddSyncModal isOpen={addSyncOpen} setOpen={setAddSyncOpen} />
      <AccountAddOfflineModal
        isOpen={addOfflineOpen}
        closeModal={() => setAddOfflineOpen(false)}
      />
      <GoalCreateDialog isOpen={createGoalOpen} setOpen={setCreateGoalOpen} />
    </>
  );
}

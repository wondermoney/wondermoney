"use client";

import { Filter, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FilterChip, FilterChipBar } from "@/components/ui/FilterChip";
import { Label } from "@/components/ui/Label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import useAccounts from "@/lib/api/account/useAccounts";
import useTransactionMerchants from "@/lib/api/account/useTransactionMerchants";
import useCategories from "@/lib/api/category/useCategories";
import { cn } from "@/lib/utils";
import {
  getCategoryTranslationKey,
  getSelectableCategories,
} from "@/lib/utils/categories";

import { AccountMultiSelect } from "./AccountMultiSelect";
import { CategoryMultiSelect } from "./CategoryMultiSelect";
import { CurrencySelect } from "./CurrencySelect";
import { DateRangePicker } from "./DateRangePicker";
import { MerchantMultiSelect } from "./MerchantMultiSelect";
import { useReportFilters } from "./useReportFilters";

interface ReportFiltersBarProps {
  className?: string;
}

export function ReportFiltersBar({ className }: ReportFiltersBarProps) {
  const t = useTranslations("reports.filters");
  const tRoot = useTranslations();
  const { data: accountsData } = useAccounts();
  const { data: categoriesData } = useCategories();
  const { data: merchantsData } = useTransactionMerchants();

  const accounts = useMemo(
    () =>
      (accountsData?.accounts ?? []).map((account) => ({
        key: account.accountKey.toString(),
        name: account.accountName ?? tRoot("unknown"),
      })),
    [accountsData, tRoot],
  );

  const categories = useMemo(
    () =>
      getSelectableCategories(categoriesData?.categories ?? []).map(
        (category) => ({
          key: category.categoryKey.toString(),
          name: category.isSystemCategory
            ? tRoot(getCategoryTranslationKey(category.name))
            : category.name,
        }),
      ),
    [categoriesData, tRoot],
  );

  const merchants = useMemo(
    () =>
      (merchantsData?.transactionMerchants ?? []).map((merchant) => ({
        key: merchant.transactionMerchantKey.toString(),
        name: merchant.name,
      })),
    [merchantsData],
  );

  const currencies = useMemo(() => {
    const codes = new Set(
      (accountsData?.accounts ?? []).map((account) => account.currencyKey.code),
    );
    return [...codes].map((code) => ({ key: code, name: code }));
  }, [accountsData]);

  const {
    filters,
    dateRange,
    activeFilterCount,
    setDateRange,
    setAccountKeys,
    setCategoryKeys,
    setMerchantKeys,
    setCurrencyKey,
    setIncludePending,
    setIncludeTransfers,
    resetFilters,
  } = useReportFilters();

  const [sheetOpen, setSheetOpen] = useState(false);

  const filterPanel = (
    <div className="flex flex-col gap-4">
      {/* One control per row. The panel is a 448px sheet with room to spare —
          a two-column grid squeezed each select to ~200px and put the whole
          panel in the top fifth of the sheet with nothing below it. Each
          control is also labelled now; the currency select in particular read
          as a bare "Select…". */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs font-medium">
            {tRoot("navigation.accounts")}
          </Label>
          <AccountMultiSelect
            accounts={accounts}
            selected={filters.accountKeys}
            onChange={setAccountKeys}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs font-medium">
            {tRoot("navigation.categories")}
          </Label>
          <CategoryMultiSelect
            categories={categories}
            selected={filters.categoryKeys}
            onChange={setCategoryKeys}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs font-medium">
            {tRoot("merchant")}
          </Label>
          <MerchantMultiSelect
            merchants={merchants}
            selected={filters.merchantKeys}
            onChange={setMerchantKeys}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-muted-foreground text-xs font-medium">
            {tRoot("currency")}
          </Label>
          <CurrencySelect
            currencies={currencies}
            value={filters.currencyKey}
            onChange={setCurrencyKey}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-pending"
            checked={filters.includePending}
            onCheckedChange={(checked) => setIncludePending(checked === true)}
          />
          <Label htmlFor="include-pending" className="text-sm font-normal">
            {t("includePending")}
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-transfers"
            checked={filters.includeTransfers}
            onCheckedChange={(checked) => setIncludeTransfers(checked === true)}
          />
          <Label htmlFor="include-transfers" className="text-sm font-normal">
            {t("includeTransfers")}
          </Label>
        </div>
      </div>
    </div>
  );

  /*
   * § 9 `FilterChip` — the applied filters, one chip per selected value.
   *
   * The sheet closes and takes its state with it: the only trace left was a
   * count on the trigger, so "3" told you that something was narrowing the
   * report but not what, and removing one meant reopening the panel and
   * hunting for it. Each chip names its dimension — a bare "Poupança" does not
   * say whether it is an account, a merchant or a category.
   */
  const nameOf = (list: { key: string; name: string }[], key: string) =>
    list.find((item) => item.key === key)?.name ?? key;

  const activeChips = [
    ...filters.accountKeys.map((key) => ({
      id: `account:${key}`,
      label: tRoot("navigation.accounts"),
      value: nameOf(accounts, key),
      remove: () =>
        setAccountKeys(filters.accountKeys.filter((k) => k !== key)),
    })),
    ...filters.categoryKeys.map((key) => ({
      id: `category:${key}`,
      label: tRoot("navigation.categories"),
      value: nameOf(categories, key),
      remove: () =>
        setCategoryKeys(filters.categoryKeys.filter((k) => k !== key)),
    })),
    ...filters.merchantKeys.map((key) => ({
      id: `merchant:${key}`,
      label: tRoot("merchant"),
      value: nameOf(merchants, key),
      remove: () =>
        setMerchantKeys(filters.merchantKeys.filter((k) => k !== key)),
    })),
    ...(filters.currencyKey
      ? [
          {
            id: `currency:${filters.currencyKey}`,
            label: tRoot("currency"),
            value: filters.currencyKey,
            remove: () => setCurrencyKey(undefined),
          },
        ]
      : []),
  ];

  return (
    <div
      className={cn("flex flex-wrap items-center gap-3", className)}
      data-testid="report-filters-bar"
    >
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {activeChips.length > 0 ? (
        <FilterChipBar className="order-last w-full">
          {activeChips.map((chip) => (
            <FilterChip
              key={chip.id}
              label={chip.label}
              value={chip.value}
              onRemove={chip.remove}
              removeLabel={tRoot("filters-remove", { name: chip.value })}
            />
          ))}
        </FilterChipBar>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {/* One filter surface at every breakpoint: a right-side Sheet, the
            same as the transactions table. This used to branch on
            `useBreakpoint("sm")` into a desktop Popover and a bottom Sheet, so
            the same control behaved three different ways depending on the
            width and the route. A filter panel is a focused task — it gets a
            panel, not a dropdown. */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-2 sm:h-9"
              aria-label={t("title")}
            >
              <Filter className="size-4" />
              {t("title")}
              {activeFilterCount > 0 && (
                <span className="bg-primary text-primary-foreground ml-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="flex w-full flex-col sm:max-w-md"
          >
            <SheetHeader className="text-left">
              <SheetTitle>{t("title")}</SheetTitle>
            </SheetHeader>
            <div className="mt-4 flex-1 overflow-y-auto">{filterPanel}</div>
          </SheetContent>
        </Sheet>

        <Button
          variant="ghost"
          size="sm"
          className="h-10 gap-2 sm:h-9"
          onClick={resetFilters}
          aria-label={t("reset")}
        >
          <RotateCcw className="size-4" />
          <span className="hidden sm:inline">{t("reset")}</span>
        </Button>
      </div>
    </div>
  );
}

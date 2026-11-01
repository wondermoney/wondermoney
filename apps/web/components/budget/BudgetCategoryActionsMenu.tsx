"use client";

import { Edit2, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactElement, useRef, useState } from "react";

import type { BudgetRow } from "@/lib/budget/rows";
import { SupportedCurrencyCodes } from "@/lib/utils/currencySymbol";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { BudgetCategoryEditSheet } from "./BudgetCategoryEditSheet";

type Props = {
  /** The menu button. Rendered through `asChild`, so it must be a single element that forwards refs. */
  trigger: ReactElement;
  align?: "start" | "center" | "end";
  budgetKey: number;
  year: number;
  month: number;
  category: BudgetRow;
  currency: SupportedCurrencyCodes;
  onDelete: () => void;
};

/**
 * The per-category "…" menu (Edit, Delete) on a budget month.
 *
 * The edit sheet is a sibling of the menu, not a child of it, and it only
 * opens once the menu has finished closing. While a modal Radix menu is open
 * it traps focus and disables pointer events outside itself. Our menu and our
 * sheet resolve to different copies of Radix's focus-scope and
 * dismissable-layer packages, so neither knows the other is open: a sheet
 * opened on top of a still-open menu had every focus move pulled back into the
 * menu, so typing into its Amount field did nothing. Waiting
 * for `onCloseAutoFocus` means the menu's focus trap and pointer-events lock
 * are gone before the sheet installs its own.
 */
export function BudgetCategoryActionsMenu({
  trigger,
  align,
  budgetKey,
  year,
  month,
  category,
  currency,
  onDelete,
}: Props) {
  const t = useTranslations();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const editRequestedRef = useRef(false);
  // `session` remounts the sheet on every open, so its form starts from the
  // category's current amount rather than whatever the last edit left behind.
  const [edit, setEdit] = useState({ open: false, session: 0 });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild ref={triggerRef}>
          {trigger}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          onCloseAutoFocus={(event) => {
            if (!editRequestedRef.current) return;
            editRequestedRef.current = false;
            event.preventDefault();
            setEdit((current) => ({
              open: true,
              session: current.session + 1,
            }));
          }}
        >
          <DropdownMenuItem
            className="flex w-full flex-row justify-between"
            onSelect={() => {
              editRequestedRef.current = true;
            }}
          >
            {t("edit")}
            <Edit2 className="text-foreground size-4" />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete}>
            <div className="text-destructive-text flex w-full items-center justify-between gap-3">
              <span>{t("delete")}</span>
              <Trash className="text-destructive-text size-4" />
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {edit.session > 0 && (
        <BudgetCategoryEditSheet
          key={edit.session}
          open={edit.open}
          onOpenChange={(open) => setEdit((current) => ({ ...current, open }))}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef.current?.focus();
          }}
          budgetKey={budgetKey}
          year={year}
          month={month}
          category={category}
          currency={currency}
        />
      )}
    </>
  );
}

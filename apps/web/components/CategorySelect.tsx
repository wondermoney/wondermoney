"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePostHog } from "posthog-js/react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import CategoryIcon, {
  categoryIconStyle,
} from "@/components/ui/CategoryIcon";
import { Text } from "@/components/ui/Typography";
import { useRouter } from "@/i18n/navigation";
import type { Category } from "@/lib/api/category/useCategories";
import {
  getCategorySearchKeywords,
  getCategoryTranslationKey,
  getSelectableCategories,
  getSelectableCategoriesForGroup,
} from "@/lib/utils/categories";
import { useMediaQuery } from "@/lib/utils/useMediaQuery";

import { Button, ButtonProps } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Drawer, DrawerContent, DrawerTrigger } from "./ui/drawer";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * One structure for every state of this cell.
 *
 * Without a shared structure the category column would sit at three different
 * left edges: plain "Not applicable" text at the cell edge, "Edit category"
 * indented by the trigger button's `px-3`, and a chosen category indented
 * again by its icon and gap. Three states, three alignments, down one column.
 *
 * The slot is reserved whether or not there is an icon to put in it, so the
 * label lands in the same place in all three cases. `CATEGORY_CELL_INSET`
 * cancels the button padding so the slot starts where plain cell text starts —
 * the non-button branch in the transactions table uses the same value.
 */
const CATEGORY_CELL_INSET = "-ml-3";

export function CategoryCellContent({
  icon,
  iconColor,
  label,
  muted = false,
  trailing,
}: {
  icon?: React.ReactNode;
  iconColor?: string;
  label: React.ReactNode;
  muted?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className="flex size-4 shrink-0 items-center justify-center"
        style={categoryIconStyle(iconColor)}
        aria-hidden={icon ? undefined : true}
      >
        {icon}
      </span>
      <span className={muted ? "text-muted-foreground truncate" : "truncate"}>
        {label}
      </span>
      {trailing}
    </span>
  );
}

interface CategorySelectProps {
  categories: Category[];
  onChange: (value: string) => void;
  initialValue?: string;
  loading?: boolean;
  triggerProps?: ButtonProps;
}

const CategorySelect: React.FC<CategorySelectProps> = React.memo(
  ({ categories, onChange, initialValue, loading = false, triggerProps }) => {
    const [open, setOpen] = useState(false);
    const isDesktop = useMediaQuery("(min-width: 768px)");
    const t = useTranslations();
    const posthog = usePostHog();
    const router = useRouter();
    const triggerButtonProps = {
      ...triggerProps,
      variant: triggerProps?.variant ?? "ghost",
      role: "combobox" as const,
      // The uncategorised state renders an em-dash rather than the words "Edit
      // category" (§ 9 rule 3), so the button would otherwise have no
      // accessible name. The label moves to `aria-label` instead of being
      // dropped — sighted users get a quiet column, screen readers still get
      // "Edit category".
      "aria-label": triggerProps?.["aria-label"] ?? t("edit-category"),
      className: ["justify-start", CATEGORY_CELL_INSET, triggerProps?.className]
        .filter(Boolean)
        .join(" "),
      size: triggerProps?.size ?? "sm",
      disabled: loading || triggerProps?.disabled,
      loading: triggerProps?.loading ?? loading,
    };
    const onOpenChange = useCallback(
      (open: boolean) => {
        posthog.capture("account_transaction_review_category_menu", {
          action: open ? "open" : "close",
        });
      },
      [posthog],
    );

    const [value, setValue] = useState<string | undefined>(initialValue);

    const onSelectInternalHandler = useCallback(
      (option: string) => {
        setValue(option);
        onChange(option);
        setOpen(false);
      },
      [onChange],
    );

    // Memoize expensive flatMap operation to prevent recalculation on every render
    const selectedCategory = useMemo(
      () =>
        getSelectableCategories(categories).find(
          (category) => category.categoryKey.toString() === value,
        ),
      [categories, value],
    );
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listRef = useRef(null);
    const renderCategoryItem = useCallback(
      (category: Category) => {
        // The label actually shown to the user — search must match this,
        // not just the raw untranslated `category.name` enum.
        const label = category.isSystemCategory
          ? t(getCategoryTranslationKey(category.name))
          : category.name;

        return (
          <CommandItem
            key={category.categoryKey}
            value={category.categoryKey.toString()}
            keywords={getCategorySearchKeywords(category.name, label)}
            onSelect={onSelectInternalHandler}
            className="flex items-center gap-2"
          >
            <CategoryIcon
              icon={category.icon}
              style={categoryIconStyle(category.bgColor)}
            />
            <Text variant="smallText">{label}</Text>
          </CommandItem>
        );
      },
      [onSelectInternalHandler, t],
    );

    const renderCategoryOptions = useCallback(
      (category: Category) => {
        const selectableCategories = getSelectableCategoriesForGroup(category);

        if (selectableCategories.length === 0) return null;

        return (
          <CommandGroup key={category.categoryKey} heading={category.name}>
            {selectableCategories.map(renderCategoryItem)}
          </CommandGroup>
        );
      },
      [renderCategoryItem],
    );

    useEffect(() => {
      inputRef?.current?.focus();
    }, []);

    if (isDesktop) {
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild disabled={loading}>
            <Button {...triggerButtonProps}>
              {loading ? null : value && selectedCategory ? (
                <CategoryCellContent
                  icon={<CategoryIcon icon={selectedCategory?.icon} />}
                  iconColor={selectedCategory?.bgColor}
                  label={
                    selectedCategory?.isSystemCategory
                      ? t(getCategoryTranslationKey(selectedCategory?.name))
                      : selectedCategory?.name
                  }
                />
              ) : (
                /*
                 * § 9 rule 3 — an uncategorised transaction is an absence, so
                 * it reads as an em-dash. This printed "Edit category" on every
                 * uncategorised row: a call to action repeated down a column the
                 * eye is scanning, which says nothing about the transaction and
                 * competes with the rows that do carry a category.
                 *
                 * The affordance is not lost — the whole cell is still the
                 * trigger, and the pencil still marks it as editable.
                 */
                <CategoryCellContent
                  label="—"
                  muted
                  trailing={<Pencil className="size-4 shrink-0 opacity-50" />}
                />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="z-110 flex flex-col p-0" align="start">
            <Command value={value} onValueChange={setValue}>
              <CommandInput
                ref={inputRef}
                autoFocus
                placeholder={t("search-category")}
              />
              <CommandList ref={listRef}>
                <CommandEmpty>{t("no-category-found")}</CommandEmpty>
                {categories.map(renderCategoryOptions)}
              </CommandList>
              <div className="border-t-border bg-muted flex h-10 w-full shrink-0 items-center border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/settings?tab=categories")}
                >
                  {t("add-new-category")}
                </Button>
              </div>
            </Command>
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild disabled={loading}>
          <Button {...triggerButtonProps}>
            {loading ? null : value && selectedCategory ? (
              <CategoryCellContent
                icon={<CategoryIcon icon={selectedCategory?.icon} />}
                iconColor={selectedCategory?.bgColor}
                label={
                  selectedCategory?.isSystemCategory
                    ? t(getCategoryTranslationKey(selectedCategory?.name))
                    : selectedCategory?.name
                }
              />
            ) : (
              <CategoryCellContent
                label="—"
                muted
                trailing={<Pencil className="size-4 shrink-0 opacity-50" />}
              />
            )}
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <div className="mt-4 border-t">
            <Command value={value} onValueChange={setValue}>
              <CommandInput
                ref={inputRef}
                autoFocus
                placeholder={t("search-category")}
              />
              <CommandList ref={listRef}>
                <CommandEmpty>{t("no-category-found")} </CommandEmpty>
                {categories.map(renderCategoryOptions)}
              </CommandList>
              {/* A footer, not an overlay. Absolutely positioning this inside
                  the scroll container parked it on top of the last categories
                  in the list. */}
              <div className="border-t-border bg-muted flex h-10 w-full shrink-0 items-center border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push("/settings?tab=categories")}
                >
                  {t("add-new-category")}
                </Button>
              </div>
            </Command>
          </div>
        </DrawerContent>
      </Drawer>
    );
  },
);

CategorySelect.displayName = "CategorySelect";

export default CategorySelect;

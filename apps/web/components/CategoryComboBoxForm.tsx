"use client";

import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useRef, useState } from "react";

import CategoryIcon, {
  categoryIconStyle,
} from "@/components/ui/CategoryIcon";
import { Text } from "@/components/ui/Typography";
import { useRouter } from "@/i18n/navigation";
import type { Category } from "@/lib/api/category/useCategories";
import { cn } from "@/lib/utils";
import {
  getCategoryTranslationKey,
  getSelectableCategories,
  getSelectableCategoriesForGroup,
} from "@/lib/utils/categories";
import { useMediaQuery } from "@/lib/utils/useMediaQuery";

import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Drawer, DrawerContent, DrawerTrigger } from "./ui/drawer";
import { FormControl } from "./ui/Form";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

interface CategoryComboBoxFormProps {
  categories: Category[];
  field: { value?: string };
  onSelect?: (categoryKey: string) => void;
  placeholder?: string;
  triggerClassName?: string;
}

const CategoryOptionsList = ({
  field,
  categories,
  onSelect,
}: {
  field?: { value?: string };
  categories: Category[];
  onSelect: (categoryKey: string) => void;
}) => {
  const t = useTranslations();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renderCategoryItem = (category: Category) => (
    <CommandItem
      key={category.categoryKey}
      value={category.categoryKey.toString()}
      keywords={[category.name]}
      onSelect={() => onSelect(category.categoryKey.toString())}
      className="flex items-center gap-2"
    >
      <CategoryIcon
        icon={category.icon}
        style={categoryIconStyle(category.bgColor)}
      />
      <Text variant="smallText">
        {category.isSystemCategory
          ? t(getCategoryTranslationKey(category.name))
          : category.name}
      </Text>
    </CommandItem>
  );

  const renderCategoryOptions = (category: Category) => {
    const selectableCategories = getSelectableCategoriesForGroup(category);

    if (selectableCategories.length === 0) return null;

    return (
      <CommandGroup key={category.categoryKey} heading={category.name}>
        {selectableCategories.map(renderCategoryItem)}
      </CommandGroup>
    );
  };

  useEffect(() => {
    inputRef?.current?.focus();
  }, []);

  return (
    <Command>
      <CommandInput
        ref={inputRef}
        autoFocus
        placeholder={t("search-category")}
      />
      <CommandList>
        <CommandEmpty>{t("no-category-found")}</CommandEmpty>
        {categories.map(renderCategoryOptions)}
      </CommandList>
      <div className="border-t-border bg-muted flex h-10 w-full shrink-0 items-center border-t">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push("/settings?tab=categories")}
        >
          {t("add-new-category")}
        </Button>
      </div>
    </Command>
  );
};

export const CategoryComboBoxForm = forwardRef<
  HTMLButtonElement,
  CategoryComboBoxFormProps
>(({ field, onSelect, placeholder, categories, triggerClassName }, ref) => {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const isLoadingCategories = !categories || categories.length === 0;
  const t = useTranslations();

  // Find the selected category from all child categories
  const selectedCategory = getSelectableCategories(categories).find(
    (category) => category.categoryKey.toString() === field.value,
  );

  const _onSelect = (categoryKey: string) => {
    onSelect?.(categoryKey);
    setOpen(false);
  };

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <FormControl>
            <Button
              type="button"
              ref={ref}
              variant="input"
              role="combobox"
              className={cn(
                "justify-between",
                !field.value && "text-muted-foreground",
                isLoadingCategories && "cursor-not-allowed",
                triggerClassName,
              )}
            >
              {isLoadingCategories ? (
                <>{t("loading")}</>
              ) : field.value && selectedCategory ? (
                <div className="flex items-center gap-1">
                  <CategoryIcon
                    icon={selectedCategory?.icon}
                    style={categoryIconStyle(selectedCategory?.bgColor)}
                  />
                  {selectedCategory?.isSystemCategory
                    ? t(getCategoryTranslationKey(selectedCategory?.name))
                    : selectedCategory?.name}
                </div>
              ) : (
                <>{placeholder ?? t("search-category")}</>
              )}
              <ChevronsUpDown
                className={cn("ml-2 size-4 shrink-0 opacity-50", {
                  "opacity-0": isLoadingCategories,
                })}
              />
            </Button>
          </FormControl>
        </PopoverTrigger>
        <PopoverContent className="z-110 flex flex-col p-0" align="start">
          {!isLoadingCategories && (
            <CategoryOptionsList
              field={field}
              categories={categories}
              onSelect={_onSelect}
            />
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          type="button"
          ref={ref}
          variant="input"
          role="combobox"
          className={cn(
            "justify-between",
            !field.value && "text-muted-foreground",
            isLoadingCategories && "cursor-not-allowed",
            triggerClassName,
          )}
        >
          {isLoadingCategories ? (
            <>{t("loading")}</>
          ) : field.value && selectedCategory ? (
            <div className="flex items-center gap-1">
              <CategoryIcon
                icon={selectedCategory?.icon}
                style={categoryIconStyle(selectedCategory?.bgColor)}
              />
              {selectedCategory?.isSystemCategory
                ? t(getCategoryTranslationKey(selectedCategory?.name))
                : selectedCategory?.name}
            </div>
          ) : (
            <>{placeholder ?? t("search-category")}</>
          )}
          <ChevronsUpDown
            className={cn("ml-2 size-4 shrink-0 opacity-50", {
              "opacity-0": isLoadingCategories,
            })}
          />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="z-110 p-0">
        <div className="mt-4 border-t">
          {!isLoadingCategories && (
            <CategoryOptionsList
              field={field}
              categories={categories}
              onSelect={_onSelect}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
});

CategoryComboBoxForm.displayName = "CategoryComboBoxForm";

"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  label: string;
  placeholder: string;
  searchPlaceholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  label,
  placeholder,
  searchPlaceholder,
  className,
}: MultiSelectProps) {
  const t = useTranslations("reports.filters");
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedLabels = useMemo(
    () =>
      selected
        .map((value) => options.find((o) => o.value === value)?.label)
        .filter(Boolean),
    [selected, options],
  );

  const filteredOptions = useMemo(
    () =>
      options.filter((option) =>
        option.label.toLowerCase().includes(search.toLowerCase()),
      ),
    [options, search],
  );

  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  };

  const clear = () => onChange([]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {/* The `input` surface, not `outline`: this is a form control, and the
            violet outline made an empty filter read as an active one. Two
            names fit the trigger; past that a count says more than a
            truncated list. */}
        <Button
          variant="input"
          role="combobox"
          aria-expanded={isOpen}
          className={cn("w-full justify-between px-3 text-left", className)}
          aria-label={label}
        >
          <span
            className={cn(
              "truncate",
              selected.length === 0 && "text-muted-foreground",
            )}
          >
            {selected.length === 0
              ? placeholder
              : selected.length <= 2 &&
                  selectedLabels.length === selected.length
                ? selectedLabels.join(", ")
                : t("selected", { count: selected.length })}
          </span>
          <ChevronDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder={searchPlaceholder ?? t("placeholder.search")}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{t("noResults")}</CommandEmpty>
            <CommandGroup>
              {selected.length > 0 && (
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-muted-foreground text-xs">
                    {t("selected", { count: selected.length })}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={clear}
                  >
                    <X className="mr-1 size-3" />
                    {t("reset")}
                  </Button>
                </div>
              )}
              {filteredOptions.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => toggle(option.value)}
                    aria-selected={isSelected}
                    className="flex cursor-pointer items-center justify-between"
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && <Check className="size-4" />}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

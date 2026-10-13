"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
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
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  label,
  placeholder,
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
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-10 justify-start gap-2 px-3 text-left font-normal sm:h-9",
            className,
          )}
          aria-label={label}
        >
          <span className="truncate font-medium">{label}</span>
          {selected.length > 0 && (
            <Badge variant="secondary" className="ml-1 shrink-0">
              {t("selected", { count: selected.length })}
            </Badge>
          )}
          <ChevronDown className="ml-auto size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput
            placeholder={placeholder ?? t("placeholder.search")}
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

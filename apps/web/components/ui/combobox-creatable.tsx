"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";

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
import { useMediaQuery } from "@/lib/utils/useMediaQuery";

import { getCreatableQuery } from "./combobox-creatable-utils";
import { Drawer, DrawerContent, DrawerTrigger } from "./drawer";
import { FormControl } from "./Form";

export type ComboboxOptions = {
  value: string;
  label: string;
};

type Mode = "single" | "multiple";

interface ComboboxProps {
  mode?: Mode;
  options?: ComboboxOptions[];
  selected?: string | string[]; // Updated to handle multiple selections
  className?: string;
  placeholder?: string;
  form?: boolean;
  onChange?: (value: string | string[]) => void; // Updated to handle multiple selections
  onCreate?: (value: string) => void;
  createLabel?: (value: string) => React.ReactNode;
  createEmptyHint?: React.ReactNode;
  onQueryChange?: (value: string) => void;
  btnVariant?: "default" | "secondary" | "ghost" | "outline" | "input";
  closeOnSelect?: boolean;
  required?: boolean;
}

export function ComboboxCreatable({
  options = [],
  selected,
  className,
  placeholder,
  form,
  mode = "single",
  onChange,
  onCreate,
  createLabel,
  createEmptyHint,
  onQueryChange,
  btnVariant = "input",
  closeOnSelect = true,
  required,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [query, setQuery] = React.useState<string>("");
  const t = useTranslations();
  const computedPlaceholder = placeholder ?? t("select-option");
  const trimmedQuery = getCreatableQuery(query) ?? "";
  const canCreate = trimmedQuery.length > 0;
  const renderCreateLabel = (value: string) =>
    createLabel ? createLabel(value) : t("create-option", { option: value });
  const computedCreateEmptyHint =
    createEmptyHint ?? t("type-option-name-to-create");

  const selectedText =
    mode === "multiple" && Array.isArray(selected)
      ? selected
          .map(
            (selectedValue: string) =>
              options.find((item) => item.value === selectedValue)?.label,
          )
          .join(", ")
      : mode === "single" &&
        options.find((item) => item.value === selected)?.label;

  const buttonElement = isDesktop ? (
    <Button
      type="button"
      variant={btnVariant}
      role="combobox"
      aria-required={required}
      className="min-w-[200px] justify-between"
    >
      {selected && selected.length > 0 ? (
        <div className="relative mr-auto flex grow flex-wrap items-center overflow-hidden">
          <span className="truncate">{selectedText}</span>
        </div>
      ) : (
        <span className="text-muted-foreground">{computedPlaceholder}</span>
      )}
      <ChevronsUpDown className="text-muted-foreground ml-2 size-4 shrink-0 opacity-50" />
    </Button>
  ) : (
    <Button
      type="button"
      variant={btnVariant}
      role="combobox"
      aria-required={required}
      className="min-w-[200px] justify-start"
    >
      <span className="truncate">{selectedText ?? computedPlaceholder}</span>
    </Button>
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {form ? <FormControl>{buttonElement}</FormControl> : buttonElement}
        </PopoverTrigger>
        <PopoverContent
          className="z-110 p-0"
          align="start"
          style={{
            width: "var(--radix-popover-trigger-width)",
          }}
        >
          <Command>
            <CommandInput
              placeholder={placeholder ?? "Select an option..."}
              value={query}
              onValueChange={(value: string) => {
                setQuery(value);
                onQueryChange?.(value);
              }}
            />
            <CommandList>
              <CommandEmpty className="p-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canCreate}
                  onClick={() => {
                    if (onCreate && canCreate) {
                      onCreate(trimmedQuery);
                      setQuery("");
                      onQueryChange?.("");
                    }
                    if (closeOnSelect) {
                      setOpen(false);
                    }
                  }}
                  className="w-full gap-2"
                >
                  {canCreate ? (
                    renderCreateLabel(trimmedQuery)
                  ) : (
                    <span className="text-muted-foreground truncate">
                      {computedCreateEmptyHint}
                    </span>
                  )}
                </Button>
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.label}
                    value={option.label}
                    onSelect={(currentValue) => {
                      if (onChange) {
                        if (mode === "multiple" && Array.isArray(selected)) {
                          onChange(
                            selected.includes(option.value)
                              ? selected.filter((item) => item !== option.value)
                              : [...selected, option.value],
                          );
                        } else {
                          onChange(option.value);
                        }
                      }
                      if (closeOnSelect) {
                        setOpen(false);
                      }
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected &&
                          (Array.isArray(selected)
                            ? selected
                            : [selected]
                          ).includes(option.value)
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        {form ? <FormControl>{buttonElement}</FormControl> : buttonElement}
      </DrawerTrigger>
      <DrawerContent>
        <div className="mt-4 border-t">
          <Command>
            <CommandInput
              placeholder={placeholder ?? "Select an option..."}
              value={query}
              onValueChange={(value: string) => {
                setQuery(value);
                onQueryChange?.(value);
              }}
            />
            <CommandList>
              <CommandEmpty className="p-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!canCreate}
                  onClick={() => {
                    if (onCreate && canCreate) {
                      onCreate(trimmedQuery);
                      setQuery("");
                      onQueryChange?.("");
                    }
                    if (closeOnSelect) {
                      setOpen(false);
                    }
                  }}
                  className="w-full gap-2"
                >
                  {canCreate ? (
                    renderCreateLabel(trimmedQuery)
                  ) : (
                    <span className="text-muted-foreground truncate">
                      {computedCreateEmptyHint}
                    </span>
                  )}
                </Button>
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.label}
                    value={option.label}
                    onSelect={(currentValue) => {
                      if (onChange) {
                        if (mode === "multiple" && Array.isArray(selected)) {
                          onChange(
                            selected.includes(option.value)
                              ? selected.filter((item) => item !== option.value)
                              : [...selected, option.value],
                          );
                        } else {
                          onChange(option.value);
                        }
                      }
                      if (closeOnSelect) {
                        setOpen(false);
                      }
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selected &&
                          (Array.isArray(selected)
                            ? selected
                            : [selected]
                          ).includes(option.value)
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

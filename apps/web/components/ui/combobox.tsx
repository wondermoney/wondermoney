"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Drawer, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/utils/useMediaQuery";

import { FormControl } from "./Form";
import { Spinner } from "./Spinner";

type Option = {
  shortLabel?: string;
  label: string;
  value: string;
  keywords?: string[]; // used for Command search
};

type Props = {
  id?: string;
  options?: Option[];
  onSelect: (option: Option | null) => void;
  defaultValue?: string;
  value?: string;
  withSearch?: boolean;
  closeOnSelect?: boolean;
  btnVariant?: "default" | "secondary" | "ghost" | "outline" | "input";
  placeholder?: string;
  searchPlaceholder?: string;
  triggerClassName?: string;
};

export function ComboBox({
  id,
  options,
  onSelect,
  value,
  defaultValue,
  withSearch = true,
  closeOnSelect = true,
  // `input`, not `outline`. A combobox is a select — it belongs to the same
  // family as Input, Textarea and Select and should wear `border-input` on a
  // transparent ground. `outline` in this project means `border-primary
  // text-primary`, so every call site — the transaction add and edit forms, the
  // CSV column mapper, account creation — drew a violet-bordered, violet-lettered
  // control sitting beside neutral text inputs on the same form. The
  // creatable sibling already defaults to `input`; these two are the same
  // control and now agree.
  btnVariant = "input",
  placeholder,
  searchPlaceholder,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [selected, setSelected] = useState<Option | null>(() => {
    return options?.find((o) => o.value === defaultValue) ?? null;
  });
  const isLoadingOptions = !options || options.length === 0;
  const t = useTranslations();
  const computedPlaceholder = placeholder ?? t("select-option");

  const onSelectInternalHandler = (option: Option | null) => {
    setSelected(option);
    if (closeOnSelect) {
      setOpen(false);
    }
    onSelect(option);
  };

  useEffect(() => {
    const option = options?.find((o) => o.value === value) ?? null;
    if (!option) return;
    setSelected(option);
  }, [value, options]);

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant={btnVariant}
            role="combobox"
            className={cn("w-[150px] justify-between", triggerClassName)}
          >
            <span className="truncate">
              {selected
                ? (selected.shortLabel ?? selected.label)
                : computedPlaceholder}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="z-110 p-0" align="start">
          {!isLoadingOptions && (
            <OptionsList
              options={options}
              setOpen={setOpen}
              onSelect={onSelectInternalHandler}
              // field={{ value: defaultValue ?? selected?.value ?? "" }}
              withSearch={withSearch}
              closeOnSelect={closeOnSelect}
              searchPlaceholder={searchPlaceholder ?? t("search")}
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
          id={id}
          type="button"
          variant={btnVariant}
          role="combobox"
          className={cn("w-[200px] justify-start", triggerClassName)}
        >
          <span className="truncate">
            {selected
              ? (selected.shortLabel ?? selected.label)
              : computedPlaceholder}
          </span>
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="mt-4 border-t">
          {!isLoadingOptions && (
            <OptionsList
              options={options}
              setOpen={setOpen}
              onSelect={onSelectInternalHandler}
              withSearch={withSearch}
              closeOnSelect={closeOnSelect}
              searchPlaceholder={searchPlaceholder ?? t("search")}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

type WithFormFieldProps = Props & {
  placeholder?: string;
  field: { value?: string };
  // Note: Use this onSelect prop to update the form value
  // onSelect={() => {
  //   form.setValue("language", language.value)
  // }}
  onSelect?: (value: Option | null) => void;
  disabled?: boolean;
};

export const ComboBoxForm = forwardRef<HTMLButtonElement, WithFormFieldProps>(
  (
    {
      field,
      onSelect,
      placeholder,
      options,
      triggerClassName,
      disabled,
      searchPlaceholder,
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const isDesktop = useMediaQuery("(min-width: 768px)");
    const isLoadingOptions = !options || options.length === 0;
    const _onSelect = (option: Option | null) => {
      onSelect?.(option);
      setOpen(false);
    };

    if (isDesktop) {
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <FormControl>
              <Button
                type="button"
                variant="input"
                role="combobox"
                disabled={disabled || isLoadingOptions}
                className={cn(
                  "justify-between",
                  !field.value && "text-muted-foreground",
                  isLoadingOptions && "cursor-not-allowed",
                  triggerClassName,
                )}
              >
                {isLoadingOptions ? (
                  <>
                    <Spinner />
                    <>Loading...</>
                  </>
                ) : field.value ? (
                  // Short label in the trigger, full label in the list — a
                  // currency chip inside a money field has room for "EUR", not
                  // for "EUR (Euro)" (RAD-616). Matches ComboBox, which already
                  // preferred shortLabel here.
                  <span className="truncate">
                    {(() => {
                      const selected = options.find(
                        (o) => o.value === field.value,
                      );
                      return selected?.shortLabel ?? selected?.label;
                    })()}
                  </span>
                ) : (
                  <>{placeholder ?? "Select option"}</>
                )}
                <ChevronsUpDown
                  className={cn("ml-2 size-4 shrink-0 opacity-50", {
                    "opacity-0": isLoadingOptions,
                  })}
                />
              </Button>
            </FormControl>
          </PopoverTrigger>
          <PopoverContent className="z-110 p-0" align="start">
            {!isLoadingOptions && (
              <OptionsList
                field={field}
                options={options}
                onSelect={_onSelect}
                searchPlaceholder={searchPlaceholder ?? "Search"}
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
            variant="input"
            role="combobox"
            disabled={disabled || isLoadingOptions}
            className={cn(
              "justify-between",
              !field.value && "text-muted-foreground",
              isLoadingOptions && "cursor-not-allowed",
              triggerClassName,
            )}
          >
            {isLoadingOptions ? (
              <>
                <Spinner />
                <>Loading...</>
              </>
            ) : field.value ? (
              <span className="truncate">
                {(() => {
                  const selected = options.find((o) => o.value === field.value);
                  return selected?.shortLabel ?? selected?.label;
                })()}
              </span>
            ) : (
              <>{placeholder ?? "Select option"}</>
            )}
            <ChevronsUpDown
              className={cn("ml-2 size-4 shrink-0 opacity-50", {
                "opacity-0": isLoadingOptions,
              })}
            />
          </Button>
        </DrawerTrigger>
        <DrawerContent className="z-110 p-0">
          {!isLoadingOptions && (
            <OptionsList
              field={field}
              options={options}
              onSelect={_onSelect}
              searchPlaceholder={searchPlaceholder ?? "Search"}
            />
          )}
        </DrawerContent>
      </Drawer>
    );
  },
);
ComboBoxForm.displayName = "ComboBoxForm";

type OptionsListProps = {
  field?: { value?: string };
  options: Option[];
  setOpen?: (open: boolean) => void;
  onSelect: (option: Option | null) => void;
  withSearch?: boolean;
  closeOnSelect?: boolean;
  searchPlaceholder?: string;
};

function OptionsList({
  field,
  options,
  setOpen,
  onSelect,
  withSearch = true,
  closeOnSelect = true,
  searchPlaceholder = "Search...",
}: OptionsListProps) {
  return (
    <Command>
      {withSearch && <CommandInput placeholder={searchPlaceholder} />}
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup>
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={option.label}
              onSelect={(value) => {
                onSelect(
                  options.find((option) => option.label === value) || null,
                );
                if (closeOnSelect) {
                  setOpen?.(false);
                }
              }}
              keywords={option.keywords}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4",
                  option.value === field?.value ? "opacity-100" : "opacity-0",
                )}
              />
              {option.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

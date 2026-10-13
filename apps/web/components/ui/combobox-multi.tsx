"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { forwardRef, useMemo, useState } from "react";

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
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/utils/useMediaQuery";

type Option = {
  label: string;
  value: string;
  disabled?: boolean;
  customRender?: React.ReactNode;
};

type InternalOption = Option & { selected: boolean };

type Props = {
  options?: Option[];
  onSelect: (options: Option[] | null) => void;
  defaultValue?: string[];
  withSearch?: boolean;
  closeOnSelect?: boolean;
  placeholder?: string;
  className?: string;
};

/**
 * Selection is the only thing this control owns; the option list belongs to the
 * caller and is derived on every render.
 *
 * Freezing `options` in a `useState` initializer looked equivalent and was not:
 * callers that build their options from loaded data (the transaction-type
 * filter maps over the fetched transactions) mount with an empty array, so the
 * list stayed empty for the lifetime of the component and the popover opened as
 * an empty 2px sliver — RAD-607.
 */
function useSelection(
  initialOptions: Option[],
  defaultValue: string[],
  onSelect: (options: Option[] | null) => void,
  closeOnSelect: boolean,
  setOpen: (open: boolean) => void,
) {
  const [selectedValues, setSelectedValues] = useState<string[]>(
    () => defaultValue,
  );

  const options: InternalOption[] = useMemo(
    () =>
      initialOptions.map((option) => ({
        ...option,
        selected: selectedValues.includes(option.value),
      })),
    [initialOptions, selectedValues],
  );

  const onSelectInternalHandler = (selectedOption: Option | null) => {
    if (!selectedOption) return;

    // "__all__" is a reset row: picking it clears the selection, and picking
    // anything else drops it.
    const nextValues =
      selectedOption.value === "__all__"
        ? []
        : selectedValues.includes(selectedOption.value)
          ? selectedValues.filter((value) => value !== selectedOption.value)
          : [
              ...selectedValues.filter((value) => value !== "__all__"),
              selectedOption.value,
            ];

    setSelectedValues(nextValues);
    onSelect(initialOptions.filter((o) => nextValues.includes(o.value)));

    if (closeOnSelect) {
      setOpen(false);
    }
  };

  return {
    options,
    selectedOptions: options.filter((o) => o.selected),
    onSelectInternalHandler,
  };
}

export function ComboBoxMulti({
  options: initialOptions = [],
  onSelect,
  defaultValue = [],
  withSearch = true,
  closeOnSelect = true,
  placeholder,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const { options, selectedOptions, onSelectInternalHandler } = useSelection(
    initialOptions,
    defaultValue,
    onSelect,
    closeOnSelect,
    setOpen,
  );

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            role="combobox"
            className={cn("w-50 justify-between", className)}
          >
            <span className="truncate">
              {selectedOptions.length === 0 &&
                (placeholder ?? "Select an option")}
              {selectedOptions.length === 1 && selectedOptions[0].label}
              {selectedOptions.length === 2 &&
                selectedOptions.map(({ label }) => label).join(", ")}
              {selectedOptions.length > 2 &&
                `${selectedOptions.length} labels selected`}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) min-w-50 p-0"
          align="start"
        >
          <OptionsList
            options={options}
            setOpen={setOpen}
            onSelect={onSelectInternalHandler}
            withSearch={withSearch}
            closeOnSelect={closeOnSelect}
          />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant="secondary"
          role="combobox"
          className={cn("w-50 justify-start", className)}
        >
          <span className="truncate">
            {selectedOptions.length === 0 &&
              (placeholder ?? "Select an option")}
            {selectedOptions.length === 1 && selectedOptions[0].label}
            {selectedOptions.length === 2 &&
              selectedOptions.map(({ label }) => label).join(", ")}
            {selectedOptions.length > 2 &&
              `${selectedOptions.length} labels selected`}
          </span>
        </Button>
      </DrawerTrigger>
      <DrawerContent className="p-2">
        <DrawerTitle>{placeholder ?? "Select an option"}</DrawerTitle>
        <div className="mt-4 border-t">
          <OptionsList
            options={options}
            setOpen={setOpen}
            onSelect={onSelectInternalHandler}
            withSearch={withSearch}
            closeOnSelect={closeOnSelect}
          />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

type WithFormFieldProps = Props & {
  placeholder?: string;
  field?: { value?: string[] };
  onSelect: (value: Option[] | null) => void;
};

export const MultiComboBoxForm = forwardRef<
  HTMLButtonElement,
  WithFormFieldProps
>(
  (
    {
      field,
      onSelect,
      placeholder,
      options: initialOptions = [],
      defaultValue = [],
      closeOnSelect,
      withSearch,
      className,
    },
    ref,
  ) => {
    const [open, setOpen] = useState(false);
    const isDesktop = useMediaQuery("(min-width: 768px)");
    const initialSelection = useMemo(
      () => [...new Set([...defaultValue, ...(field?.value ?? [])])],
      // The form field's value is the caller's source of truth on mount only;
      // afterwards this control owns the selection and reports it upward.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );
    const { options, selectedOptions, onSelectInternalHandler } = useSelection(
      initialOptions,
      initialSelection,
      onSelect,
      closeOnSelect ?? true,
      setOpen,
    );

    if (isDesktop) {
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              className={cn("min-w-50 justify-between", className)}
            >
              <span className="truncate">
                {selectedOptions.length === 0 &&
                  (placeholder ?? "Select an option")}
                {selectedOptions.length === 1 && selectedOptions[0].label}
                {selectedOptions.length === 2 &&
                  selectedOptions.map(({ label }) => label).join(", ")}
                {selectedOptions.length > 2 &&
                  `${selectedOptions.length} labels selected`}
              </span>
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-(--radix-popover-trigger-width) min-w-50 p-0"
            align="start"
          >
            <OptionsList
              options={options}
              setOpen={setOpen}
              onSelect={onSelectInternalHandler}
              withSearch={withSearch}
              closeOnSelect={closeOnSelect}
            />
          </PopoverContent>
        </Popover>
      );
    }

    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className={cn("min-w-50 justify-start", className)}
          >
            <span className="truncate">
              {selectedOptions.length === 0 &&
                (placeholder ?? "Select an option")}
              {selectedOptions.length === 1 && selectedOptions[0].label}
              {selectedOptions.length === 2 &&
                selectedOptions.map(({ label }) => label).join(", ")}
              {selectedOptions.length > 2 &&
                `${selectedOptions.length} labels selected`}
            </span>
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <div className="mt-4 border-t">
            <OptionsList
              options={options}
              setOpen={setOpen}
              onSelect={onSelectInternalHandler}
              withSearch={withSearch}
              closeOnSelect={closeOnSelect}
            />
          </div>
        </DrawerContent>
      </Drawer>
    );
  },
);
MultiComboBoxForm.displayName = "MultiComboBoxForm";

type OptionsListProps = {
  options: InternalOption[];
  setOpen?: (open: boolean) => void;
  onSelect: (option: Option | null) => void;
  withSearch?: boolean;
  closeOnSelect?: boolean;
};

function OptionsList({
  options,
  setOpen,
  onSelect,
  withSearch = true,
  closeOnSelect = true,
}: OptionsListProps) {
  const t = useTranslations();

  // An options list that is empty because the caller has nothing to offer still
  // has to say so. Rendering nothing left the popover as a bare sliver, which
  // reads as a broken control rather than as "no types to filter by yet".
  if (options.length === 0) {
    return (
      <p className="text-muted-foreground px-3 py-4 text-sm">
        {t("no-options-available")}
      </p>
    );
  }

  return (
    <Command>
      {withSearch && <CommandInput placeholder={t("search")} />}
      <CommandList>
        <CommandEmpty>{t("no-results-found")}</CommandEmpty>
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
              disabled={option.disabled}
            >
              <Check
                className={cn(
                  "mr-2 h-4 w-4",
                  option.selected ? "opacity-100" : "opacity-0",
                )}
              />
              {option.customRender ?? option.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

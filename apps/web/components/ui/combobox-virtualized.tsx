"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, ChevronsUpDown } from "lucide-react";
import Image from "next/image";
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
import Text from "@/components/ui/Typography/Text";
import { cn } from "@/lib/utils";

type Option = {
  value: string;
  label: string;
  icon?: string;
};

interface VirtualizedCommandProps {
  // height: string;
  options: Option[];
  placeholder: string;
  selectedOption: string;
  onSelectOption?: (option: string) => void;
}

const VirtualizedCommand = ({
  // height,
  options,
  placeholder,
  selectedOption,
  onSelectOption,
}: VirtualizedCommandProps) => {
  const parentRef = React.useRef(null);
  const [inputValue, setInputValue] = React.useState(``);
  const filteredOptions = React.useMemo(
    () =>
      options.filter((option) =>
        option.label.toLowerCase().includes(inputValue.toLowerCase() ?? []),
      ),
    [inputValue, options],
  );

  const virtualizer = useVirtualizer({
    count: filteredOptions.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35,
    overscan: 5,
  });

  const virtualOptions = virtualizer.getVirtualItems();

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
    }
  };

  return (
    <Command shouldFilter={false} onKeyDown={handleKeyDown}>
      <CommandInput
        value={inputValue}
        onValueChange={setInputValue}
        placeholder={placeholder}
      />
      <CommandEmpty>No item found.</CommandEmpty>
      <CommandGroup
        style={{
          // height: height,
          width: "100%",
          overflow: "auto",
        }}
      >
        <CommandList ref={parentRef}>
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualOptions.map((virtualOption, i) => (
              <CommandItem
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualOption.size}px`,
                  transform: `translateY(${virtualOption.start}px)`,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                key={filteredOptions[virtualOption.index].value}
                value={filteredOptions[virtualOption.index].value}
                onSelect={onSelectOption}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    selectedOption ===
                      filteredOptions[virtualOption.index].value
                      ? "opacity-100"
                      : "opacity-0",
                  )}
                />
                {filteredOptions[virtualOption.index].icon && (
                  <Image
                    src={filteredOptions[virtualOption.index].icon!}
                    alt={filteredOptions[virtualOption.index].label}
                    className="mr-2 size-4"
                    width={8}
                    height={8}
                  />
                )}
                {filteredOptions[virtualOption.index].label}
              </CommandItem>
            ))}
          </div>
        </CommandList>
      </CommandGroup>
    </Command>
  );
};

interface VirtualizedComboboxProps {
  options: Option[];
  searchPlaceholder?: string;
  width?: string;
  height?: string;
  onSelectOption?: (option: string) => void;
  className?: string;
}

export function VirtualizedCombobox({
  options,
  searchPlaceholder = "Search items...",
  onSelectOption,
  className,
  // height = "400px",
}: VirtualizedComboboxProps) {
  const [open, setOpen] = React.useState<boolean>(false);
  const [selectedOption, setSelectedOption] = React.useState<string>("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="input"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
        >
          {selectedOption ? (
            options.find((option) => option.value === selectedOption)?.label
          ) : (
            <Text variant="mutedText">{searchPlaceholder}</Text>
          )}
          <ChevronsUpDown className="text-muted-foreground ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-110 p-0"
        align="start"
        style={{
          width: "var(--radix-popover-trigger-width)",
        }}
      >
        <VirtualizedCommand
          // height={height}
          options={options}
          placeholder={searchPlaceholder}
          selectedOption={selectedOption}
          onSelectOption={(currentValue) => {
            setSelectedOption(
              currentValue === selectedOption ? "" : currentValue,
            );
            onSelectOption?.(currentValue);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

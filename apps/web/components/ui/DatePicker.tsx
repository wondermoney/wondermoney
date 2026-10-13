"use client";

import { CalendarIcon } from "lucide-react";
import { useLocale,useTranslations } from "next-intl";
import { useState } from "react";
import type { Matcher } from "react-day-picker";

import { Calendar } from "@/components/ui/Calendar";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { FormControl } from "./Form";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

interface DatePickerProps {
  value?: Date;
  onSelect: (date: Date | undefined) => void;
  disabled?: Matcher | Matcher[];
  form?: boolean;
  placeholder?: string;
  inModal?: boolean;
}

const DatePicker: React.FC<DatePickerProps> = ({
  value,
  onSelect,
  disabled,
  form,
  placeholder,
  inModal = false,
}) => {
  const t = useTranslations();
  // RAD-575 — the reader's calendar, not the runtime's.
  const locale = useLocale();
  const [open, setOpen] = useState(false);

  const buttonElement = (
    <Button
      type="button"
      variant="input"
      className={cn(
        "min-w-[200px] justify-start text-left font-normal",
        !value && "text-muted-foreground",
      )}
    >
      <CalendarIcon className="mr-2 size-4" />
      {value ? (
        new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value)
      ) : (
        <span>{placeholder ?? t("pick-date")}</span>
      )}
    </Button>
  );

  return (
    <Popover modal={inModal} open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {form ? <FormControl>{buttonElement}</FormControl> : buttonElement}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(date) => {
            onSelect(date);
            setOpen(false);
          }}
          disabled={disabled}
          startMonth={new Date(2000, 0, 1)}
          endMonth={new Date(2100, 11, 31)}
        />
      </PopoverContent>
    </Popover>
  );
};

export default DatePicker;

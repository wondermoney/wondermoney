import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { DayPicker, type DropdownProps } from "react-day-picker";

import { cn } from "@/lib/utils";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const defaultStartMonth = props.startMonth ?? new Date(2000, 0, 1);
  const defaultEndMonth = props.endMonth ?? new Date(2100, 11, 31);
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout="dropdown"
      navLayout="after"
      startMonth={defaultStartMonth}
      endMonth={defaultEndMonth}
      className={cn("p-3", className)}
      classNames={{
        months: "relative flex flex-col gap-4 sm:flex-row",
        month: "flex flex-col gap-4",
        month_caption: "flex h-8 items-center justify-center px-8",
        nav: "pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-1",
        button_next: cn(
          "pointer-events-auto size-8 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        button_previous: cn(
          "pointer-events-auto size-8 bg-transparent p-0 opacity-50 hover:opacity-100",
        ),
        dropdowns:
          "flex h-8 w-full items-center justify-center gap-1.5 text-sm font-medium",
        chevron: "size-4",
        months_dropdown: "min-w-[8.25rem]",
        years_dropdown: "min-w-[6.5rem]",
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday:
          "text-muted-foreground flex-1 rounded-md font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: cn(
          "relative flex-1 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md",
        ),
        day_button: cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground",
          "h-8 w-full p-0 font-normal aria-selected:opacity-100",
        ),
        range_start: "day-range-start",
        range_end: "day-range-end",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside:
          "day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Dropdown: ({
          className: dropdownClassName,
          classNames: _classNames,
          components: _components,
          options,
          ...selectProps
        }: DropdownProps) => (
          <span className="relative inline-flex items-center">
            <select
              className={cn(
                "border-input bg-background text-foreground focus-visible:border-ring focus-visible:ring-ring/50 hover:bg-accent h-8 cursor-pointer appearance-none rounded-md border py-0 pr-8 pl-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
                dropdownClassName,
              )}
              {...selectProps}
            >
              {options?.map(({ disabled, label, value }) => (
                <option key={value} value={value} disabled={disabled}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown className="text-muted-foreground pointer-events-none absolute right-2 size-4" />
          </span>
        ),
        Chevron: ({ className: iconClassName, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeft className={cn("size-4", iconClassName)} {...props} />
            );
          }
          if (orientation === "right") {
            return (
              <ChevronRight
                className={cn("size-4", iconClassName)}
                {...props}
              />
            );
          }
          return (
            <ChevronDown className={cn("size-4", iconClassName)} {...props} />
          );
        },
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };

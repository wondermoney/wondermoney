"use client";

import { Amount } from "@/components/ui/Amount";
import { cn } from "@/lib/utils";

export interface LinkOption {
  key: string;
  /** What the person reads first: a transaction's description, or the plan and installment. */
  title: string;
  /** The day it posted or is scheduled, already formatted. */
  date: string;
  amount: number;
  /** How its amount differs from the one it should match, in words; null when they agree. */
  note?: string | null;
}

/**
 * The choices of a manual installment link, as a radio group: each with its date, its amount and,
 * when it is not the expected amount, by how much it differs (in words, never a color alone).
 */
export function LinkOptionList({
  name,
  label,
  options,
  currency,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: readonly LinkOption[];
  currency: string;
  value: string | null;
  onChange: (key: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{label}</legend>
      <ul className="border-border divide-border max-h-80 divide-y overflow-y-auto border-y">
        {options.map((option) => {
          const checked = option.key === value;
          return (
            <li key={option.key}>
              <label
                className={cn(
                  "hover:bg-accent flex min-h-11 cursor-pointer items-center gap-3 px-2 py-2",
                  checked && "bg-primary/10",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={option.key}
                  checked={checked}
                  onChange={() => onChange(option.key)}
                  className="accent-primary size-4 shrink-0"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-foreground truncate text-sm">
                    {option.title}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    <span className="font-mono tabular-nums">
                      {option.date}
                    </span>
                    {option.note ? <> · {option.note}</> : null}
                  </span>
                </span>
                <Amount
                  value={option.amount}
                  currency={currency}
                  className="text-foreground shrink-0 text-sm"
                />
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

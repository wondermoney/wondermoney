"use client";

import { useTranslations } from "next-intl";

import type { GrantableHouseholdRole } from "@/lib/api/household/types";
import { cn } from "@/lib/utils";

/** The roles a manager may grant, as a radio group: each with what it lets the person do. */
export function HouseholdRolePicker({
  name,
  legend,
  roles,
  value,
  onChange,
  disabled,
}: {
  name: string;
  legend: string;
  roles: readonly GrantableHouseholdRole[];
  value: GrantableHouseholdRole;
  onChange: (role: GrantableHouseholdRole) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("household");
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <ul className="divide-border divide-y rounded-md border">
        {roles.map((role) => {
          const checked = role === value;
          return (
            <li key={role}>
              <label
                className={cn(
                  "hover:bg-accent flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2",
                  checked && "bg-primary/10",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={role}
                  checked={checked}
                  onChange={() => onChange(role)}
                  className="accent-primary mt-0.5 size-4 shrink-0"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-foreground text-sm font-medium">
                    {t(`roles.${role}`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t(`roleDescriptions.${role}`)}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

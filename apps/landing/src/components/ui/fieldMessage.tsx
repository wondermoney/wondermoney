import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The line under a field, one size for every field on the site (12px, the size of the
 * calculators' help lines and notes): `help` in muted ink, `error` in `destructive-text` (never
 * the `destructive` fill, which is tuned for a background), and `status` in ink for a loading
 * or progress note.
 */
export const fieldMessageClass = {
  help: "text-xs text-muted-foreground",
  error: "text-xs text-destructive-text",
  status: "text-xs text-foreground",
} as const;

export type FieldMessageTone = keyof typeof fieldMessageClass;

export type FieldMessageProps = React.HTMLAttributes<HTMLParagraphElement> & {
  /** `help` by default. */
  tone?: FieldMessageTone;
};

/**
 * A help, error or status line under a field. Tie it to the field with the field's
 * `aria-describedby` and this `id`; a field with an error also sets `aria-invalid`, which draws
 * its border in the same token. `className` is for layout only (an indent under a checkbox);
 * `fieldMessageUsage.test.ts` fails on a field message drawn as a raw `<p>` elsewhere.
 */
const FieldMessage = React.forwardRef<HTMLParagraphElement, FieldMessageProps>(
  ({ tone = "help", className, ...props }, ref) => (
    <p ref={ref} className={cn(fieldMessageClass[tone], className)} {...props} />
  ),
);
FieldMessage.displayName = "FieldMessage";

export { FieldMessage };

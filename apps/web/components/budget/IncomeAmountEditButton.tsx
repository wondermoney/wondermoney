import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IncomeAmountEditButtonProps = {
  /** Ties the row's visible `<label>` to a real, labelable control. */
  id: string;
  /**
   * The whole accessible name, already translated and already composed: what
   * activating this does, to which income source, and for how much. Composed
   * by the caller from one ICU message per locale so the word order is the
   * translator's to choose, not a concatenation's.
   */
  label: string;
  /**
   * Rendered exactly as the old field rendered it — the raw figure the user
   * typed, not a formatted one — so the row is visually unchanged. The
   * locale-formatted amount lives in `label`, where a screen reader can use it.
   */
  amount: number | string;
  className?: string;
  onClick: () => void;
};

/**
 * The amount on a budget-wizard income row.
 *
 * Not a `readOnly` `<Input>` with an `onClick` handler: that is focusable, so
 * it looks reachable, but an input does nothing on Enter or Space — the edit
 * dialog behind it would be mouse-only, and editing is the only way to correct
 * a mistyped amount on this step. A screen reader would announce it as an
 * editable text field that refuses to be edited, with nothing saying that
 * activating it opens a dialog.
 *
 * It is a real `<button>`, through the Button primitive like the add-income
 * control, so it inherits the standard focus ring, press
 * feedback and disabled handling. `variant="input"` is the primitive's
 * form-control surface — the same one the comboboxes and the date picker render
 * through — so at rest it is the field it replaces, border and all.
 */
export function IncomeAmountEditButton({
  id,
  label,
  amount,
  className,
  onClick,
}: IncomeAmountEditButtonProps) {
  return (
    <Button
      id={id}
      type="button"
      variant="input"
      aria-haspopup="dialog"
      aria-label={label}
      onClick={onClick}
      className={cn(
        // `h-auto min-h-11` rather than the primitive's `h-10`: 44px is this
        // step's touch floor, matching the add-income control beneath
        // these rows. `justify-start` and `px-0` undo the primitive's centred,
        // padded label so the glyph and the figure sit where the field put them.
        "h-auto min-h-11 justify-start gap-0 px-0 py-2 text-sm font-normal",
        className,
      )}
    >
      {/* The old field's start adornment, reproduced: `pl-4` on its wrapper
          plus `px-4` on the glyph. Decorative here — the accessible name
          carries the currency, formatted for the reader's locale. */}
      <span
        aria-hidden="true"
        className="text-muted-foreground pr-4 pl-8 font-normal"
      >
        €
      </span>
      <span className="truncate text-left tabular-nums">{amount}</span>
    </Button>
  );
}

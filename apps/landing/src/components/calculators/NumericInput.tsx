import { useState, type InputHTMLAttributes, type KeyboardEvent } from "react";
import {
  formatNumericInput,
  isNumericDraft,
  parseNumericInput,
  separatorOf,
  stepNumericValue,
} from "@/lib/calculators/numericInput";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step" | "inputMode"
> & {
  /** NaN while the field is empty or holds a partial entry such as "-" or "3,". */
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

/**
 * A number field that keeps the text the visitor types. The parent gets a number on every
 * edit (NaN while the text is not one yet) and the text changes from `value` only when the
 * parent sets something other than what was typed: a preset, a clamp, a reset.
 *
 * It is a text input rather than type="number", so a comma works as the decimal separator and
 * no browser rewrites a partial entry; the arrow keys still step by `step` within min and max.
 */
export default function NumericInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  onBlur,
  onKeyDown,
  ...rest
}: Props) {
  const [text, setText] = useState(() => formatNumericInput(value));
  // The number `text` stands for. When `value` moves away from it, the parent changed the
  // value itself and the field shows the new one.
  const [shown, setShown] = useState(value);
  if (!Object.is(value, shown)) {
    setShown(value);
    setText(formatNumericInput(value, separatorOf(text)));
  }

  const show = (nextText: string, nextValue: number) => {
    setText(nextText);
    setShown(nextValue);
    if (!Object.is(nextValue, value)) onChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = stepNumericValue(shown, event.key === "ArrowUp" ? 1 : -1, { min, max, step });
    show(formatNumericInput(next, separatorOf(text)), next);
  };

  return (
    <input
      {...rest}
      type="text"
      // A minus sign is missing from some decimal keypads (iOS), so a field that takes
      // negative numbers gets the full keyboard.
      inputMode={min !== undefined && min >= 0 ? "decimal" : "text"}
      autoComplete="off"
      role="spinbutton"
      aria-valuenow={Number.isFinite(shown) ? shown : undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      value={text}
      onChange={(event) => {
        const nextText = event.target.value;
        if (!isNumericDraft(nextText)) return;
        show(nextText, parseNumericInput(nextText));
      }}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        // Tidy what was left behind ("3." to "3", "-" to empty), keeping the visitor's
        // decimal mark.
        setText(formatNumericInput(shown, separatorOf(text)));
        onBlur?.(event);
      }}
    />
  );
}

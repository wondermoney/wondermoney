import NumericInput from "./NumericInput";
import { FieldMessage } from "@/components/ui/fieldMessage";

interface Props {
  label: string;
  /** NaN shows an empty field. */
  value: number;
  /** Called with NaN while the field is empty or holds a partial entry such as "-". */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  prefix?: string;
  helpText?: string;
  /** A validation message; marks the field invalid and is announced with it. */
  error?: string;
  id: string;
}

export default function CalculatorInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  prefix,
  helpText,
  error,
  id,
}: Props) {
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <NumericInput
        id={id}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        prefix={prefix}
        suffix={suffix}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error && (
        <FieldMessage tone="error" id={errorId}>
          {error}
        </FieldMessage>
      )}
      {helpText && (
        <FieldMessage id={helpId}>{helpText}</FieldMessage>
      )}
    </div>
  );
}

import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number;
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
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          min={min}
          max={max}
          step={step}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "w-full rounded-lg border border-input px-3 py-2.5 font-mono text-sm",
            "focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring",
            "transition-colors",
            prefix && "pl-8",
            suffix && "pr-12",
            error && "border-destructive-text"
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={errorId} className="text-xs text-destructive-text">
          {error}
        </p>
      )}
      {helpText && (
        <p id={helpId} className="text-xs text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
}

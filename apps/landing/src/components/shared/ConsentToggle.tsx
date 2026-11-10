type ConsentToggleProps = {
  readonly checked: boolean;
  readonly label: string;
  readonly description: string;
  readonly onChange: (checked: boolean) => void;
};

export function ConsentToggle({
  checked,
  label,
  description,
  onChange,
}: ConsentToggleProps) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border p-3 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      <input
        className="mt-1 h-5 w-5 accent-primary"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

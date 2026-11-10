import { measureGeometry } from "@/lib/home/month-overview";
import { cn } from "@/lib/utils";

/**
 * The signature mark of this home: one amount against its plan, on a scale
 * shared with its neighbours. The track is the plan, the fill is spending
 * within it, a dark tick marks where the plan ends, and spending past it is
 * hatched. The hatching and the tick are the non-colour cues; the over-plan
 * amount is always printed beside it as well.
 */
export function Measure({
  spent,
  planned,
  scaleMax,
  label,
  className,
}: {
  spent: number;
  planned: number;
  scaleMax: number;
  /** Read out in place of the drawing. */
  label: string;
  className?: string;
}) {
  const { plan, fill, over } = measureGeometry(spent, planned, scaleMax);

  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative block h-2.5 min-w-16", className)}
    >
      <span
        className="bg-border absolute inset-y-0 left-0 rounded-sm"
        style={{ width: `${plan}%` }}
      />
      <span
        className="bg-chart-1 absolute inset-y-0 left-0 rounded-l-sm"
        style={{ width: `${fill}%` }}
      />
      {over > 0 ? (
        <span
          data-over
          className="ring-destructive-text absolute inset-y-0 rounded-r-sm bg-[repeating-linear-gradient(135deg,var(--destructive-text)_0_3px,transparent_3px_6px)] ring-1 ring-inset"
          style={{ left: `${plan}%`, width: `${over}%` }}
        />
      ) : null}
      {plan > 0 ? (
        <span
          className="bg-foreground absolute -inset-y-1 w-0.5 -translate-x-1/2"
          style={{ left: `${plan}%` }}
        />
      ) : null}
    </span>
  );
}

/**
 * Recharts for the landing site, with one default changed: series draw at once instead of
 * animating in. An entry animation replays on every input change, so a calculator's chart
 * could be caught half-drawn (#612), and DESIGN.md keeps motion to micro-interactions.
 *
 * Import every chart part from here, never from "recharts" (ESLint rejects it), so a new
 * chart gets this default too. A chart that should animate can still pass `isAnimationActive`.
 */
import {
  Area as RechartsArea,
  Bar as RechartsBar,
  Line as RechartsLine,
  Pie as RechartsPie,
  type AreaProps,
  type BarProps,
  type LineProps,
  type PieProps,
} from "recharts";

// The rest of Recharts as is; the series below take the place of its own.
export * from "recharts";

export function Line(props: LineProps) {
  return <RechartsLine isAnimationActive={false} {...props} />;
}

// Recharts gives Area's props no default type arguments; these are the ones Line and Bar default to.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Area(props: AreaProps<any, any>) {
  return <RechartsArea isAnimationActive={false} {...props} />;
}

export function Bar(props: BarProps) {
  return <RechartsBar isAnimationActive={false} {...props} />;
}

export function Pie(props: PieProps) {
  return <RechartsPie isAnimationActive={false} {...props} />;
}

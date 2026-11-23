import type { FuelType } from "@/lib/calculators/fuelCost";

/**
 * One colour per fuel, wherever the fuel prices page draws it: the fuel chips, the price badges,
 * the map markers and the price chart. Tokens `--fuel-*` in globals.css, recorded in DESIGN.md.
 * Literal class names, so Tailwind finds them; the fuel's name always goes with the colour.
 */
export const FUEL_COLOR_CLASSES: Record<FuelType, { fill: string; text: string; tint: string; border: string }> = {
  diesel: { fill: "bg-fuel-diesel", text: "text-fuel-diesel", tint: "bg-fuel-diesel/10", border: "border-fuel-diesel" },
  gasoline95: {
    fill: "bg-fuel-gasoline95",
    text: "text-fuel-gasoline95",
    tint: "bg-fuel-gasoline95/10",
    border: "border-fuel-gasoline95",
  },
  lpg: { fill: "bg-fuel-lpg", text: "text-fuel-lpg", tint: "bg-fuel-lpg/10", border: "border-fuel-lpg" },
};

/** The fuel's colour as a CSS value, for inline styles, charts and map markers. */
export const fuelColor = (fuel: FuelType) => `oklch(var(--fuel-${fuel}))`;

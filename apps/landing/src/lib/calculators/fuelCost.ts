import { FUEL_PRICES, FUEL_PRICES_SOURCE, type FuelPriceRow } from "./data/fuelPrices";

export { FUEL_PRICES, FUEL_PRICES_SOURCE };

export const FUEL_TYPES = ["diesel", "gasoline95", "lpg"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
const COLUMN: Record<FuelType, 1 | 2 | 3> = { diesel: 1, gasoline95: 2, lpg: 3 };

export type DistancePeriod = "trip" | "week" | "month";

export const FUEL_COST_LIMITS = {
  distance: 100_000,
  consumption: 40,
  price: 10,
  tripsPerMonth: 1_000,
} as const;
const WEEKS_PER_MONTH = 52 / 12;

export type FuelCostInput = {
  fuel: FuelType;
  /** Kilometres in the period chosen below. */
  distance: number;
  period: DistancePeriod;
  /** Only used when the period is "trip". */
  tripsPerMonth: number;
  /** Litres per 100 km. */
  consumption: number;
  /** Euro per litre. */
  price: number;
};
export type FuelCostField = "distance" | "tripsPerMonth" | "consumption" | "price";
type FieldError = "required" | "negative" | "tooLarge" | "zero" | "notWhole";

/** Worked example: 800 km a month in a diesel car using 5.5 L/100 km, at the latest average. */
export function fuelCostExample(): FuelCostInput {
  return {
    fuel: "diesel",
    distance: 800,
    period: "month",
    tripsPerMonth: 20,
    consumption: 5.5,
    price: latestFuelPrice("diesel"),
  };
}

/** The newest price of a fuel, in euro per litre. */
export function latestFuelPrice(fuel: FuelType, rows: readonly FuelPriceRow[] = FUEL_PRICES): number {
  return rows[rows.length - 1][COLUMN[fuel]] as number;
}

export type FuelPriceSummary = {
  fuel: FuelType;
  date: string;
  price: number;
  /** The price a week earlier (the previous row). */
  previousDate: string;
  previous: number;
  /** Euro per litre, latest minus a week earlier. */
  change: number;
  /** Percent. */
  changePercent: number;
};

/** Latest price per fuel with the week-on-week change. Needs at least two rows. */
export function fuelPriceSummaries(rows: readonly FuelPriceRow[] = FUEL_PRICES): FuelPriceSummary[] {
  if (rows.length < 2) throw new Error("Need two weeks of prices");
  const last = rows[rows.length - 1];
  const before = rows[rows.length - 2];
  return FUEL_TYPES.map((fuel) => {
    const price = last[COLUMN[fuel]] as number;
    const previous = before[COLUMN[fuel]] as number;
    return {
      fuel,
      date: last[0],
      price,
      previousDate: before[0],
      previous,
      change: Math.round((price - previous) * 1000) / 1000,
      changePercent: (price / previous - 1) * 100,
    };
  });
}

export type FuelSeriesPoint = {
  date: string;
  diesel: number;
  gasoline95: number;
  lpg: number;
};

export function fuelPriceSeries(rows: readonly FuelPriceRow[] = FUEL_PRICES): FuelSeriesPoint[] {
  return rows.map(([date, diesel, gasoline95, lpg]) => ({
    date,
    diesel,
    gasoline95,
    lpg,
  }));
}

export type FuelCostResult = {
  /** Kilometres driven in a month. */
  monthlyKm: number;
  monthlyLitres: number;
  /** Cost of the distance entered (a trip, a week or a month). */
  cost: number;
  litres: number;
  monthly: number;
  yearly: number;
  perKm: number;
  per100Km: number;
};

export type FuelCostOutcome =
  | { ok: true; result: FuelCostResult }
  | { ok: false; errors: Partial<Record<FuelCostField, FieldError>> };

const cents = (value: number) => Math.round(value * 100) / 100;

export function computeFuelCost(input: FuelCostInput): FuelCostOutcome {
  const errors: Partial<Record<FuelCostField, FieldError>> = {};
  const check = (field: FuelCostField, { allowZero }: { allowZero: boolean }) => {
    const value = input[field];
    if (!Number.isFinite(value)) errors[field] = "required";
    else if (value < 0) errors[field] = "negative";
    else if (value === 0 && !allowZero) errors[field] = "zero";
    else if (value > FUEL_COST_LIMITS[field]) errors[field] = "tooLarge";
  };
  check("distance", { allowZero: true });
  check("consumption", { allowZero: false });
  check("price", { allowZero: false });
  if (input.period === "trip") {
    check("tripsPerMonth", { allowZero: true });
    if (!errors.tripsPerMonth && !Number.isInteger(input.tripsPerMonth)) errors.tripsPerMonth = "notWhole";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const monthlyKm =
    input.period === "month"
      ? input.distance
      : input.period === "week"
        ? input.distance * WEEKS_PER_MONTH
        : input.distance * input.tripsPerMonth;
  const litres = (input.distance * input.consumption) / 100;
  const monthlyLitres = (monthlyKm * input.consumption) / 100;
  const monthly = cents(monthlyLitres * input.price);
  return {
    ok: true,
    result: {
      monthlyKm,
      monthlyLitres,
      cost: cents(litres * input.price),
      litres,
      monthly,
      yearly: cents(monthlyLitres * input.price * 12),
      perKm: (input.consumption / 100) * input.price,
      per100Km: cents(input.consumption * input.price),
    },
  };
}

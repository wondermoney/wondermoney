import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ELECTRICITY_OFFERS } from "./data/electricityOffers";
import { ERSE_TARIFFS } from "./data/erseTariffs";
import { INDEXED_FORMULAS } from "./data/indexedFormulas";
import { OMIE_MONTHS, OMIE_PRICES_SOURCE } from "./data/omiePrices";
import type { ContractedPowerKva, ElectricityOffer } from "./electricityOfferTypes";
import { compareElectricityOffers, type TariffComparisonInput, type TariffOption } from "./electricityTariffComparison";
import { legalMidnight, QUARTER_HOUR_MS, type PeriodKwh } from "./electricityPeriods";
import { INDEXED_FIXTURE_OFFERS } from "./indexedPricing.fixtures";
import {
  diagramBasis,
  formulaEnergyPrices,
  profileBasis,
  tarEnergyPrices,
  type IndexedFormula,
  type MarketBasis,
  type OmieBucket,
  type OmieMonth,
  type OmieQuarterHours,
} from "./indexedPricing";

const formula = (supplier: string, product?: string) => {
  const found = INDEXED_FORMULAS.find((f) => f.supplier === supplier && (product === undefined || f.product === product));
  if (!found) throw new Error(`No formula for ${supplier}`);
  return found;
};
/** A frozen offer from the 17 November 2026 export (indexedPricing.fixtures.ts). */
const offer = (id: string) => {
  const found = INDEXED_FIXTURE_OFFERS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No fixture offer ${id}`);
  return found;
};

/**
 * A market where OMIE is `price` EUR/MWh in every quarter-hour of every month listed, with the loss
 * factor `loss` and the same consumption weight everywhere.
 */
function flatMarket(price: number, { loss = 1.16, months = ["2026-10"] }: { loss?: number; months?: string[] } = {}): MarketBasis {
  const bucket: OmieBucket = [10, price, price * loss, loss, price, 1000];
  const list: OmieMonth[] = months.map((month) => ({
    month,
    quarters: 3000,
    mean: price,
    daily: [bucket, bucket, bucket],
    weekly: [bucket, bucket, bucket],
  }));
  return { kind: "last12Months", from: months[0], to: months.at(-1)!, months: list };
}

/** The quarter-hour file the page fetches (public/data/omie-pt-quarter-hours.json). */
const QUARTER_HOURS = JSON.parse(
  readFileSync(new URL("../../../public/data/omie-pt-quarter-hours.json", import.meta.url), "utf8"),
) as OmieQuarterHours & { profile: number[] };

const YEAR = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

/**
 * The OMIE figure ERSE priced an indexed offer at, EUR/MWh: the three-month futures average its
 * notes quote ("... próximos 3 meses (0,15201 €/kWh)"), or null when the notes do not give one.
 */
function erseFutures(o: ElectricityOffer): number | null {
  const match = /próximos 3 meses \((\d+,\d+) €\/kWh\)/.exec(o.notes);
  return match ? Number(match[1].replace(",", ".")) * 1000 : null;
}

/** ERSE's energy prices of an offer's option at a power, in the engine's order. */
function ersePrices(o: ElectricityOffer, power: ContractedPowerKva, option: TariffOption): number[] {
  const prices = o.prices[power]!;
  return option === "simple"
    ? [prices.simple!.energy]
    : option === "biHourly"
      ? [prices.biHourly!.offValley, prices.biHourly!.valley]
      : [prices.triHourly!.peak, prices.triHourly!.shoulder, prices.triHourly!.valley];
}

describe("EDP Eletricidade Indexada média: the supplier's published example", () => {
  // edp.pt, "Exemplo ilustrativo": 3,45 kVA, simple tariff, 200 kWh a month, before taxes. OMIE PT at
  // 50, 70 and 155 EUR/MWh gives 37, 42 and 64 EUR a month. EDP publishes them to the euro; the
  // formula (ficha, p. 2) gives each of them over a 30-day month.
  const edp = formula("EDPC");
  const power = offer("EDPC_33").prices[3.45]!.simple!.powerPerDay;

  it("bills the power term as K3 plus the access tariff's power term", () => {
    expect(power).toBeCloseTo(0.1171 + ERSE_TARIFFS.tarPowerPerDay[3.45], 10);
  });

  it.each([
    [50, 37, 37.31],
    [70, 42, 42.43],
    [155, 64, 64.2],
  ])("OMIE %d EUR/MWh: %d EUR a month", (omie, published, exact) => {
    const [energy] = formulaEnergyPrices(edp, flatMarket(omie), 3.45, "simple", "daily")!;
    // (OMIE x 1,164 x 1,10 + 0,0185) + TAR 0,0607 EUR/kWh.
    expect(energy).toBeCloseTo((omie / 1000) * 1.164 * 1.1 + 0.0185 + 0.0607, 12);
    const bill = power * 30 + energy * 200;
    expect(Math.round(bill * 100) / 100).toBe(exact);
    expect(Math.round(bill)).toBe(published);
  });
});

describe("Lógica Base Index S: the supplier's 100 kWh examples", () => {
  // Ficha, p. 4: "Preço Energia Total p/100 kWh (€/mês)" at each power, "calculado utilizando como
  // referência o preço médio do mercado OMIE PT do mês de outubro de 2026", before taxes, a month
  // being 365/12 days. Lógica does not publish the loss factor (FP) it used; with the E-REDES and REN
  // loss profile on the BTN C profile, October 2026 (data/omiePrices.ts as generated on 2026-11-20:
  // OMIE x loss factor 194,0893 EUR/MWh) prices each about 0,10 EUR below.
  const october: OmieBucket = [100, 168.3851, 194.0893, 1.1509, 168.9414, 2980];
  const market: MarketBasis = {
    kind: "last12Months",
    from: "2026-10",
    to: "2026-10",
    months: [{ month: "2026-10", quarters: 2980, mean: 168.9414, daily: [october, october, october], weekly: [october, october, october] }],
  };
  const PUBLISHED: [ContractedPowerKva, number][] = [
    [1.15, 35.99], [2.3, 38.63], [3.45, 40.25], [4.6, 42.68], [5.75, 45.4],
    [6.9, 47.79], [10.35, 55.25], [13.8, 63.29], [17.25, 70.51], [20.7, 78.41],
  ];
  it.each(PUBLISHED)("%d kVA: within 0,15 EUR of %d EUR", (power, published) => {
    const [energy] = formulaEnergyPrices(formula("LOGICA"), market, power, "simple", "daily")!;
    const bill = offer("LOGICA_02").prices[power]!.simple!.powerPerDay * (365 / 12) + 100 * energy;
    expect(Math.abs(bill - published)).toBeLessThan(0.15);
  });

  it("prices the simple option its ficha ticks, and leaves bi-hourly on ERSE's estimate", () => {
    const logica = formula("LOGICA");
    expect(logica.options).toEqual(["simple"]);
    expect(formulaEnergyPrices(logica, flatMarket(152.01), 6.9, "biHourly", "daily")).toBeNull();
    // ERSE's bi-hourly off-valley price is far from anything this formula gives at ERSE's figure.
    const [offValley] = formulaEnergyPrices({ ...logica, options: ["simple", "biHourly"] }, flatMarket(152.01), 6.9, "biHourly", "daily")!;
    expect(offer("LOGICA_02").prices[6.9]!.biHourly!.offValley - offValley).toBeGreaterThan(0.07);
  });
});

// ERSE prices every indexed offer at one OMIE figure, the three-month futures average it quotes in
// each offer's notes. The same formula at that flat price must give ERSE's energy price, to a
// hundredth of a cent per kWh, at every power and option. A formula with a fixed or a monthly loss
// factor can be checked exactly (ERSE's flat year weighs Goldenergy's twelve monthly factors alike).
// A formula on the quarter-hour loss profile cannot: ERSE's figure for it rests on a loss value the
// supplier does not publish, so Galp and Lógica are left out (Lógica is measured against its own
// examples above).
const CHECKABLE = INDEXED_FORMULAS.filter((f) => f.losses.kind !== "profile");
const marketFor = (f: IndexedFormula, omie: number) => flatMarket(omie, { months: f.losses.kind === "monthly" ? YEAR : ["2026-10"] });
function erseCases(offers: readonly ElectricityOffer[]) {
  return CHECKABLE.flatMap((f) =>
    offers
      .filter((o) => f.offerIds.includes(o.id) && erseFutures(o) !== null)
      .flatMap((o) =>
        Object.entries(o.prices).flatMap(([power, prices]) =>
          (["simple", "biHourly", "triHourly"] as const)
            .filter((option) => prices?.[option] !== undefined)
            .map((option) => [o.id, Number(power) as ContractedPowerKva, option, f, o] as const),
        ),
      ),
  );
}
function checkAgainstErse([, power, option, f, o]: ReturnType<typeof erseCases>[number]) {
  const ours = formulaEnergyPrices(f, marketFor(f, erseFutures(o)!), power, option, "daily");
  expect(ours, "the formula covers what ERSE lists").not.toBeNull();
  const erse = ersePrices(o, power, option);
  ours!.forEach((price, index) => expect(Math.abs(price - erse[index])).toBeLessThan(1e-4));
}

describe("the formulas read the way each supplier reported its offer to ERSE (frozen offers)", () => {
  const cases = erseCases(INDEXED_FIXTURE_OFFERS);

  it("reads ERSE's futures figure from the notes, and has an offer of every checkable formula", () => {
    expect(erseFutures(offer("EDPC_33"))).toBeCloseTo(152.01, 9);
    for (const f of CHECKABLE) expect(cases.some(([, , , checked]) => checked === f), f.product).toBe(true);
  });

  it.each(cases)("%s at %d kVA, %s", (...item) => checkAgainstErse(item));

  it("would tell EDP's K1 = 1,10 (média) from 1,08 (Horária) and 1,09 (the gas K1)", () => {
    const edp = formula("EDPC");
    const erse = offer("EDPC_33").prices[6.9]!.simple!.energy;
    for (const k1 of [1.08, 1.09]) {
      const [price] = formulaEnergyPrices({ ...edp, multiplier: k1 }, flatMarket(152.01), 6.9, "simple", "daily")!;
      expect(Math.abs(price - erse)).toBeGreaterThan(1e-3);
    }
  });
});

describe("the formulas against the current snapshot", () => {
  // Whatever mapped offers this week's export still holds, at ERSE's figure in their own notes. None
  // is fine (offers come and go); a failure means a supplier changed its terms: read its documents
  // again and update data/indexedFormulas.ts.
  const cases = erseCases(ELECTRICITY_OFFERS);
  it.skipIf(cases.length === 0).each(cases.length > 0 ? cases : [])("%s at %d kVA, %s", (...item) => checkAgainstErse(item));

  it("maps only indexed offers of the formula's supplier, each to one formula", () => {
    const seen = new Set<string>();
    for (const f of INDEXED_FORMULAS) {
      expect(f.offerIds.length).toBeGreaterThan(0);
      for (const id of f.offerIds) {
        expect(seen.has(id), id).toBe(false);
        seen.add(id);
        const found = ELECTRICITY_OFFERS.find((o) => o.id === id);
        if (!found) continue;
        expect(found.indexed, id).toBe(true);
        expect(found.supplier, id).toBe(f.supplier);
      }
    }
  });
});

describe("the formula data", () => {
  it("cites the supplier's own document for every formula, with the day it was read", () => {
    for (const f of INDEXED_FORMULAS) {
      expect(f.sources.length).toBeGreaterThan(0);
      for (const source of f.sources) {
        const host = new URL(source.url).hostname;
        expect(source.url.startsWith("https://")).toBe(true);
        expect(host).not.toMatch(/tiagofelicia/);
        expect(source.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(source.quote.length).toBeGreaterThan(40);
      }
    }
  });

  it("keeps the profile loss factor to the quarter-hour basis, and monthly factors to twelve months", () => {
    for (const f of INDEXED_FORMULAS) {
      if (f.losses.kind === "profile") expect(f.basis).toBe("quarterHour");
      if (f.losses.kind === "monthly") expect(f.losses.factors).toHaveLength(12);
    }
  });

  it("says whose consumption weighs a quarter-hour formula, and none for the mean bases", () => {
    for (const f of INDEXED_FORMULAS) {
      if (f.basis === "quarterHour") expect(["profile", "actual"]).toContain(f.weighting);
      else expect(f.weighting).toBe("none");
    }
    expect(formula("GALP").weighting).toBe("profile");
  });
});

describe("formulaEnergyPrices", () => {
  const base: IndexedFormula = {
    supplier: "TEST",
    product: "Test",
    offerIds: [],
    basis: "quarterHour",
    weighting: "actual",
    losses: { kind: "fixed", factor: 1 },
    multiplier: 1,
    beforeLosses: 0,
    adder: 0,
    levies: 0,
    tar: "added",
    options: ["simple", "biHourly", "triHourly"],
    sources: [],
  };
  const tar = ERSE_TARIFFS.tarEnergyPerKwh.upTo20_7;
  const bucket = (weight: number, omie: number, loss = 1, mean = omie, quarters = 100): OmieBucket => [weight, omie, omie * loss, loss, mean, quarters];
  const month = (key: string, mean: number, daily: [OmieBucket, OmieBucket, OmieBucket], weekly = daily): OmieMonth => ({
    month: key,
    quarters: 300,
    mean,
    daily,
    weekly,
  });
  const basis = (months: OmieMonth[]): MarketBasis => ({ kind: "last12Months", from: months[0].month, to: months.at(-1)!.month, months });

  it("weights each period's quarter-hour average by consumption, and adds the period's TAR", () => {
    const market = basis([month("2026-01", 0, [bucket(1, 200), bucket(3, 100), bucket(4, 50)])]);
    const tri = formulaEnergyPrices(base, market, 6.9, "triHourly", "daily")!;
    [0.2 + tar.peak, 0.1 + tar.shoulder, 0.05 + tar.triValley].forEach((price, i) => expect(tri[i]).toBeCloseTo(price, 12));
    const [offValley, valley] = formulaEnergyPrices(base, market, 6.9, "biHourly", "daily")!;
    expect(offValley).toBeCloseTo((1 * 0.2 + 3 * 0.1) / 4 + tar.offValley, 12);
    expect(valley).toBeCloseTo(0.05 + tar.valley, 12);
    const [simple] = formulaEnergyPrices(base, market, 6.9, "simple", "daily")!;
    expect(simple).toBeCloseTo((0.2 + 0.3 + 0.2) / 8 + tar.simple, 12);
  });

  it("prices on the visitor's cycle", () => {
    const market = basis([month("2026-01", 0, [bucket(1, 200), bucket(1, 100), bucket(1, 50)], [bucket(1, 300), bucket(1, 100), bucket(1, 50)])]);
    expect(formulaEnergyPrices(base, market, 6.9, "triHourly", "weekly")![0]).toBeCloseTo(0.3 + tar.peak, 12);
  });

  it("applies the quarter-hour loss profile through the weighted OMIE x loss average", () => {
    const profile: IndexedFormula = { ...base, losses: { kind: "profile" }, beforeLosses: 0.01 };
    // OMIE x loss averages to 0,23 EUR/kWh, the loss to 1,15: (0,23 + 0,01 x 1,15).
    const market = basis([month("2026-01", 0, [bucket(1, 200, 1.15), bucket(1, 200, 1.15), bucket(1, 200, 1.15)])]);
    expect(formulaEnergyPrices(profile, market, 3.45, "simple", "daily")![0]).toBeCloseTo(0.23 + 0.0115 + tar.simple, 12);
  });

  it("takes the arithmetic mean of each period, or of the month, when the formula says so", () => {
    // The consumption-weighted price differs from both means.
    const market = basis([month("2026-01", 90, [bucket(1, 999, 1, 120, 100), bucket(1, 999, 1, 60, 300), bucket(1, 999, 1, 80, 400)])]);
    const periodMean: IndexedFormula = { ...base, basis: "periodMean" };
    const [offValley, valley] = formulaEnergyPrices(periodMean, market, 6.9, "biHourly", "daily")!;
    expect(offValley).toBeCloseTo((120 * 100 + 60 * 300) / 400 / 1000 + tar.offValley, 12);
    expect(valley).toBeCloseTo(0.08 + tar.valley, 12);
    const [simple] = formulaEnergyPrices(periodMean, market, 6.9, "simple", "daily")!;
    expect(simple).toBeCloseTo((120 * 100 + 60 * 300 + 80 * 400) / 800 / 1000 + tar.simple, 12);
    const monthMean: IndexedFormula = { ...base, basis: "monthMean" };
    expect(formulaEnergyPrices(monthMean, market, 6.9, "biHourly", "daily")).toEqual([0.09 + tar.offValley, 0.09 + tar.valley]);
  });

  it("uses each calendar month's own loss factor, weighted by the month's consumption", () => {
    const monthly: IndexedFormula = { ...base, basis: "monthMean", losses: { kind: "monthly", factors: [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] } };
    const jan = month("2026-01", 100, [bucket(3, 0), bucket(0, 0), bucket(0, 0)]);
    const feb = month("2026-02", 100, [bucket(1, 0), bucket(0, 0), bucket(0, 0)]);
    expect(formulaEnergyPrices(monthly, basis([jan, feb]), 6.9, "simple", "daily")![0]).toBeCloseTo((3 * 0.15 + 1 * 0.1) / 4 + tar.simple, 12);
  });

  it("applies the floor and the cap to each month, before the levies", () => {
    const limited: IndexedFormula = { ...base, basis: "monthMean", adder: 0.05, limits: { min: 0.14, max: 0.3 }, levies: 0.002 };
    const low = month("2026-01", 20, [bucket(1, 0), bucket(1, 0), bucket(1, 0)]);
    const high = month("2026-02", 400, [bucket(1, 0), bucket(1, 0), bucket(1, 0)]);
    // January: 0,02 + 0,05 is raised to 0,14; February: 0,40 + 0,05 is capped at 0,30.
    expect(formulaEnergyPrices(limited, basis([low, high]), 6.9, "simple", "daily")![0]).toBeCloseTo((0.14 + 0.3) / 2 + 0.002 + tar.simple, 12);
  });

  it("uses the supplier's own per-period terms instead of TAR when they include it, by power band", () => {
    const endesa = formula("END");
    const market = flatMarket(100);
    expect(formulaEnergyPrices(endesa, market, 6.9, "biHourly", "daily")).toEqual([0.1 + 0.127166, 0.1 + 0.072035]);
    expect(formulaEnergyPrices(endesa, market, 41.4, "triHourly", "daily")).toEqual([0.1 + 0.294752, 0.1 + 0.084625, 0.1 + 0.071083]);
    // Bi-hourly is not offered at 2,3 kVA, nor tri-hourly below 10,35 kVA.
    expect(formulaEnergyPrices(endesa, market, 2.3, "biHourly", "daily")).toBeNull();
    expect(formulaEnergyPrices(endesa, market, 6.9, "triHourly", "daily")).toBeNull();
  });

  it("returns null for an option the formula does not cover, or a power TAR has no such option for", () => {
    expect(formulaEnergyPrices(formula("GOLD", "Tarifa Index 04/25"), flatMarket(100), 6.9, "biHourly", "daily")).toBeNull();
    expect(tarEnergyPrices("simple", 27.6)).toBeNull();
    expect(tarEnergyPrices("triHourly", 27.6)).toEqual([0.2457, 0.0524, 0.015]);
  });

  it("keeps a month-mean formula on the month's mean in a period without consumption, on the visitor's cycle", () => {
    const monthMean: IndexedFormula = { ...base, basis: "monthMean", weighting: "none" };
    // No kWh in daily peak hours; the month's mean is 90, the peak hours' own mean 120.
    const market = basis([month("2026-01", 90, [bucket(0, 0, 1, 120), bucket(1, 100), bucket(1, 50)])]);
    expect(formulaEnergyPrices(monthMean, market, 6.9, "triHourly", "daily")![0]).toBeCloseTo(0.09 + tar.peak, 12);
    // A profile-loss formula's fallback takes the loss factor of the visitor's cycle.
    const profileLoss: IndexedFormula = { ...base, losses: { kind: "profile" } };
    const daily: [OmieBucket, OmieBucket, OmieBucket] = [bucket(0, 0, 1, 100), bucket(1, 100, 1.1), bucket(1, 100, 1.1)];
    const weekly: [OmieBucket, OmieBucket, OmieBucket] = [bucket(0, 0, 1, 100), bucket(1, 100, 1.2), bucket(1, 100, 1.2)];
    const cycles = basis([month("2026-01", 100, daily, weekly)]);
    expect(formulaEnergyPrices(profileLoss, cycles, 6.9, "triHourly", "weekly")![0]).toBeCloseTo(0.1 * 1.2 + tar.peak, 12);
    expect(formulaEnergyPrices(profileLoss, cycles, 6.9, "triHourly", "daily")![0]).toBeCloseTo(0.1 * 1.1 + tar.peak, 12);
  });

  it("prices a period without consumption at its plain mean, and gives up without any market price", () => {
    const market = basis([month("2026-01", 0, [bucket(0, 0, 1, 120), bucket(1, 100), bucket(1, 50)])]);
    expect(formulaEnergyPrices(base, market, 6.9, "triHourly", "daily")![0]).toBeCloseTo(0.12 + tar.peak, 12);
    const empty = basis([month("2026-01", 0, [bucket(0, 0, 1, 0, 0), bucket(1, 100), bucket(1, 50)])]);
    expect(formulaEnergyPrices(base, empty, 6.9, "triHourly", "daily")).toBeNull();
  });
});

describe("the committed OMIE months", () => {
  it("are 12 consecutive full months, the last one before the fetch", () => {
    expect(OMIE_MONTHS).toHaveLength(12);
    for (let i = 1; i < OMIE_MONTHS.length; i++) {
      const [y, m] = OMIE_MONTHS[i - 1].month.split("-").map(Number);
      const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
      expect(OMIE_MONTHS[i].month).toBe(next);
    }
    expect(OMIE_MONTHS.at(-1)!.month < OMIE_PRICES_SOURCE.fetchedOn.slice(0, 7)).toBe(true);
    expect(OMIE_PRICES_SOURCE.firstMonth).toBe(OMIE_MONTHS[0].month);
    expect(OMIE_PRICES_SOURCE.lastMonth).toBe(OMIE_MONTHS.at(-1)!.month);
  });

  it("hold plausible prices, weights and loss factors in every period", () => {
    for (const month of OMIE_MONTHS) {
      expect(month.quarters).toBeGreaterThanOrEqual(28 * 96 - 4);
      for (const cycle of [month.daily, month.weekly]) {
        expect(cycle.reduce((sum, b) => sum + b[5], 0)).toBe(month.quarters);
        for (const [weight, omie, omieLoss, loss, mean] of cycle) {
          expect(weight).toBeGreaterThan(0);
          expect(loss).toBeGreaterThan(1.05);
          expect(loss).toBeLessThan(1.3);
          expect(Math.abs(omieLoss - omie * loss)).toBeLessThan(Math.abs(omie) * 0.1 + 5);
          expect(omie).toBeGreaterThan(-50);
          expect(omie).toBeLessThan(1000);
          expect(mean).toBeLessThan(1000);
        }
      }
    }
  });

  it("make a last-12-months basis", () => {
    const basis = profileBasis(OMIE_MONTHS);
    expect(basis.months).toHaveLength(12);
    expect(basis.to).toBe(OMIE_MONTHS.at(-1)!.month);
    expect(basis.kind).toBe("last12Months");
  });

  it("match the quarter-hour file the diagram mode fetches", () => {
    expect(QUARTER_HOURS.omie).toHaveLength(OMIE_MONTHS.reduce((sum, month) => sum + month.quarters, 0));
    expect(QUARTER_HOURS.loss).toHaveLength(QUARTER_HOURS.omie.length);
    expect(QUARTER_HOURS.profile).toHaveLength(QUARTER_HOURS.omie.length);
    const [year, month] = OMIE_MONTHS[0].month.split("-").map(Number);
    expect(Date.parse(QUARTER_HOURS.start)).toBe(legalMidnight(year, month, 1));
    expect(OMIE_PRICES_SOURCE.quarterHoursPath).toBe("/data/omie-pt-quarter-hours.json");
    // Every month's mean, again from the file.
    let offset = 0;
    for (const each of OMIE_MONTHS) {
      const prices = QUARTER_HOURS.omie.slice(offset, offset + each.quarters);
      offset += each.quarters;
      expect(prices.reduce((sum, p) => sum + p, 0) / 100 / each.quarters).toBeCloseTo(each.mean, 2);
    }
  });
});

describe("a profile-billed formula with a consumption file (Galp Plano Flexível)", () => {
  // Galp bills Plano Flexível on the ERSE profile, whatever the meter reads: in July 2026, all the
  // kWh at 13:00 or all at 20:00 cost the same per kWh. A formula on the metered quarter-hours would
  // price them far apart.
  const julyDays = 31;
  const at = (hour: number) =>
    Array.from({ length: julyDays }, (_, day) => ({ start: legalMidnight(2026, 7, day + 1) + hour * 4 * QUARTER_HOUR_MS, kwh: 1 }));
  const galp = formula("GALP");
  const july = profileBasis(OMIE_MONTHS.filter((month) => month.month === "2026-07"), 1);
  const [onProfile] = formulaEnergyPrices(galp, july, 6.9, "simple", "daily")!;

  it.each([13, 20])("all the kWh at %d:00 pay the profile's July price", (hour) => {
    const basis = diagramBasis(at(hour), QUARTER_HOURS)!;
    expect(basis.months.map((month) => month.month)).toEqual(["2026-07"]);
    const [price] = formulaEnergyPrices(galp, basis, 6.9, "simple", "daily")!;
    expect(Math.abs(price - onProfile)).toBeLessThan(1e-4);
  });

  it("while the metered hours would price them apart", () => {
    const actual = { ...galp, weighting: "actual" as const };
    const [noon] = formulaEnergyPrices(actual, diagramBasis(at(13), QUARTER_HOURS)!, 6.9, "simple", "daily")!;
    const [evening] = formulaEnergyPrices(actual, diagramBasis(at(20), QUARTER_HOURS)!, 6.9, "simple", "daily")!;
    expect(evening - noon).toBeGreaterThan(0.05);
    expect(noon).toBeLessThan(onProfile);
    expect(evening).toBeGreaterThan(onProfile);
  });

  it("weighs the months by the file's kWh in each", () => {
    // Two days of July at 1 kWh and one of August at 3 kWh: July's profile price weighs 2, August's 3.
    const readings = [
      { start: legalMidnight(2026, 7, 10), kwh: 1 },
      { start: legalMidnight(2026, 7, 11), kwh: 1 },
      { start: legalMidnight(2026, 8, 10), kwh: 3 },
    ];
    const basis = diagramBasis(readings, QUARTER_HOURS)!;
    const julyOnly = diagramBasis(readings.slice(0, 2), QUARTER_HOURS)!;
    const augustOnly = diagramBasis(readings.slice(2), QUARTER_HOURS)!;
    const price = (b: MarketBasis) => formulaEnergyPrices(galp, b, 6.9, "simple", "daily")![0];
    expect(price(basis)).toBeCloseTo((2 * price(julyOnly) + 3 * price(augustOnly)) / 5, 12);
  });
});

describe("diagramBasis", () => {
  // Two legal days of quarter-hour prices, from 00:00 Lisbon time on 1 January 2026.
  const start = legalMidnight(2026, 1, 1);
  const quarters = 2 * 96;
  const data = {
    start: new Date(start).toISOString(),
    omie: Array.from({ length: quarters }, (_, i) => (i < 96 ? 10000 : 20000)), // 100 then 200 EUR/MWh
    loss: Array.from({ length: quarters }, () => 15000), // factor 1,15
  };

  it("weights each quarter-hour's price by the diagram's kWh, and measures the coverage", () => {
    const readings = [
      { start, kwh: 1 }, // day 1, 00:00, valley, 100 EUR/MWh
      { start: start + 96 * QUARTER_HOUR_MS, kwh: 3 }, // day 2, 00:00, valley, 200 EUR/MWh
      { start: start + 2 * 96 * QUARTER_HOUR_MS, kwh: 4 }, // day 3: no price
    ];
    const basis = diagramBasis(readings, data)!;
    expect(basis.kind).toBe("diagram");
    expect(basis.coverage).toBeCloseTo(0.5, 12);
    expect(basis.months).toHaveLength(1);
    const [, , valley] = basis.months[0].daily;
    expect(valley[0]).toBe(4);
    expect(valley[1]).toBeCloseTo((100 + 600) / 4, 12);
    expect(valley[2]).toBeCloseTo(1.15 * 175, 9);
    // The arithmetic means cover every quarter-hour of the two priced days.
    expect(basis.months[0].mean).toBeCloseTo(150, 12);
    const flat: IndexedFormula = { ...formula("EDPC"), basis: "quarterHour", weighting: "actual", losses: { kind: "profile" }, multiplier: 1, adder: 0 };
    // Every kWh fell in valley hours: the simple price is the valley's.
    const [simple] = formulaEnergyPrices(flat, basis, 6.9, "simple", "daily")!;
    expect(simple).toBeCloseTo(0.175 * 1.15 + ERSE_TARIFFS.tarEnergyPerKwh.upTo20_7.simple, 12);
    // The off-valley hours had no consumption: their price is the hours' plain mean, 150 EUR/MWh,
    // at the diagram's loss factor (it bills no kWh).
    const [offValley] = formulaEnergyPrices(flat, basis, 6.9, "biHourly", "daily")!;
    expect(offValley).toBeCloseTo(0.15 * 1.15 + ERSE_TARIFFS.tarEnergyPerKwh.upTo20_7.offValley, 12);
  });

  it("is null when no reading falls on a priced quarter-hour", () => {
    expect(diagramBasis([{ start: start - QUARTER_HOUR_MS, kwh: 1 }], data)).toBeNull();
  });
});

describe("compareElectricityOffers with indexedPricing", () => {
  const kwh = (simple: number): PeriodKwh => {
    const cycle = { biHourly: { offValley: simple * 0.6, valley: simple * 0.4 }, triHourly: { peak: simple * 0.2, shoulder: simple * 0.4, valley: simple * 0.4 } };
    return { days: 365, simple: { energy: simple }, daily: cycle, weekly: cycle };
  };
  const input: TariffComparisonInput = {
    contractedPower: 6.9,
    kwh: kwh(2500),
    cycle: "daily",
    socialTariff: false,
    largeFamily: false,
    newClient: false,
    includeRefunds: false,
    includeConditioned: true,
    includeDual: true,
  };
  const offers = ["EDPC_33", "GOLD_85", "IBD_46", "TUR"].map(offer);
  const run = (extra: Partial<TariffComparisonInput>) => {
    const outcome = compareElectricityOffers(offers, { ...input, ...extra });
    if (!outcome.ok) throw new Error("unexpected errors");
    return outcome.result.results;
  };
  const pricing = { basis: profileBasis(OMIE_MONTHS), formulas: INDEXED_FORMULAS };

  it("leaves every result on ERSE's prices when it is not asked for", () => {
    for (const result of run({})) {
      expect(result.priceBasis).toBe(result.offer.indexed ? "erseEstimate" : "fixed");
      expect(result.estimated).toBe(result.offer.indexed);
      expect(result.market).toBeUndefined();
    }
  });

  it("prices offers with a formula from the market and says on what; the others stay estimated", () => {
    const results = run({ indexedPricing: pricing });
    const byId = (id: string, option: TariffOption = "simple") => results.find((r) => r.offer.id === id && r.option === option)!;
    const edp = byId("EDPC_33", "biHourly");
    expect(edp.priceBasis).toBe("market");
    expect(edp.estimated).toBe(false);
    expect(edp.market).toMatchObject({ kind: "last12Months", from: OMIE_MONTHS[0].month, to: OMIE_MONTHS.at(-1)!.month });
    expect(edp.market!.energy).toEqual(formulaEnergyPrices(formula("EDPC"), pricing.basis, 6.9, "biHourly", "daily"));
    // The energy term is the formula's prices on the household's kWh.
    const [offValley, valley] = edp.market!.energy;
    expect(edp.firstYear.energy).toBeCloseTo(1500 * offValley + 1000 * valley, 6);
    // The power term stays ERSE's.
    expect(edp.firstYear.power).toBeCloseTo(offer("EDPC_33").prices[6.9]!.biHourly!.powerPerDay * 365, 6);
    expect(byId("GOLD_85").priceBasis).toBe("market");
    expect(byId("IBD_46")).toMatchObject({ priceBasis: "erseEstimate", estimated: true });
    expect(byId("TUR")).toMatchObject({ priceBasis: "fixed", estimated: false });
  });
});

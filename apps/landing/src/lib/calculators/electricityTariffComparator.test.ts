import { describe, expect, it } from "vitest";
import type { ElectricityOffer } from "./electricityOfferTypes";
import { ELECTRICITY_OFFERS } from "./data/electricityOffers";
import { ELECTRICITY_SUPPLIER_NAMES, supplierName } from "./electricitySuppliers";
import { compareElectricityOffers } from "./electricityTariffComparison";
import { FIXTURE_OFFERS } from "./electricityTariffComparison.fixtures";
import { profilePeriodShares } from "./electricityPeriods";
import {
  DEFAULT_OFFER_FILTERS,
  MONTH_DAYS,
  MY_TARIFF_ID,
  comparisonCsv,
  filterOffers,
  monthlyKwhFromBill,
  myTariffErrors,
  myTariffOffer,
  periodsFromEntry,
  regulatedMonthlyBill,
  runComparator,
  splitTotal,
  supplierChoices,
  type ComparatorRequest,
  type CsvLabels,
} from "./electricityTariffComparator";

const offer = (id: string) => FIXTURE_OFFERS.find((candidate) => candidate.id === id) as ElectricityOffer;
const TUR = offer("TUR");

const QUICK = { contractedPower: 3.45, option: "simple", cycle: "daily", socialTariff: false, largeFamily: false } as const;

describe("consumption", () => {
  it("is a twelfth of a 365-day year a month", () => {
    expect(MONTH_DAYS).toBeCloseTo(30.4167, 4);
  });

  it("splits a total with the household's BTN profile, C at or below 7 140 kWh a year", () => {
    const month = splitTotal(200, MONTH_DAYS, 3.45);
    const shares = profilePeriodShares("C");
    expect(month.days).toBe(MONTH_DAYS);
    expect(month.simple.energy).toBe(200);
    expect(month.daily.biHourly.valley).toBeCloseTo(200 * shares.daily.biHourly.valley, 9);
    expect(month.weekly.triHourly.peak).toBeCloseTo(200 * shares.weekly.triHourly.peak, 9);
    const { peak, shoulder, valley } = month.daily.triHourly;
    expect(peak + shoulder + valley).toBeCloseTo(200, 9);
    expect(month.daily.biHourly.offValley).toBeCloseTo(peak + shoulder, 9);

    // 700 kWh a month is 8 400 a year: class B. Above 13,8 kVA: class A.
    expect(splitTotal(700, MONTH_DAYS, 6.9).daily.biHourly.valley).toBeCloseTo(700 * profilePeriodShares("B").daily.biHourly.valley, 9);
    expect(splitTotal(100, MONTH_DAYS, 17.25).daily.biHourly.valley).toBeCloseTo(100 * profilePeriodShares("A").daily.biHourly.valley, 9);
  });

  it("carries kWh entered for one option to the others", () => {
    const tri = periodsFromEntry("triHourly", [40, 100, 60], 30, 3.45, "weekly");
    expect(tri).toMatchObject({ days: 30, simple: { energy: 200 } });
    expect(tri.weekly).toEqual({ biHourly: { offValley: 140, valley: 60 }, triHourly: { peak: 40, shoulder: 100, valley: 60 } });
    expect(tri.daily).toEqual(tri.weekly);

    const bi = periodsFromEntry("biHourly", [130, 70], 30, 3.45, "daily");
    const shares = profilePeriodShares("C").daily.triHourly;
    expect(bi.simple.energy).toBe(200);
    expect(bi.daily.biHourly).toEqual({ offValley: 130, valley: 70 });
    expect(bi.daily.triHourly.peak).toBeCloseTo((130 * shares.peak) / (shares.peak + shares.shoulder), 9);
    expect(bi.daily.triHourly.peak + bi.daily.triHourly.shoulder).toBeCloseTo(130, 9);
    expect(bi.daily.triHourly.valley).toBe(70);

    expect(periodsFromEntry("simple", [250], 365, 3.45, "daily")).toEqual(splitTotal(250, 365, 3.45));
  });
});

describe("quick mode: a bill in euro to kWh on the regulated tariff", () => {
  it("solves the regulated bill, taxes included, back to the kWh", () => {
    for (const kwh of [0, 50, 158, 200, 350, 1200]) {
      const bill = regulatedMonthlyBill(TUR, kwh, QUICK) as number;
      const outcome = monthlyKwhFromBill(TUR, { ...QUICK, bill });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      // The bill is in cents, so about a tenth of a kWh either way gives the same bill.
      expect(Math.abs(outcome.monthlyKwh - kwh)).toBeLessThan(0.15);
      expect(Math.abs((regulatedMonthlyBill(TUR, outcome.monthlyKwh, QUICK) as number) - bill)).toBeLessThanOrEqual(0.01 + 1e-9);
    }
  });

  it("prices the month like the engine does for 365/12 days", () => {
    const direct = compareElectricityOffers([TUR], {
      contractedPower: 3.45,
      kwh: splitTotal(158, 365 / 12, 3.45),
      cycle: "daily",
      options: ["simple"],
      socialTariff: false,
      largeFamily: false,
      newClient: false,
      includeRefunds: false,
      includeConditioned: true,
    });
    if (!direct.ok) throw new Error("valid");
    expect(regulatedMonthlyBill(TUR, 158, QUICK)).toBe(direct.result.results[0].period.total);
    // A year is twelve such months.
    expect(direct.result.results[0].firstYear.total).toBeCloseTo(direct.result.results[0].period.total * 12, 0);
  });

  it("counts the household's taxes: the social tariff lowers the bill, so the same bill is more kWh", () => {
    const bill = 50;
    const regular = monthlyKwhFromBill(TUR, { ...QUICK, bill });
    const social = monthlyKwhFromBill(TUR, { ...QUICK, bill, socialTariff: true });
    if (!regular.ok || !social.ok) throw new Error("valid");
    expect(social.monthlyKwh).toBeGreaterThan(regular.monthlyKwh);
  });

  it("refuses a bill below the fixed charges, an absurd bill and a power the regulated tariff has no price for", () => {
    const fixed = regulatedMonthlyBill(TUR, 0, QUICK) as number;
    expect(monthlyKwhFromBill(TUR, { ...QUICK, bill: fixed - 1 })).toEqual({ ok: false, error: "belowFixed", minimum: fixed });
    expect(monthlyKwhFromBill(TUR, { ...QUICK, bill: 1_000_000 })).toMatchObject({ ok: false, error: "tooLarge" });
    expect(monthlyKwhFromBill(TUR, { ...QUICK, contractedPower: 4.6, bill: 60 })).toEqual({ ok: false, error: "noRegulatedPrice" });
  });
});

describe("filters the engine leaves to the page", () => {
  const withLoyalty = { ...offer("END_68"), id: "END_LOYAL", loyalty: true };
  const offers = [...FIXTURE_OFFERS, withLoyalty];
  const ids = (filters: Partial<typeof DEFAULT_OFFER_FILTERS>) =>
    filterOffers(offers, { ...DEFAULT_OFFER_FILTERS, ...filters }).map((candidate) => candidate.id);

  it("keeps every offer by default", () => {
    expect(ids({})).toHaveLength(offers.length);
  });

  it("filters on fixed or indexed price, renewable, loyalty, requirements, services and supplier", () => {
    const indexed = offers.filter((candidate) => candidate.indexed).map((candidate) => candidate.id);
    expect(indexed).toContain("AUDAX_09");
    expect(ids({ pricing: "indexed" })).toEqual(indexed);
    expect(ids({ pricing: "fixed" })).not.toContain("AUDAX_09");
    expect(ids({ pricing: "fixed" })).toHaveLength(offers.length - indexed.length);
    expect(ids({ renewableOnly: true }).every((id) => offer(id).renewable)).toBe(true);
    expect(ids({ renewableOnly: true })).not.toContain("TUR");
    expect(ids({ noLoyalty: true })).not.toContain("END_LOYAL");
    expect(ids({ allowDirectDebit: false })).not.toContain("GALP_27");
    expect(ids({ allowDirectDebit: false })).toContain("GOLD_08");
    expect(ids({ allowEInvoice: false })).toContain("GALP_27");
    expect(ids({ allowEInvoice: false })).not.toContain("EDPC_13");
    expect(ids({ allowMandatoryServices: false })).not.toContain("REPSOL_127");
    expect(ids({ allowMandatoryServices: false })).toContain("REPSOL_125");
    expect(ids({ supplier: "EDPC" })).toEqual(offers.filter((candidate) => candidate.supplier === "EDPC").map((candidate) => candidate.id));
    expect(ids({ supplier: "EDPC" })).toContain("EDPC_13");
  });

  it("lists each supplier once, by brand name, the regulated tariff first", () => {
    const choices = supplierChoices(FIXTURE_OFFERS, "Regulated tariff");
    expect(choices[0]).toEqual({ code: "TUR", name: "Regulated tariff", regulated: true });
    expect(choices.map((choice) => choice.name)).toEqual([
      "Regulated tariff",
      "Audax",
      "EDP",
      "Endesa",
      "Galp",
      "Goldenergy",
      "Iberdrola",
      "LuziGás",
      "MEO Energia",
      "Nabalia Energia",
      "Repsol",
    ]);
  });

  it("has a brand name for every supplier in the ERSE snapshot, and falls back to the code", () => {
    const codes = new Set(ELECTRICITY_OFFERS.filter((candidate) => !candidate.regulated).map((candidate) => candidate.supplier));
    expect([...codes].filter((code) => !(code in ELECTRICITY_SUPPLIER_NAMES))).toEqual([]);
    expect(supplierName("NEWCO")).toBe("NEWCO");
  });
});

const REQUEST: ComparatorRequest = {
  offers: FIXTURE_OFFERS,
  consumption: splitTotal(250, MONTH_DAYS, 3.45),
  contractedPower: 3.45,
  cycle: "daily",
  option: "simple",
  socialTariff: false,
  largeFamily: false,
  newClient: false,
  includeRefunds: true,
  includeConditioned: true,
  includeDual: false,
  cheapestPerSupplier: false,
  sortBy: "firstYear",
  filters: DEFAULT_OFFER_FILTERS,
  myTariff: null,
};

function view(overrides: Partial<ComparatorRequest> = {}) {
  const outcome = runComparator({ ...REQUEST, ...overrides });
  if (!outcome.ok) throw new Error(`unexpected ${JSON.stringify(outcome.errors)}`);
  return outcome.view;
}

describe("the visitor's own tariff", () => {
  it("is priced like any offer: the regulated prices typed in cost exactly the regulated tariff", () => {
    const prices = TUR.prices[3.45]!;
    for (const [option, energy] of [
      ["simple", [prices.simple!.energy]],
      ["biHourly", [prices.biHourly!.offValley, prices.biHourly!.valley]],
      ["triHourly", [prices.triHourly!.peak, prices.triHourly!.shoulder, prices.triHourly!.valley]],
    ] as const) {
      const result = view({ option, myTariff: { powerPerDay: prices.simple!.powerPerDay, energy } });
      const regulated = result.results.find((row) => row.offer.id === "TUR");
      expect(result.mine?.offer.id).toBe(MY_TARIFF_ID);
      expect(result.mine?.firstYear.total).toBe(regulated?.firstYear.total);
      expect(regulated?.saving).toBe(0);
    }
  });

  it("gives each offer its saving on the ranking total, and stays out of the list", () => {
    const result = view({ myTariff: { powerPerDay: 0.3, energy: [0.2] } });
    expect(result.results.some((row) => row.offer.id === MY_TARIFF_ID)).toBe(false);
    for (const row of result.results) {
      expect(row.saving).toBeCloseTo((result.mine?.firstYear.total ?? 0) - row.firstYear.total, 2);
    }
    const later = view({ sortBy: "laterYears", newClient: true, myTariff: { powerPerDay: 0.3, energy: [0.2] } });
    for (const row of later.results) expect(row.saving).toBeCloseTo((later.mine?.laterYears.total ?? 0) - row.laterYears.total, 2);
  });

  it("checks the prices: one per period, none negative or implausible", () => {
    expect(myTariffErrors("biHourly", { powerPerDay: 0.2, energy: [0.2] })).toEqual({ energy1: "required" });
    expect(myTariffErrors("simple", { powerPerDay: -1, energy: [12] })).toEqual({ powerPerDay: "outOfRange", energy0: "outOfRange" });
    expect(view({ myTariff: { powerPerDay: Number.NaN, energy: [0.2] } }).mine).toBeNull();
    expect(myTariffOffer(3.45, "triHourly", { powerPerDay: 0.2, energy: [0.3, 0.2, 0.1] }).prices[3.45]).toEqual({
      triHourly: { powerPerDay: 0.2, peak: 0.3, shoulder: 0.2, valley: 0.1 },
    });
  });
});

describe("the comparison the page shows", () => {
  it("lists the visitor's option only, cheapest first, with the page filters applied", () => {
    const result = view({ option: "biHourly", filters: { ...DEFAULT_OFFER_FILTERS, allowMandatoryServices: false } });
    expect(result.results.every((row) => row.option === "biHourly")).toBe(true);
    expect(result.results.some((row) => row.offer.mandatoryServicesPerYear > 0)).toBe(false);
    const totals = result.results.map((row) => row.firstYear.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    expect(result.results.every((row) => row.saving === null)).toBe(true);
  });

  it("keeps one offer per supplier when asked", () => {
    const result = view({ cheapestPerSupplier: true });
    const suppliers = result.results.map((row) => row.offer.supplier);
    expect(new Set(suppliers).size).toBe(suppliers.length);
  });

  it("puts the cheapest offer of each option side by side, on the same consumption", () => {
    const result = view();
    for (const option of ["simple", "biHourly", "triHourly"] as const) {
      const only = view({ option }).results;
      expect(result.best[option]?.offer.id).toBe(only[0].offer.id);
      expect(result.best[option]?.firstYear.kwh).toBeCloseTo(250 * 12, 6);
    }
  });

  it("passes the engine's validation errors on", () => {
    expect(runComparator({ ...REQUEST, consumption: { ...REQUEST.consumption, days: 0 } })).toEqual({
      ok: false,
      errors: { days: "outOfRange" },
    });
  });
});

describe("CSV export", () => {
  const LABELS: CsvLabels = {
    rank: "Rank",
    supplier: "Supplier",
    offer: "Offer",
    option: "Option",
    firstYear: "First year (EUR)",
    laterYears: "Later years (EUR)",
    period: "Period (EUR)",
    estimated: "Estimated price",
    priceBasis: "Price basis",
    saving: "Saving (EUR)",
    link: "Link",
    options: { simple: "Simple", biHourly: "Bi-hourly", triHourly: "Tri-hourly" },
    yes: "yes",
    no: "no",
    supplierOf: (candidate) => (candidate.regulated ? "Regulated tariff" : supplierName(candidate.supplier)),
    basisOf: (result) => (result.priceBasis === "market" ? `OMIE ${result.market!.from} to ${result.market!.to}` : result.priceBasis),
  };

  it("writes one row per result in the list's order, with a header and a byte-order mark", () => {
    const result = view();
    const csv = comparisonCsv(result.results, "en", LABELS);
    const lines = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(lines[0]).toBe("Rank,Supplier,Offer,Option,First year (EUR),Later years (EUR),Period (EUR),Estimated price,Price basis,Link");
    expect(lines).toHaveLength(result.results.length + 1);
    const first = result.results[0];
    expect(lines[1].startsWith(`1,${LABELS.supplierOf(first.offer)},`)).toBe(true);
    expect(lines[1]).toContain(`,Simple,${first.firstYear.total.toFixed(2)},`);
    expect(lines[1]).toContain(`,${first.priceBasis},`);
  });

  it("uses a semicolon and a decimal comma outside English, quotes what needs it and adds the saving", () => {
    const row = { ...view({ myTariff: { powerPerDay: 0.3, energy: [0.2] } }).results[0] };
    row.offer = { ...row.offer, name: 'Casa; "Verde"', links: { offer: "https://example.com/offer" } };
    const csv = comparisonCsv([row], "pt", LABELS);
    const [header, line] = csv.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(header.split(";")).toContain("Saving (EUR)");
    expect(line).toContain(';"Casa; ""Verde""";');
    expect(line).toContain(`;${row.firstYear.total.toFixed(2).replace(".", ",")};`);
    expect(line.endsWith(";https://example.com/offer")).toBe(true);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_OFFERS } from "@/lib/calculators/electricityTariffComparison.fixtures";
import {
  DEFAULT_OFFER_FILTERS,
  MONTH_DAYS,
  monthlyKwhFromBill,
  runComparator,
  splitTotal,
} from "@/lib/calculators/electricityTariffComparator";
import { INDEXED_FORMULAS } from "@/lib/calculators/data/indexedFormulas";
import { OMIE_MONTHS, OMIE_PRICES_SOURCE } from "@/lib/calculators/data/omiePrices";
import { legalMidnight, QUARTER_HOUR_MS } from "@/lib/calculators/electricityPeriods";
import { profileBasis } from "@/lib/calculators/indexedPricing";
import type { MarketLoader, OffersLoader, QuarterHoursLoader } from "./ElectricityTariffComparisonComp";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/electricity-tariff-comparison",
}));

const { default: ElectricityTariffComparisonComp } = await import("./ElectricityTariffComparisonComp");

const SOURCE = {
  name: "ERSE",
  url: "https://simuladorprecos.erse.pt/",
  exportFile: "fixture.zip",
  exportedOn: "2026-11-17",
  fetchedOn: "2026-11-20",
  offerCount: FIXTURE_OFFERS.length,
  supplierCount: new Set(FIXTURE_OFFERS.map((offer) => offer.supplier)).size,
  version: 1,
} as const;
const loadFixtures: OffersLoader = async () => ({ ELECTRICITY_OFFERS: FIXTURE_OFFERS, ELECTRICITY_OFFERS_SOURCE: SOURCE });
const TUR = FIXTURE_OFFERS.find((offer) => offer.regulated)!;
const loadMarket: MarketLoader = async () => ({ OMIE_MONTHS, OMIE_PRICES_SOURCE, INDEXED_FORMULAS });

const eur = (value: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** What the page should list for these inputs, from the same pure functions. */
function expected(kwhPerMonth: number, overrides: Partial<Parameters<typeof runComparator>[0]> = {}) {
  const outcome = runComparator({
    offers: FIXTURE_OFFERS,
    consumption: splitTotal(kwhPerMonth, MONTH_DAYS, 3.45),
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
    ...overrides,
  });
  if (!outcome.ok) throw new Error("valid");
  return outcome.view;
}

const list = () => screen.getByRole("list", { name: "Offers, cheapest first" });
const cards = () => [...list().children] as HTMLElement[];
const firstCard = () => cards()[0];
/** Whether the element shows the text (a card shows its total in the headline and in the breakdown). */
const shows = (element: HTMLElement, text: string) => within(element).getAllByText(text).length > 0;

async function renderPage() {
  render(<ElectricityTariffComparisonComp locale="en" loadOffers={loadFixtures} />);
  expect(screen.getByRole("status").textContent).toContain("Loading ERSE's offers");
  await screen.findByRole("list", { name: "Offers, cheapest first" });
}

beforeEach(() => {
  pushGtmEvent.mockClear();
});
afterEach(() => cleanup());

describe("electricity tariff comparator", () => {
  it("quick mode: turns the bill into kWh on the regulated tariff and ranks the offers, with the ERSE source", async () => {
    await renderPage();
    const solved = monthlyKwhFromBill(TUR, { bill: 50, contractedPower: 3.45, option: "simple", cycle: "daily", socialTariff: false, largeFamily: false });
    if (!solved.ok) throw new Error("valid");
    expect(screen.getByText(`On the regulated tariff this bill is about ${Math.round(solved.monthlyKwh)} kWh a month.`)).toBeTruthy();
    const view = expected(solved.monthlyKwh);
    expect(shows(firstCard(), eur(view.results[0].firstYear.total))).toBe(true);
    expect(screen.getByText(`${view.results.length} offers, priced on ${new Intl.NumberFormat("en-IE").format(Math.round(view.annualKwh))} kWh a year.`)).toBeTruthy();

    // The source, its date, the estimate and the DGEG fee are stated.
    expect(screen.getByText(/Offers: ERSE, export of 17 November 2026/)).toBeTruthy();
    expect(screen.getByText(/Indexed prices are ERSE's estimates/)).toBeTruthy();
    expect(screen.getByText(/The DGEG fee .* is not included/)).toBeTruthy();
    expect(screen.getByText(/before any personal negotiation/)).toBeTruthy();
    expect(pushGtmEvent).not.toHaveBeenCalled();

    // The comparison across options shows the cheapest of each.
    const options = screen.getByRole("heading", { name: "Simple, bi-hourly or tri-hourly?" }).closest("section") as HTMLElement;
    for (const option of ["simple", "biHourly", "triHourly"] as const) {
      expect(within(options).getAllByText(eur(view.best[option]!.firstYear.total)).length).toBeGreaterThan(0);
    }

    // A bill below the fixed charges is refused with the minimum.
    fireEvent.change(screen.getByLabelText("Monthly bill"), { target: { value: "2" } });
    expect(screen.getByText(/costs at least .* at this power/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Offers, cheapest first" })).toBeNull();

    // Monthly kWh instead of a bill.
    fireEvent.change(screen.getByLabelText("I know my"), { target: { value: "kwh" } });
    fireEvent.change(screen.getByLabelText("Monthly consumption"), { target: { value: "300" } });
    expect(shows(firstCard(), eur(expected(300).results[0].firstYear.total))).toBe(true);

    expect(pushGtmEvent).toHaveBeenCalledExactlyOnceWith({
      event: "tool_used",
      tool: "electricity_tariff_comparison",
      page_type: "tools/electricity-tariff-comparison",
    });
  });

  it("full mode: kWh per period for the chosen option and cycle, a total, and the days", async () => {
    await renderPage();
    fireEvent.click(screen.getByLabelText("Full"));
    fireEvent.change(screen.getByLabelText("Tariff option"), { target: { value: "triHourly" } });
    fireEvent.change(screen.getByLabelText("Hourly cycle"), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("Peak hours (ponta)"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Shoulder hours (cheias)"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Valley hours (vazio)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("The consumption covers"), { target: { value: "days" } });
    fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "61" } });

    const cycle = { biHourly: { offValley: 140, valley: 60 }, triHourly: { peak: 40, shoulder: 100, valley: 60 } };
    const view = expected(0, {
      option: "triHourly",
      cycle: "weekly",
      consumption: { days: 61, simple: { energy: 200 }, daily: cycle, weekly: cycle },
    });
    expect(screen.getByRole("heading", { name: "Offers on the Tri-hourly option" })).toBeTruthy();
    expect(shows(firstCard(), eur(view.results[0].firstYear.total))).toBe(true);
    expect(shows(firstCard(), eur(view.results[0].period.total))).toBe(true);
    expect(shows(firstCard(), "Your 61 days")).toBe(true);

    // The breakdown has every line and the offer's links.
    fireEvent.click(within(firstCard()).getByText("Breakdown and links"));
    const table = within(firstCard()).getByRole("table");
    for (const line of ["Power", "Energy", "Electricity tax (IEC)", "VAT at 23%", "Total"]) expect(within(table).getByText(line)).toBeTruthy();

    // Days out of range.
    fireEvent.change(screen.getByLabelText("Number of days"), { target: { value: "900" } });
    expect(screen.getByText("Enter a whole number of days from 1 to 731.")).toBeTruthy();

    // A total split by the profile.
    fireEvent.change(screen.getByLabelText("The consumption covers"), { target: { value: "month" } });
    fireEvent.change(screen.getByLabelText("Consumption"), { target: { value: "total" } });
    fireEvent.change(screen.getByLabelText("Total consumption"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Hourly cycle"), { target: { value: "daily" } });
    expect(shows(firstCard(), eur(expected(250, { option: "triHourly" }).results[0].firstYear.total))).toBe(true);
  });

  it("reads an E-REDES consumption file in the browser, and explains a file it cannot read", async () => {
    await renderPage();
    fireEvent.click(screen.getByLabelText("Full"));
    fireEvent.change(screen.getByLabelText("Consumption"), { target: { value: "diagram" } });
    expect(screen.getByText("Check the highlighted fields to see the offers.")).toBeTruthy();
    expect(screen.getByText(/nothing is uploaded/)).toBeTruthy();

    // A synthetic export in E-REDES's layout: two days at a steady 0,4 kW, 0,1 kWh a quarter-hour.
    const header = ["Data", "Hora", "Consumo registado, Ativa (kW)"];
    const rows = ["2026/01/14", "2026/01/15"].flatMap((date) =>
      Array.from({ length: 96 }, (_, i) => {
        const end = (i + 1) * 15;
        return [date, `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`, "0,4"];
      }),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Diagrama de carga"], header, ...rows]), "Consumos");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const upload = screen.getByLabelText("E-REDES consumption file");
    fireEvent.change(upload, { target: { files: [new File([bytes], "consumos.xlsx")] } });
    expect(await screen.findByText("2026-01-14 to 2026-01-15: 2 days, 19 kWh.")).toBeTruthy();
    await screen.findByRole("list", { name: "Offers, cheapest first" });
    expect(screen.getByText(/priced on 3,504 kWh a year/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove the file" }));
    fireEvent.change(upload, { target: { files: [new File(["just,some,text\n1,2,3\n"], "other.csv", { type: "text/csv" })] } });
    expect(await screen.findByText(/This does not look like an E-REDES consumption file/)).toBeTruthy();
  });

  it("prices indexed offers with a published formula from OMIE's last 12 months, on request", async () => {
    const market = vi.fn(loadMarket);
    render(<ElectricityTariffComparisonComp locale="en" loadOffers={loadFixtures} loadMarket={market} />);
    await screen.findByRole("list", { name: "Offers, cheapest first" });
    fireEvent.change(screen.getByLabelText("I know my"), { target: { value: "kwh" } });
    fireEvent.change(screen.getByLabelText("Price type"), { target: { value: "indexed" } });
    expect(market).not.toHaveBeenCalled();
    const card = (name: string) => cards().find((each) => within(each).queryByText(name)) as HTMLElement;
    expect(within(card("Eletricidade Indexada média DD + FE Oferta 100€")).getByText("Estimated price")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Real cost over the last 12 months with OMIE prices"));
    await waitFor(() => expect(within(card("Eletricidade Indexada média DD + FE Oferta 100€")).queryByText("Real cost (OMIE)")).toBeTruthy());
    expect(market).toHaveBeenCalledOnce();
    const edp = card("Eletricidade Indexada média DD + FE Oferta 100€");
    expect(within(edp).queryByText("Estimated price")).toBeNull();
    const view = expected(200, { indexedPricing: { basis: profileBasis(OMIE_MONTHS), formulas: INDEXED_FORMULAS }, filters: { ...DEFAULT_OFFER_FILTERS, pricing: "indexed" } });
    const priced = view.results.find((result) => result.offer.id === "EDPC_36")!;
    expect(priced.priceBasis).toBe("market");
    expect(shows(edp, eur(priced.firstYear.total))).toBe(true);
    expect(within(edp).getByText(/supplier's published formula and OMIE prices from November 2025 to October 2026/)).toBeTruthy();
    expect(within(edp).getByRole("link", { name: "Supplier's formula (read on 20 November 2026)", hidden: true }).getAttribute("href")).toBe(
      "https://www.edp.pt/media/uknapr1m/fin-indexada.pdf",
    );
    // An offer whose supplier publishes no complete formula stays on ERSE's estimate.
    expect(within(card("TOP -T0 INDEXADO 12 meses")).getByText("Estimated price")).toBeTruthy();
    expect(screen.getByText("1 indexed offer without a published formula stays on ERSE's estimate (3-month futures).")).toBeTruthy();
    expect(screen.getByText(/real cost with OMIE's Portuguese prices from November 2025 to October 2026/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Day-ahead market prices (OMIE, Portugal)" }).getAttribute("href")).toBe(OMIE_PRICES_SOURCE.url);

    fireEvent.click(screen.getByLabelText("ERSE's estimate"));
    expect(within(card("Eletricidade Indexada média DD + FE Oferta 100€")).getByText("Estimated price")).toBeTruthy();
  });

  it("prices them on the consumption file's own quarter-hours when it covers six months, and falls back otherwise", async () => {
    // January to June 2026 of quarter-hour prices: 100 EUR/MWh, loss factor 1,16, a flat profile.
    const start = legalMidnight(2026, 1, 1);
    const count = (legalMidnight(2026, 7, 1) - start) / QUARTER_HOUR_MS;
    const data = {
      start: new Date(start).toISOString(),
      omie: Array.from({ length: count }, () => 10000),
      loss: Array.from({ length: count }, () => 16000),
      profile: Array.from({ length: count }, () => 28539),
    };
    const quarterHours = vi.fn<QuarterHoursLoader>(async () => data);
    render(<ElectricityTariffComparisonComp locale="en" loadOffers={loadFixtures} loadMarket={loadMarket} loadQuarterHours={quarterHours} />);
    await screen.findByRole("list", { name: "Offers, cheapest first" });
    fireEvent.click(screen.getByLabelText("Full"));
    fireEvent.change(screen.getByLabelText("Consumption"), { target: { value: "diagram" } });
    const upload = (dates: string[]) => {
      const header = ["Data", "Hora", "Consumo registado, Ativa (kW)"];
      const rows = dates.flatMap((date) =>
        Array.from({ length: 96 }, (_, i) => {
          const end = (i + 1) * 15;
          return [date, `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`, "0,4"];
        }),
      );
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Diagrama de carga"], header, ...rows]), "Consumos");
      const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      fireEvent.change(screen.getByLabelText("E-REDES consumption file"), { target: { files: [new File([bytes], "consumos.xlsx")] } });
    };
    const edp = () => cards().find((each) => within(each).queryByText("Eletricidade Indexada média DD + FE Oferta 100€")) as HTMLElement;

    // Two January days: one month of the twelve, too few. The last 12 months are used, and said.
    upload(["2026/01/14", "2026/01/15"]);
    await screen.findByText("2026-01-14 to 2026-01-15: 2 days, 19 kWh.");
    fireEvent.click(screen.getByLabelText("Real cost on the dates of your consumption file with OMIE prices"));
    expect(await screen.findByText(/covers 1 of the 12 months with OMIE prices; at least 6 are needed/)).toBeTruthy();
    expect(quarterHours).toHaveBeenCalledExactlyOnceWith("/data/omie-pt-quarter-hours.json");
    expect(within(edp()).getByText(/OMIE prices from November 2025 to October 2026/)).toBeTruthy();

    // A day in each of six months: priced on the file's own quarter-hours.
    fireEvent.click(screen.getByRole("button", { name: "Remove the file" }));
    upload(["2026/01/14", "2026/02/14", "2026/03/14", "2026/04/14", "2026/05/14", "2026/06/14"]);
    await screen.findByText("2026-01-14 to 2026-06-14: 6 days, 58 kWh.");
    await waitFor(() => expect(screen.getByText(/Portuguese price of each quarter-hour in your consumption file \(January 2026 to June 2026\)/)).toBeTruthy());
    expect(within(edp()).getByText("Real cost (OMIE)")).toBeTruthy();
    // EDP's formula on 100 EUR/MWh: 0,1 x 1,164 x 1,10 + 0,0185 + TAR 0,0607 EUR/kWh.
    expect(within(edp()).getByText(`Energy, before VAT: ${(0.1 * 1.164 * 1.1 + 0.0185 + 0.0607).toFixed(4)} €/kWh.`)).toBeTruthy();
    expect(screen.queryByText(/at least 6 are needed/)).toBeNull();
    cleanup();

    // OMIE's data cannot be loaded: the offers stay on ERSE's estimate, and the page says so.
    render(<ElectricityTariffComparisonComp locale="en" loadOffers={loadFixtures} loadMarket={() => Promise.reject(new Error("offline"))} />);
    await screen.findByRole("list", { name: "Offers, cheapest first" });
    fireEvent.click(screen.getByLabelText("Real cost over the last 12 months with OMIE prices"));
    expect(await screen.findByText(/OMIE prices could not be loaded/)).toBeTruthy();
    expect(screen.queryAllByText("Real cost (OMIE)")).toHaveLength(0);
  });

  it("filters on the offer fields and on the engine's options", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("I know my"), { target: { value: "kwh" } });
    const count = () => cards().length;
    const all = count();

    fireEvent.change(screen.getByLabelText("Price type"), { target: { value: "indexed" } });
    const indexed = FIXTURE_OFFERS.filter((offer) => offer.indexed && offer.prices[3.45]?.simple);
    expect(count()).toBe(indexed.length);
    expect(within(firstCard()).getByText("Estimated price")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Price type"), { target: { value: "all" } });

    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "EDPC" } });
    expect(within(list()).getAllByText("EDP").length).toBe(count());
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "" } });

    fireEvent.click(screen.getByLabelText("Include offers with paid mandatory services"));
    expect(within(list()).queryByText("Paid services")).toBeNull();
    fireEvent.click(screen.getByLabelText("Include offers with paid mandatory services"));

    fireEvent.click(screen.getByLabelText("Include offers that require direct debit"));
    expect(within(list()).queryByText("Direct debit")).toBeNull();
    fireEvent.click(screen.getByLabelText("Include offers that require direct debit"));

    fireEvent.click(screen.getByLabelText("Only 100% renewable energy"));
    expect(count()).toBe(within(list()).getAllByText("100% renewable").length);
    fireEvent.click(screen.getByLabelText("Only 100% renewable energy"));

    fireEvent.click(screen.getByLabelText("Include conditioned offers"));
    expect(within(list()).queryByText("Conditioned")).toBeNull();
    fireEvent.click(screen.getByLabelText("Include conditioned offers"));

    fireEvent.click(screen.getByLabelText("Only each supplier's cheapest offer"));
    expect(count()).toBe(expected(200, { cheapestPerSupplier: true }).results.length);
    expect(count()).toBeLessThan(all);
  });

  it("my tariff: the visitor's prices go through the same engine, and each offer shows its saving", async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText("I know my"), { target: { value: "kwh" } });
    fireEvent.click(screen.getByText("Compare with my tariff"));
    fireEvent.click(screen.getByLabelText("Use my prices"));
    expect(screen.getByText("Enter all your prices to see the saving of each offer.")).toBeTruthy();
    // Empty prices are not flagged one by one; the summary asks for them.
    expect(screen.queryByText("Enter a price from 0 to 5 euro.")).toBeNull();

    const prices = TUR.prices[3.45]!.simple!;
    fireEvent.change(screen.getByLabelText("Power price"), { target: { value: String(prices.powerPerDay) } });
    fireEvent.change(screen.getByLabelText("Energy price"), { target: { value: String(prices.energy) } });

    const view = expected(200, { myTariff: { powerPerDay: prices.powerPerDay, energy: [prices.energy] } });
    const mine = screen.getByRole("heading", { name: "Your tariff on this consumption" }).closest("section") as HTMLElement;
    expect(within(mine).getByText(eur(view.mine!.firstYear.total))).toBeTruthy();
    const cheaper = view.results.filter((row) => (row.saving ?? 0) > 0.005);
    expect(within(mine).getByText(`${cheaper.length} offers cost less. The cheapest saves you ${eur(cheaper[0].saving!)} a year.`)).toBeTruthy();
    const savingLine = `Saves you ${eur(view.results[0].saving!)} a year`;
    expect(within(firstCard()).getByText((_, element) => element?.tagName === "P" && element.textContent === savingLine)).toBeTruthy();
    // The amount is set as a figure.
    expect(within(firstCard()).getByText(eur(view.results[0].saving!)).className).toContain("font-mono");
    // The regulated tariff typed in as "my tariff" costs exactly the same.
    expect(within(list()).getByText("Costs the same as your tariff")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Power price"), { target: { value: "9" } });
    expect(screen.getByText("Enter a price from 0 to 5 euro.")).toBeTruthy();
  });

  it("downloads the list as CSV, built in the browser", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:offers");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(click).toHaveBeenCalledOnce();
    const text = await (createObjectURL.mock.calls[0][0] as Blob).text();
    const lines = text.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe("Rank,Supplier,Offer,Option,First year (EUR),Later years (EUR),Your period (EUR),Estimated price,Price basis,Link");
    expect(lines.slice(1).some((line) => line.includes(",ERSE estimate (3-month futures),"))).toBe(true);
    expect(lines.slice(1).some((line) => line.includes(",Fixed price,"))).toBe(true);
    expect(lines.length - 1).toBe(cards().length + Math.max(0, Number(/Show (\d+) more/.exec(document.body.textContent ?? "")?.[1] ?? 0)));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:offers");
    click.mockRestore();
  });

  it("says so when the offers cannot be loaded", async () => {
    render(<ElectricityTariffComparisonComp locale="en" loadOffers={() => Promise.reject(new Error("offline"))} />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("The offers could not be loaded"));
  });
});

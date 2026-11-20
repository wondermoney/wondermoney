// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_OFFERS } from "@/lib/calculators/electricityTariffComparison.fixtures";
import { DEFAULT_OFFER_FILTERS, MONTH_DAYS, runComparator, splitTotal, type ComparatorRequest } from "@/lib/calculators/electricityTariffComparator";
import { loadSolarDistrict, solarBillSaving, solarConsumption, yearlyBalance } from "@/lib/calculators/electricitySolar";
import type { OffersLoader } from "./ElectricityTariffComparisonComp";
import type { SolarLoader } from "./ElectricitySolarPanel";

vi.mock("@/lib/gtm", () => ({ pushGtmEvent: () => undefined, getPageType: () => "tools/electricity-tariff-comparison" }));

const { default: ElectricityTariffComparisonComp } = await import("./ElectricityTariffComparisonComp");

const SOURCE = { url: "https://simuladorprecos.erse.pt/", exportedOn: "2026-11-17", offerCount: FIXTURE_OFFERS.length, supplierCount: 5 };
const loadOffers: OffersLoader = async () => ({ ELECTRICITY_OFFERS: FIXTURE_OFFERS, ELECTRICITY_OFFERS_SOURCE: SOURCE });

const eur = (value: number) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const int = (value: number) => new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(value);

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

/** What the page should show for 250 kWh a month and `kwp` in a district, from the same pure functions. */
async function expected(slug: string, kwp: number) {
  const solar = solarConsumption({
    consumption: REQUEST.consumption,
    readings: null,
    contractedPower: 3.45,
    cycle: "daily",
    system: { typicalYear: await loadSolarDistrict(slug), kwp, lossPercent: 14 },
  });
  const request = { ...REQUEST, consumption: solar.kwh };
  const outcome = runComparator(request);
  if (!outcome.ok) throw new Error("valid");
  return { solar, year: yearlyBalance(solar.balance, MONTH_DAYS), view: outcome.view, saving: solarBillSaving(request, outcome.view, REQUEST.consumption)! };
}

const firstCard = () => screen.getByRole("list", { name: "Offers, cheapest first" }).children[0] as HTMLElement;
const summary = () => screen.getByRole("region", { name: "With your solar panels" });
/** The figure under a summary label. */
const stat = (label: string) => within(summary()).getByText(label).parentElement?.querySelector("dd")?.textContent;

async function renderPage(loadSolar: SolarLoader) {
  render(<ElectricityTariffComparisonComp locale="en" loadOffers={loadOffers} loadSolar={loadSolar} />);
  await screen.findByRole("list", { name: "Offers, cheapest first" });
  fireEvent.change(screen.getByLabelText("I know my"), { target: { value: "kwh" } });
  fireEvent.change(screen.getByLabelText("Monthly consumption"), { target: { value: "250" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("solar panels in the electricity tariff comparator", () => {
  it("ranks the offers on the grid consumption and shows the self-consumed share, the surplus and the saving, citing PVGIS", async () => {
    const loader = vi.fn(loadSolarDistrict);
    await renderPage(loader);
    expect(screen.queryByLabelText("District")).toBeNull();
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    expect(loader).toHaveBeenCalledWith("lisboa");
    await screen.findByRole("heading", { name: "With your solar panels" });

    const { view, year, saving } = await expected("lisboa", 2);
    expect(within(firstCard()).getAllByText(eur(view.results[0].firstYear.total)).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`priced on ${int(view.annualKwh)} kWh a year`))).toBeTruthy();
    const box = summary();
    expect(within(box).getByText("2.0 kWp in Lisboa, facing south at 33°. Figures for a year.")).toBeTruthy();
    expect(stat("Production")).toBe(`${int(year.production)} kWh`);
    expect(stat("Used at home")).toBe(`${Math.round((year.selfConsumed / year.production) * 100)}%`);
    expect(within(box).getByText(`${int(year.selfConsumed)} kWh`)).toBeTruthy();
    expect(stat("Of your consumption")).toBe(`${Math.round((year.selfConsumed / year.consumption) * 100)}%`);
    expect(stat("Surplus to the grid")).toBe(`${int(year.surplus)} kWh`);
    expect(within(box).getByText(new RegExp(`the panels save you ${eur(saving.saving).replace(".", "\\.")} in the first year`))).toBeTruthy();
    expect(within(box).getByText(/your hours are rebuilt from the E-REDES BTN profile/)).toBeTruthy();
    expect(within(box).getByText(/PVGIS 5\.3 \(European Commission, Joint Research Centre\), PVGIS-SARAH3 radiation data for 2005–2023/)).toBeTruthy();
    expect(within(box).getByRole("link", { name: "About PVGIS" }).getAttribute("href")).toContain("joint-research-centre.ec.europa.eu");
    // No sale price, no income line.
    expect(within(box).queryByText(/Selling the surplus/)).toBeNull();

    // A sale price adds the income on its own; the ranking does not move.
    fireEvent.change(screen.getByLabelText("Surplus sale price (optional)"), { target: { value: "0.05" } });
    expect(within(summary()).getByText(`Selling the surplus at 0.050 €/kWh would bring in about ${eur(year.surplus * 0.05)} a year. It is not in the totals or the ranking.`)).toBeTruthy();
    expect(within(firstCard()).getAllByText(eur(view.results[0].firstYear.total)).length).toBeGreaterThan(0);

    // Another district loads its own table.
    fireEvent.change(screen.getByLabelText("District"), { target: { value: "faro" } });
    expect(loader).toHaveBeenLastCalledWith("faro");
    const faro = await expected("faro", 2);
    await waitFor(() => expect(stat("Production")).toBe(`${int(faro.year.production)} kWh`));
  });

  it("explains a kWp out of range and ranks without solar until it is fixed", async () => {
    await renderPage(loadSolarDistrict);
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    await screen.findByRole("heading", { name: "With your solar panels" });
    fireEvent.change(screen.getByLabelText("Peak power"), { target: { value: "0" } });
    expect(screen.getByText("Enter a power above 0 and up to 50 kWp.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "With your solar panels" })).toBeNull();
    const gross = runComparator(REQUEST);
    if (!gross.ok) throw new Error("valid");
    expect(screen.getByText(new RegExp(`priced on ${int(gross.view.annualKwh)} kWh a year`))).toBeTruthy();
  });

  it("picks the nearest district capital from the visitor's location, and says when there is none", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { latitude: 41.18, longitude: -8.69 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    await renderPage(loadSolarDistrict);
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    expect(screen.getByText(/It is not sent anywhere/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect((screen.getByLabelText("District") as HTMLSelectElement).value).toBe("porto");
    expect(screen.getByText("Nearest district capital: Porto.")).toBeTruthy();

    getCurrentPosition.mockImplementation((_success: PositionCallback, failure?: PositionErrorCallback | null) => failure?.({ code: 1 } as GeolocationPositionError));
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(screen.getByText("Your location is not available. Choose the district from the list.")).toBeTruthy();
  });

  it("says so when the production table cannot be loaded", async () => {
    await renderPage(() => Promise.reject(new Error("offline")));
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    expect(await screen.findByText(/The production estimate could not be loaded/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "With your solar panels" })).toBeNull();
  });

  it("nets an uploaded E-REDES file hour by hour", async () => {
    await renderPage(loadSolarDistrict);
    fireEvent.click(screen.getByLabelText("Full"));
    fireEvent.change(screen.getByLabelText("Consumption"), { target: { value: "diagram" } });
    const rows = ["2026/06/14", "2026/06/15"].flatMap((date) =>
      Array.from({ length: 96 }, (_, i) => {
        const end = (i + 1) * 15;
        return [date, `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`, "0,4"];
      }),
    );
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Data", "Hora", "Consumo registado, Ativa (kW)"], ...rows]), "Consumos");
    fireEvent.change(screen.getByLabelText("E-REDES consumption file"), {
      target: { files: [new File([XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer], "consumos.xlsx")] },
    });
    await screen.findByText("2026-06-14 to 2026-06-15: 2 days, 19 kWh.");
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    await screen.findByRole("heading", { name: "With your solar panels" });
    expect(within(summary()).getByText("Hour by hour against your E-REDES file, with a typical year's production on the same dates.")).toBeTruthy();
  });
});

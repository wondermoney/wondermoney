// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_OFFERS } from "@/lib/calculators/electricityTariffComparison.fixtures";
import { DEFAULT_OFFER_FILTERS, MONTH_DAYS, runComparator, splitTotal, type ComparatorRequest } from "@/lib/calculators/electricityTariffComparator";
import { loadSolarDistrict, SolarProductionError, solarBillSaving, solarConsumption, yearlyBalance } from "@/lib/calculators/electricitySolar";
import type { SolarProductionQuery, SolarProductionResponse } from "@/lib/calculators/solarProductionQuery";
import { encodeTypicalYear } from "@/lib/calculators/solarPvgis";
import type { OffersLoader } from "./ElectricityTariffComparisonComp";
import type { SolarLoader, SolarProductionLoader } from "./ElectricitySolarPanel";

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

async function renderPage(loadSolar: SolarLoader, loadSolarProduction?: SolarProductionLoader) {
  render(<ElectricityTariffComparisonComp locale="en" loadOffers={loadOffers} loadSolar={loadSolar} loadSolarProduction={loadSolarProduction} />);
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

/** A route double that answers with Faro's table for whatever was asked, so the figures differ from Lisboa's. */
function routeAnswering(): SolarProductionLoader {
  return async (query: SolarProductionQuery) => {
    const typicalYear = await loadSolarDistrict("faro");
    const response: SolarProductionResponse = {
      days: encodeTypicalYear(Array.from(typicalYear)),
      yearlyKwhPerKwp: 1700,
      monthsSelected: [2021, 2023, 2023, 2012, 2016, 2022, 2019, 2019, 2012, 2020, 2008, 2010],
      source: { name: "PVGIS 5.3", url: "https://example.org", version: "5.3", radiationDb: "PVGIS-SARAH3", meteoDb: "ERA5", yearMin: 2005, yearMax: 2023 },
      params: { ...query, peakpower: 1 },
    };
    return { typicalYear, response };
  };
}

/** What the summary shows for 2 kWp on a typical year. */
async function productionOf(typicalYear: ArrayLike<number>) {
  const solar = solarConsumption({ consumption: REQUEST.consumption, readings: null, contractedPower: 3.45, cycle: "daily", system: { typicalYear, kwp: 2, lossPercent: 14 } });
  return `${int(yearlyBalance(solar.balance, MONTH_DAYS).production)} kWh`;
}

const LIVE = { timeout: 4000 };

describe("solar panels at any tilt, orientation and location", () => {
  it("asks the route for another tilt and orientation at the district capital, and describes that system", async () => {
    const route = vi.fn(routeAnswering());
    const loader = vi.fn(loadSolarDistrict);
    await renderPage(loader, route);
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    await screen.findByRole("heading", { name: "With your solar panels" });
    // South at the optimal tilt: the committed table, no route call.
    expect(route).not.toHaveBeenCalled();
    expect(screen.getByText(/Leave it empty for PVGIS's optimal tilt at Lisboa \(33°\)/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Tilt"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Orientation"), { target: { value: "SE" } });
    expect(screen.getByText("Asking PVGIS for your tilt, orientation and location…")).toBeTruthy();
    expect(await within(await screen.findByRole("region", { name: "With your solar panels" }, LIVE)).findByText("2.0 kWp in Lisboa, tilted 20° and facing south-east. Figures for a year.", {}, LIVE)).toBeTruthy();
    // One request, after the typing stopped, for the capital's coordinates rounded to 0.05°.
    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][0]).toEqual({ lat: 38.7, lon: -9.15, angle: 20, aspect: -45, loss: 14 });
    expect(stat("Production")).toBe(await productionOf(await loadSolarDistrict("faro")));
    expect(within(summary()).getByText(/calculated by PVGIS for this tilt, orientation and place/)).toBeTruthy();

    // A custom azimuth.
    fireEvent.change(screen.getByLabelText("Orientation"), { target: { value: "custom" } });
    expect((screen.getByLabelText("Azimuth") as HTMLInputElement).value).toBe("-45");
    fireEvent.change(screen.getByLabelText("Azimuth"), { target: { value: "30" } });
    expect(await screen.findByText("2.0 kWp in Lisboa, tilted 20° at an azimuth of 30° (0° is south). Figures for a year.", {}, LIVE)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Azimuth"), { target: { value: "200" } });
    expect(screen.getByText("Enter an azimuth from -180 to 180°.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "With your solar panels" })).toBeNull();
  });

  it("falls back to the nearest district's table when the route fails, says so, and tries again on request", async () => {
    const route = vi.fn<SolarProductionLoader>(() => Promise.reject(new SolarProductionError("upstream_timeout")));
    await renderPage(loadSolarDistrict, route);
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    await screen.findByRole("heading", { name: "With your solar panels" });
    fireEvent.change(screen.getByLabelText("Tilt"), { target: { value: "20" } });

    const notice = "PVGIS could not be reached, so the estimate uses the table for Lisboa: panels facing south at 33°.";
    expect((await screen.findAllByText(notice, {}, LIVE)).length).toBe(2);
    // The summary describes the table it used, with Lisboa's own production.
    expect(within(summary()).getByText("2.0 kWp in Lisboa, facing south at 33°. Figures for a year.")).toBeTruthy();
    expect(stat("Production")).toBe(await productionOf(await loadSolarDistrict("lisboa")));

    route.mockImplementation(routeAnswering());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2.0 kWp in Lisboa, tilted 20° and facing south. Figures for a year.", {}, LIVE)).toBeTruthy();
    expect(route).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(notice)).toBeNull();
  });

  it("sends exact coordinates only in coordinates mode, says where they go, and falls back to the nearest capital", async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => success({ coords: { latitude: 41.18123, longitude: -8.69456 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    const route = vi.fn<SolarProductionLoader>(() => Promise.reject(new SolarProductionError("location_unavailable")));
    await renderPage(loadSolarDistrict, route);
    fireEvent.click(screen.getByLabelText("Add solar panels"));
    expect(screen.queryByText(/are sent to the WonderMoney server and from there to PVGIS/)).toBeNull();

    fireEvent.click(screen.getByLabelText("Exact coordinates"));
    // Starts from the chosen capital's coordinates.
    expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("38.7223");
    expect(screen.getByText(/these coordinates, rounded to about 5 km in your browser, are sent to the WonderMoney server and from there to PVGIS/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "40.42" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-3.70" } });
    expect(screen.getByText("Enter a point in mainland Portugal, Madeira or the Azores.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Use my exact location" }));
    expect((screen.getByLabelText("Latitude") as HTMLInputElement).value).toBe("41.1812");
    expect(screen.getByText("Coordinates filled in from your location.")).toBeTruthy();
    expect(
      (await screen.findAllByText("PVGIS has no data for that point (it may be over the sea), so the estimate uses the table for Porto: panels facing south at 36°.", {}, LIVE)).length,
    ).toBeGreaterThan(0);
    expect(route).toHaveBeenCalledTimes(1);
    expect(route.mock.calls[0][0]).toEqual({ lat: 41.2, lon: -8.7, angle: 36, aspect: 0, loss: 14 });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();

    route.mockImplementation(routeAnswering());
    fireEvent.change(screen.getByLabelText("Tilt"), { target: { value: "30" } });
    expect(await screen.findByText("2.0 kWp at 41.20° N, 8.70° W, tilted 30° and facing south. Figures for a year.", {}, LIVE)).toBeTruthy();
  });
});

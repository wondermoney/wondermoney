// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  FUEL_STATIONS_SOURCE,
  NATIONAL_STATIONS,
  cheapestStations,
  loadDistrict,
} from "@/lib/calculators/fuelStations";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/fuel-prices-portugal",
}));

const { default: CheapestStations } = await import("./CheapestStations");

afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
  vi.useRealTimers();
});

const eur3 = (value: number) =>
  new Intl.NumberFormat("en", { style: "currency", currency: "EUR", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value);

function renderEn() {
  return render(
    <ReactTranslationsProvider locale="en">
      <CheapestStations />
    </ReactTranslationsProvider>,
  );
}

it("lists mainland Portugal's cheapest stations with the snapshot date, then a district and a municipality", async () => {
  renderEn();
  const date = FUEL_STATIONS_SOURCE.fetchedAt.slice(0, 10);
  expect(screen.getByText(new RegExp(`taken on ${date} at`))).toBeTruthy();

  const national = cheapestStations(NATIONAL_STATIONS, "", "diesel")!;
  const list = screen.getByRole("list");
  expect(within(list).getAllByRole("listitem")).toHaveLength(national.stations.length);
  expect(within(list).getAllByText(national.stations[0].label).length).toBeGreaterThan(0);
  expect(national.stations[0].name).toBeNull();
  expect(national.stations[0].label).toMatch(/ · /);
  expect(within(list).getAllByText(`${eur3(national.stations[0].price)}/L`).length).toBeGreaterThan(0);
  const map = within(list).getAllByRole("link", { name: /See on the map/ })[0];
  expect(map.getAttribute("href")).toBe(national.stations[0].mapUrl);
  expect(map.getAttribute("rel")).toContain("noopener");
  expect((screen.getByLabelText("Municipality") as HTMLSelectElement).disabled).toBe(true);
  expect(pushGtmEvent).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText("District"), { target: { value: "lisboa" } });
  const lisboa = await loadDistrict("lisboa");
  const districtList = cheapestStations(lisboa, "", "diesel")!;
  await waitFor(() => expect(screen.getAllByText(districtList.stations[0].label).length).toBeGreaterThan(0));
  expect(screen.getByText(/Stations with a price for Diesel \(gasóleo simples\) in Lisboa:/)).toBeTruthy();
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
  expect(pushGtmEvent).toHaveBeenCalledWith({ event: "tool_used", tool: "fuel_stations", page_type: "tools/fuel-prices-portugal" });

  const municipality = screen.getByLabelText("Municipality") as HTMLSelectElement;
  expect(municipality.disabled).toBe(false);
  fireEvent.change(municipality, { target: { value: "Sintra" } });
  const sintra = cheapestStations(lisboa, "Sintra", "diesel")!;
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(sintra.stations.length);
  expect(screen.getByText(/in Sintra:/)).toBeTruthy();

  fireEvent.change(screen.getByLabelText("Fuel type"), { target: { value: "lpg" } });
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);

  const cta = screen.getByRole("link", { name: "Save the monthly difference toward a goal" });
  expect(cta.getAttribute("href")).toMatch(/^\/en\//);
  fireEvent.click(cta);
  expect(pushGtmEvent).toHaveBeenLastCalledWith({ event: "cta_click", cta_position: "tool_result", page_type: "tools/fuel-prices-portugal" });
});

it("says so when a municipality has no station for a fuel", async () => {
  const lists = await Promise.all(
    ["beja", "braganca", "evora", "guarda", "portalegre", "vila-real", "viseu", "castelo-branco"].map(async (slug) => ({
      slug,
      data: await loadDistrict(slug),
    })),
  );
  const empty = lists
    .flatMap(({ slug, data }) => Object.keys(data.areas).filter((name) => name && !data.areas[name].lpg).map((name) => ({ slug, name })))
    .at(0);
  if (!empty) return; // Every municipality sells LPG in this snapshot.

  renderEn();
  fireEvent.change(screen.getByLabelText("District"), { target: { value: empty.slug } });
  await waitFor(() => expect((screen.getByLabelText("Municipality") as HTMLSelectElement).disabled).toBe(false));
  await waitFor(() => expect(screen.queryByText(/Loading the stations/)).toBeNull());
  fireEvent.change(screen.getByLabelText("Municipality"), { target: { value: empty.name } });
  fireEvent.change(screen.getByLabelText("Fuel type"), { target: { value: "lpg" } });
  expect(screen.getByText(new RegExp(`No station in ${empty.name} reports a price for Autogas`))).toBeTruthy();
});

it("warns on the visitor's clock when the snapshot is days old, and not before", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse(FUEL_STATIONS_SOURCE.fetchedAt) + 4 * 86_400_000);
  renderEn();
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.getByText(/This list is 4 days old/)).toBeTruthy();
  cleanup();

  vi.setSystemTime(Date.parse(FUEL_STATIONS_SOURCE.fetchedAt) + 3_600_000);
  renderEn();
  expect(screen.queryByRole("status")).toBeNull();
});

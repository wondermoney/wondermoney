// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  FUEL_STATIONS_SOURCE,
  NATIONAL_STATIONS,
  cheapestStations,
  districtsNear,
  loadDistrict,
  stationsNear,
} from "@/lib/calculators/fuelStations";
import { ReactTranslationsProvider } from "@/lib/reactTranslations";

const pushGtmEvent = vi.fn();
vi.mock("@/lib/gtm", () => ({
  pushGtmEvent: (payload: unknown) => pushGtmEvent(payload),
  getPageType: () => "tools/fuel-prices-portugal",
}));

// jsdom has no WebGL: the map is a stub that lists what it was given.
vi.mock("./StationsMap", () => ({
  default: ({ stations, origin }: { stations: Array<{ id: number }>; origin: unknown }) => (
    <div data-testid="stations-map" data-stations={stations.map((station) => station.id).join(",")} data-origin={origin ? "yes" : "no"} />
  ),
}));

const { default: CheapestStations } = await import("./CheapestStations");

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
afterEach(() => {
  cleanup();
  pushGtmEvent.mockClear();
  vi.useRealTimers();
  if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
  else delete (navigator as { geolocation?: Geolocation }).geolocation;
});

const LISBON = { lat: 38.7223, lon: -9.1393 };
type PositionCallback = (position: GeolocationPosition) => void;
type ErrorCallback = (error: GeolocationPositionError) => void;
/** Installs a geolocation that answers with `answer` and records its calls. */
function mockGeolocation(answer: (success: PositionCallback, failure: ErrorCallback) => void) {
  const getCurrentPosition = vi.fn((success: PositionCallback, failure: ErrorCallback) => answer(success, failure));
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
  return getCurrentPosition;
}
const positionError = (code: number) =>
  ({ code, message: "", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) as GeolocationPositionError;

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

  fireEvent.click(screen.getByRole("button", { name: "LPG" }));
  expect(screen.getByRole("button", { name: "LPG" }).getAttribute("aria-pressed")).toBe("true");
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
  fireEvent.click(screen.getByRole("button", { name: "LPG" }));
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

it("asks for the location only when near me is tapped, then lists the cheapest within the radius with their distance", async () => {
  const getCurrentPosition = mockGeolocation((success) =>
    success({ coords: { latitude: LISBON.lat, longitude: LISBON.lon } } as GeolocationPosition),
  );
  renderEn();
  expect(getCurrentPosition).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Near me" }));
  expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  const files = await Promise.all(districtsNear(LISBON, 25).map(loadDistrict));
  const within10 = stationsNear(files, LISBON, 10, "diesel")!;
  await waitFor(() => expect(screen.getByText(/Stations with a price for Diesel \(gasóleo simples\) within 10 km:/)).toBeTruthy());
  expect(screen.getByRole("button", { name: "Near me" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByLabelText("District")).toBeNull();
  const rows = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(rows).toHaveLength(within10.stations.length);
  expect(within(rows[0]).getByText(within10.stations[0].label)).toBeTruthy();
  expect(within(rows[0]).getByText(/^\d+(\.\d)? km$/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "25 km" }));
  const within25 = stationsNear(files, LISBON, 25, "diesel")!;
  expect(screen.getByText(new RegExp(`within 25 km: ${within25.count.toLocaleString("en")}\\.`))).toBeTruthy();

  // The map loads only when asked for, with the listed stations and the visitor's dot.
  expect(screen.queryByTestId("stations-map")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Map" }));
  const map = await screen.findByTestId("stations-map");
  expect(map.getAttribute("data-stations")).toBe(within25.stations.map((station) => station.id).join(","));
  expect(map.getAttribute("data-origin")).toBe("yes");

  // Analytics learn that the tool was used, never where.
  expect(pushGtmEvent).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(pushGtmEvent.mock.calls)).not.toMatch(/38\.7|9\.1|lat|lon/);

  fireEvent.click(screen.getByRole("button", { name: "Pick a district and municipality" }));
  expect(screen.getByLabelText("District")).toBeTruthy();
  expect(screen.getByText(/in All of mainland Portugal:/)).toBeTruthy();
});

it.each([
  ["denied", 1, /No access to your location\. Pick a district\./],
  ["timed out", 3, /Finding your location took too long/],
  ["unavailable", 2, /Your location could not be found/],
])("keeps the district picker when the location is %s", async (_, code, message) => {
  mockGeolocation((_success, failure) => failure(positionError(code)));
  renderEn();
  fireEvent.click(screen.getByRole("button", { name: "Near me" }));
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Near me" }).getAttribute("aria-pressed")).toBe("false");
  // The picker works as before.
  fireEvent.change(screen.getByLabelText("District"), { target: { value: "faro" } });
  const faro = cheapestStations(await loadDistrict("faro"), "", "diesel")!;
  await waitFor(() => expect(screen.getAllByText(faro.stations[0].label).length).toBeGreaterThan(0));
});

it("says so in a browser without geolocation", async () => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
  renderEn();
  fireEvent.click(screen.getByRole("button", { name: "Near me" }));
  expect(await screen.findByText(/This browser does not share a location\. Pick a district\./)).toBeTruthy();
  expect(screen.getByLabelText("District")).toBeTruthy();
});

it("says so when no station is within the radius, as far from mainland Portugal", async () => {
  mockGeolocation((success) => success({ coords: { latitude: 32.65, longitude: -16.91 } } as GeolocationPosition));
  renderEn();
  fireEvent.click(screen.getByRole("button", { name: "Near me" }));
  expect(await screen.findByText("No station with a price for Diesel (gasóleo simples) within 10 km of you.")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
});

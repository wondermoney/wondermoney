import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FUEL_TYPES } from "./fuelCost";
import {
  FUEL_STATIONS_SOURCE,
  FUEL_STATION_DISTRICTS,
  NATIONAL_STATIONS,
  cheapestStations,
  loadDistrict,
  municipalitiesOf,
  savingAgainstMedian,
  stationLabel,
  stationMapUrl,
  type StationAreaData,
} from "./fuelStations";

const data: StationAreaData = {
  stations: {
    "1": ["Posto A", "MARCA", "Rua 1", "Vila", "1000-001", "Vila", 38.7, -9.1],
    "2": ["Posto B", "OUTRA", "Rua 2", "Vila", "1000-002", "Vila", null, null],
    "3": [null, "GALP", null, "Colmeias", "2420-003", "Leiria", null, null],
  },
  areas: {
    "": { diesel: { count: 12, median: 1.999, top: [[1, 1.899, "2026-11-20 10:55"], [2, 1.919, "2026-11-19 08:00"]] } },
    Vila: { diesel: { count: 2, median: 1.909, top: [[1, 1.899, "2026-11-20 10:55"]] } },
  },
};

describe("committed station snapshot", () => {
  it("holds no station name and no street: only a production build writes them", () => {
    expect(FUEL_STATIONS_SOURCE.redacted).toBe(true);
    const dir = fileURLToPath(new URL("./data/fuelStations/", import.meta.url));
    const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
    expect(files).toHaveLength(18);
    const all = [
      ...Object.values(NATIONAL_STATIONS.stations),
      ...files.flatMap((file) => Object.values(JSON.parse(readFileSync(`${dir}${file}`, "utf8")).stations)),
    ] as unknown[][];
    expect(all.length).toBeGreaterThan(0);
    for (const station of all) {
      expect(station).toHaveLength(8);
      expect(station[0]).toBeNull();
      expect(station[2]).toBeNull();
    }
  });

  it("covers the 18 mainland districts, each with municipalities and a file", async () => {
    expect(FUEL_STATION_DISTRICTS).toHaveLength(18);
    for (const district of FUEL_STATION_DISTRICTS) {
      expect(district.municipalities.length).toBeGreaterThan(0);
      const file = await loadDistrict(district.slug);
      for (const fuel of ["diesel", "gasoline95"] as const) {
        const list = cheapestStations(file, "", fuel);
        expect(list, `${district.name} ${fuel}`).not.toBeNull();
        expect(list!.stations.length).toBeLessThanOrEqual(FUEL_STATIONS_SOURCE.top.district);
      }
      for (const municipality of district.municipalities) {
        const lists = FUEL_TYPES.map((fuel) => cheapestStations(file, municipality, fuel)).filter(Boolean);
        expect(lists.length, municipality).toBeGreaterThan(0);
        for (const list of lists) expect(list!.stations.length).toBeLessThanOrEqual(FUEL_STATIONS_SOURCE.top.municipality);
      }
    }
  });

  it("lists every fuel nationally, cheapest first, at or below the median", () => {
    for (const fuel of FUEL_TYPES) {
      const list = cheapestStations(NATIONAL_STATIONS, "", fuel);
      expect(list).not.toBeNull();
      const prices = list!.stations.map((station) => station.price);
      expect([...prices].sort((a, b) => a - b)).toEqual(prices);
      expect(prices[0]).toBeLessThanOrEqual(list!.median);
      for (const station of list!.stations) {
        expect(station.updated).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
        expect(station.mapUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
      }
    }
    expect(FUEL_STATIONS_SOURCE.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/);
    expect(FUEL_STATIONS_SOURCE.asOf).toBe(FUEL_STATIONS_SOURCE.fetchedAt.slice(0, 10));
  });

  it("refuses an unknown district and lists none for it", async () => {
    await expect(loadDistrict("../goldPrice")).rejects.toThrow(/No station data/);
    expect(municipalitiesOf("atlantis")).toEqual([]);
  });
});

describe("cheapestStations", () => {
  it("joins each price to its station, in DGEG's order", () => {
    expect(cheapestStations(data, "", "diesel")).toEqual({
      count: 12,
      median: 1.999,
      stations: [
        {
          id: 1,
          name: "Posto A",
          label: "Posto A",
          brand: "MARCA",
          address: "Rua 1, Vila, 1000-001",
          municipality: "Vila",
          price: 1.899,
          updated: "2026-11-20 10:55",
          mapUrl: "https://www.google.com/maps/search/?api=1&query=38.7%2C-9.1",
        },
        expect.objectContaining({ id: 2, price: 1.919 }),
      ],
    });
  });

  it("returns null for an area or fuel without stations", () => {
    expect(cheapestStations(data, "Vila", "lpg")).toBeNull();
    expect(cheapestStations(data, "Nowhere", "diesel")).toBeNull();
  });

  it("searches the map by label and address when there are no coordinates", () => {
    expect(stationMapUrl({ label: "Posto B", address: "Rua 2, Vila", lat: null, lon: null })).toBe(
      "https://www.google.com/maps/search/?api=1&query=Posto%20B%2C%20Rua%202%2C%20Vila",
    );
  });

  it("names a station without a name by its brand and locality, and keeps the rest", () => {
    const [nameless] = cheapestStations(
      { ...data, areas: { Leiria: { lpg: { count: 1, median: 0.9, top: [[3, 0.899, "2026-11-20 08:00"]] } } } },
      "Leiria",
      "lpg",
    )!.stations;
    expect(nameless).toEqual({
      id: 3,
      name: null,
      label: "GALP · Colmeias",
      brand: "GALP",
      address: "Colmeias, 2420-003",
      municipality: "Leiria",
      price: 0.899,
      updated: "2026-11-20 08:00",
      mapUrl: "https://www.google.com/maps/search/?api=1&query=GALP%20%C2%B7%20Colmeias%2C%20Colmeias%2C%202420-003",
    });
    expect(stationLabel(null, "", "Colmeias")).toBe("Colmeias");
    expect(stationLabel("Posto A", "MARCA", "Vila")).toBe("Posto A");
  });
});

describe("savingAgainstMedian", () => {
  it("is the median minus the cheapest price, per litre and on a 50 L tank", () => {
    const list = cheapestStations(data, "", "diesel")!;
    expect(savingAgainstMedian(list)).toEqual({ perLitre: 0.1, perTank: 5 });
    expect(savingAgainstMedian(list, 0)).toEqual({ perLitre: 0.1, perTank: 0 });
  });

  it("is never negative", () => {
    const list = { count: 1, median: 1.5, stations: [{ ...cheapestStations(data, "", "diesel")!.stations[0], price: 1.6 }] };
    expect(savingAgainstMedian(list)).toEqual({ perLitre: 0, perTank: 0 });
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FUEL_TYPES } from "./fuelCost";
import {
  FUEL_STATIONS_SOURCE,
  FUEL_STATION_DISTRICTS,
  NATIONAL_STATIONS,
  NEAR_LIMIT,
  NEAR_RADII_KM,
  cheapestStations,
  distanceKm,
  distanceToBoundsKm,
  districtsNear,
  loadDistrict,
  stationsNear,
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
          lat: 38.7,
          lon: -9.1,
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
      lat: null,
      lon: null,
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

describe("near-me search", () => {
  const lisbon = { lat: 38.7223, lon: -9.1393 };
  /** Three located stations east of Lisbon, at about 0, 8.7 and 21.7 km, and one without coordinates. */
  const near: StationAreaData = {
    stations: {
      "10": [null, "GALP", null, "Lisboa", "1000-001", "Lisboa", 38.7223, -9.1393],
      "11": [null, "BP", null, "Sacavém", "2685-001", "Loures", 38.7223, -9.0393],
      "12": [null, "PRIO", null, "Montijo", "2870-001", "Montijo", 38.7223, -8.8893],
      "13": [null, "REPSOL", null, "Lisboa", "1000-002", "Lisboa", null, null],
    },
    areas: {},
    all: {
      diesel: [
        [12, 1.799, "2026-11-20 08:00"],
        [11, 1.849, "2026-11-20 09:00"],
        [10, 1.899, "2026-11-20 10:00"],
      ],
      lpg: [[10, 0.899, "2026-11-20 10:00"]],
    },
  };

  it("measures great-circle distances in kilometres", () => {
    expect(distanceKm(lisbon, lisbon)).toBe(0);
    // Lisbon to Porto, about 274 km in a straight line.
    expect(distanceKm(lisbon, { lat: 41.1579, lon: -8.6291 })).toBeCloseTo(274, -1);
    expect(distanceKm(lisbon, { lat: 38.7223, lon: -9.0393 })).toBeCloseTo(8.7, 1);
  });

  it("measures the distance to a district's box as zero inside it and to its nearest edge outside", () => {
    const box = [38.6, -9.3, 38.8, -9.0] as const;
    expect(distanceToBoundsKm(lisbon, box)).toBe(0);
    expect(distanceToBoundsKm({ lat: 38.7, lon: -8.9 }, box)).toBeCloseTo(distanceKm({ lat: 38.7, lon: -8.9 }, { lat: 38.7, lon: -9.0 }), 6);
  });

  it("loads only the districts whose box the radius reaches", () => {
    expect(districtsNear(lisbon, 5)).toContain("lisboa");
    expect(districtsNear(lisbon, 5)).not.toContain("porto");
    expect(districtsNear({ lat: 41.1579, lon: -8.6291 }, 10)).toContain("porto");
    expect(districtsNear({ lat: 41.1579, lon: -8.6291 }, 10)).not.toContain("faro");
    // Funchal, Madeira: no mainland station is near.
    expect(districtsNear({ lat: 32.65, lon: -16.91 }, 25)).toEqual([]);
  });

  it("lists the stations within the radius, cheapest first, each with its distance", () => {
    const within10 = stationsNear([near], lisbon, 10, "diesel")!;
    expect(within10.count).toBe(2);
    expect(within10.median).toBe(1.874);
    expect(within10.stations.map((station) => [station.id, station.price])).toEqual([
      [11, 1.849],
      [10, 1.899],
    ]);
    expect(within10.stations[0].distanceKm).toBeCloseTo(8.7, 1);
    expect(within10.stations[0]).toMatchObject({ label: "BP · Sacavém", municipality: "Loures", updated: "2026-11-20 09:00" });
    expect(within10.stations[0].mapUrl).toContain("38.7223%2C-9.0393");
    const within25 = stationsNear([near], lisbon, 25, "diesel")!;
    expect(within25.stations.map((station) => station.id)).toEqual([12, 11, 10]);
  });

  it("caps the list, puts the nearer station first on a tie, and returns null when none is in reach", () => {
    const tie: StationAreaData = { ...near, all: { diesel: [[12, 1.8, "2026-11-20 08:00"], [10, 1.8, "2026-11-20 08:00"], [11, 1.8, "2026-11-20 08:00"]] } };
    expect(stationsNear([tie], lisbon, 25, "diesel")!.stations.map((station) => station.id)).toEqual([10, 11, 12]);
    expect(stationsNear([tie], lisbon, 25, "diesel", 2)!.stations).toHaveLength(2);
    expect(stationsNear([tie], lisbon, 25, "diesel", 2)!.count).toBe(3);
    expect(stationsNear([near], lisbon, 25, "gasoline95")).toBeNull();
    expect(stationsNear([near], { lat: 41.1579, lon: -8.6291 }, 25, "diesel")).toBeNull();
    expect(stationsNear([], lisbon, 25, "diesel")).toBeNull();
  });

  it("counts a station once when two district files list it", () => {
    expect(stationsNear([near, near], lisbon, 25, "diesel")!.count).toBe(3);
  });

  it("offers 5, 10 and 25 km and finds stations near a district capital in the committed snapshot", async () => {
    expect(NEAR_RADII_KM).toEqual([5, 10, 25]);
    const files = await Promise.all(districtsNear(lisbon, 10).map(loadDistrict));
    const list = stationsNear(files, lisbon, 10, "diesel")!;
    expect(list.stations.length).toBeGreaterThan(0);
    expect(list.stations.length).toBeLessThanOrEqual(NEAR_LIMIT);
    for (const station of list.stations) expect(station.distanceKm).toBeLessThanOrEqual(10);
  });
});

import { describe, expect, it } from "vitest";
import {
  CLUSTER_PROPERTIES,
  MAINLAND_PORTUGAL_BOUNDS,
  clusterCheapest,
  clusterLabel,
  fitPadding,
  initialViewBounds,
  stationFeatures,
} from "./stationMap";

const LISBON = { lat: 38.7223, lon: -9.1393 };
const PORTO = { lat: 41.1579, lon: -8.6291 };
const FARO = { lat: 37.0194, lon: -7.9304 };
const FUNCHAL = { lat: 32.6669, lon: -16.9241 };
const PONTA_DELGADA = { lat: 37.7412, lon: -25.6756 };
const MADRID = { lat: 40.4168, lon: -3.7038 };

const station = (price: number, lat: number | null, lon: number | null) => ({ price, lat, lon });

describe("initialViewBounds", () => {
  it("fits the listed stations when they lie inside mainland Portugal", () => {
    expect(initialViewBounds([LISBON, PORTO, FARO])).toEqual([FARO.lat, LISBON.lon, PORTO.lat, FARO.lon]);
  });

  it("is a point's own box for a single station", () => {
    expect(initialViewBounds([LISBON])).toEqual([LISBON.lat, LISBON.lon, LISBON.lat, LISBON.lon]);
  });

  it("leaves out Madeira, the Azores and Spain, so they never widen the view", () => {
    expect(initialViewBounds([LISBON, FUNCHAL, PONTA_DELGADA, MADRID, PORTO])).toEqual([LISBON.lat, LISBON.lon, PORTO.lat, PORTO.lon]);
  });

  it("is mainland Portugal when nothing listed lies inside it", () => {
    expect(initialViewBounds([])).toEqual(MAINLAND_PORTUGAL_BOUNDS);
    expect(initialViewBounds([FUNCHAL, PONTA_DELGADA])).toEqual(MAINLAND_PORTUGAL_BOUNDS);
  });

  it("never returns a box wider than the limit", () => {
    const [south, west, north, east] = MAINLAND_PORTUGAL_BOUNDS;
    const corners = [
      { lat: south, lon: west },
      { lat: north, lon: east },
      { lat: south - 5, lon: west - 5 },
      { lat: north + 5, lon: east + 5 },
    ];
    const [s, w, n, e] = initialViewBounds(corners);
    expect(s).toBeGreaterThanOrEqual(south);
    expect(w).toBeGreaterThanOrEqual(west);
    expect(n).toBeLessThanOrEqual(north);
    expect(e).toBeLessThanOrEqual(east);
  });

  it("takes another limit", () => {
    const limit = [38, -10, 39, -9] as const;
    expect(initialViewBounds([LISBON, PORTO], limit)).toEqual([LISBON.lat, LISBON.lon, LISBON.lat, LISBON.lon]);
    expect(initialViewBounds([PORTO], limit)).toEqual(limit);
  });

  it("holds mainland Portugal's extreme points", () => {
    const [south, west, north, east] = MAINLAND_PORTUGAL_BOUNDS;
    // Cabo de Santa Maria, Cabo da Roca, Cevide and Ifanes are on its edges; the islands are outside.
    expect([south, west, north, east]).toEqual([36.960158, -9.500552, 42.154058, -6.190217]);
    for (const point of [LISBON, PORTO, FARO]) {
      expect(point.lat).toBeGreaterThan(south);
      expect(point.lat).toBeLessThan(north);
      expect(point.lon).toBeGreaterThan(west);
      expect(point.lon).toBeLessThan(east);
    }
  });
});

describe("stationFeatures", () => {
  it("gives each located station a point with its price for the selected fuel and its place in the list", () => {
    const collection = stationFeatures([station(1.689, 38.7, -9.1), station(1.701, null, null), station(1.725, 41.1, -8.6)]);
    expect(collection.type).toBe("FeatureCollection");
    expect(collection.features).toEqual([
      { type: "Feature", geometry: { type: "Point", coordinates: [-9.1, 38.7] }, properties: { rank: 0, price: 1.689 } },
      { type: "Feature", geometry: { type: "Point", coordinates: [-8.6, 41.1] }, properties: { rank: 1, price: 1.725 } },
    ]);
  });

  it("is empty without located stations", () => {
    expect(stationFeatures([station(1.5, null, -9), station(1.6, 38, null)]).features).toEqual([]);
  });
});

describe("cluster cheapest price", () => {
  it("aggregates the points' price with MapLibre's min reducer", () => {
    // MapLibre reduces a string operator as [operator, ["accumulated"], ["get", key]] over the
    // values the map expression read from each point: here the lowest price.
    expect(CLUSTER_PROPERTIES).toEqual({ cheapest: ["min", ["get", "price"]] });
  });

  it("reads the cheapest price off a cluster", () => {
    expect(clusterCheapest({ cluster: true, point_count: 3, cheapest: 1.649 })).toBe(1.649);
  });

  it("is null when a cluster carries no usable price", () => {
    expect(clusterCheapest({ cluster: true, point_count: 2 })).toBeNull();
    expect(clusterCheapest({ cheapest: "1.6" })).toBeNull();
    expect(clusterCheapest({ cheapest: Number.NaN })).toBeNull();
    expect(clusterCheapest(null)).toBeNull();
  });

  it("formats the cheapest price like the station pills, in the page's locale", () => {
    expect(clusterLabel("pt", 1.649)).toBe("1,649");
    expect(clusterLabel("en", 1.649)).toBe("1.649");
    expect(clusterLabel("de", 1.6)).toBe("1,600");
  });
});

describe("fitPadding", () => {
  const base = { top: 56, bottom: 28, left: 40, right: 56 };

  it("is the pills' padding on a map no wider than it may fit", () => {
    expect(fitPadding(343, 320)).toEqual(base);
    expect(fitPadding(700, 512)).toEqual(base);
  });

  it("pads a wide map's sides alike, so the fit spans at most 1.6 heights", () => {
    const padding = fitPadding(1136, 512);
    expect(padding.top).toBe(base.top);
    expect(padding.bottom).toBe(base.bottom);
    expect(padding.left - base.left).toBeCloseTo(padding.right - base.right, 6);
    expect(padding.left).toBeGreaterThan(base.left);
    expect(1136 - padding.left - padding.right).toBeCloseTo(1.6 * 512, 6);
  });

  it("never pads a map without a size into a negative area", () => {
    expect(fitPadding(0, 0)).toEqual(base);
  });
});

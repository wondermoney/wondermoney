import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSolarProduction, loadSolarDistrict, SolarProductionError, solarSite, solarSiteErrors, type SolarSiteInput } from "./electricitySolar";
import type { SolarProductionResponse } from "./solarProductionQuery";
import { encodeTypicalYear } from "./solarPvgis";

const LISBOA: SolarSiteInput = { location: "district", district: "lisboa", lat: Number.NaN, lon: Number.NaN, tilt: Number.NaN, aspect: 0 };

afterEach(() => vi.unstubAllGlobals());

describe("where the production comes from", () => {
  it("uses the district's table facing south at its optimal tilt, and the route for anything else", () => {
    expect(solarSite(LISBOA)).toMatchObject({ kind: "table", district: { slug: "lisboa" } });
    expect(solarSite({ ...LISBOA, tilt: 33 })).toMatchObject({ kind: "table" });
    expect(solarSite({ ...LISBOA, tilt: 20 })).toMatchObject({
      kind: "pvgis",
      query: { lat: 38.7, lon: -9.15, angle: 20, aspect: 0, loss: 14 },
      district: { slug: "lisboa" },
      fallback: { slug: "lisboa" },
    });
    expect(solarSite({ ...LISBOA, aspect: 90 })).toMatchObject({ kind: "pvgis", query: { angle: 33, aspect: 90 } });
    // Exact coordinates always go to the route, rounded, with the nearest capital as the fallback.
    expect(solarSite({ ...LISBOA, location: "coordinates", lat: 37.0194, lon: -7.9322 })).toMatchObject({
      kind: "pvgis",
      query: { lat: 37, lon: -7.95, angle: 34, aspect: 0, loss: 14 },
      district: null,
      fallback: { slug: "faro" },
    });
  });

  it("flags missing coordinates, a point outside Portugal, and a tilt or azimuth out of range", () => {
    const coordinates = { ...LISBOA, location: "coordinates" as const };
    expect(solarSiteErrors(coordinates)).toEqual({ lat: "required", lon: "required" });
    expect(solarSiteErrors({ ...coordinates, lat: 40.42, lon: -3.7 })).toEqual({ lat: "outsideCoverage" });
    expect(solarSiteErrors({ ...coordinates, lat: 32.65, lon: -16.9 })).toEqual({});
    expect(solarSiteErrors({ ...LISBOA, tilt: 91 })).toEqual({ tilt: "outOfRange" });
    expect(solarSiteErrors({ ...LISBOA, aspect: Number.NaN })).toEqual({ aspect: "required" });
    expect(solarSiteErrors({ ...LISBOA, aspect: 181 })).toEqual({ aspect: "outOfRange" });
    expect(solarSite({ ...LISBOA, tilt: 91 })).toBeNull();
    // In district mode the coordinates fields are not read.
    expect(solarSiteErrors(LISBOA)).toEqual({});
  });
});

describe("fetchSolarProduction", () => {
  async function answer(query = { lat: 38.7, lon: -9.15, angle: 20, aspect: -45, loss: 14 }): Promise<SolarProductionResponse> {
    return {
      days: encodeTypicalYear(Array.from(await loadSolarDistrict("lisboa"))),
      yearlyKwhPerKwp: 1500,
      monthsSelected: [],
      source: { name: "PVGIS 5.3", url: "https://example.org", version: "5.3", radiationDb: "PVGIS-SARAH3", meteoDb: "ERA5", yearMin: 2005, yearMax: 2023 },
      params: { ...query, peakpower: 1 },
    };
  }

  it("asks the route with the canonical, rounded query and decodes the typical year", async () => {
    const body = await answer();
    const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await fetchSolarProduction({ lat: 38.7223, lon: -9.1393, angle: 20.2, aspect: -45, loss: 14 });
    expect(fetch).toHaveBeenCalledWith("/api/solar-production?lat=38.70&lon=-9.15&angle=20&aspect=-45&loss=14", expect.anything());
    expect(Array.from(result.typicalYear)).toEqual(Array.from(await loadSolarDistrict("lisboa")));
    expect(result.response.params.angle).toBe(20);
  });

  it("fails with the route's code, on an answer for another query, and when the network fails", async () => {
    const query = { lat: 38.7, lon: -9.15, angle: 20, aspect: -45, loss: 14 };
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "location_unavailable" }), { status: 422 }));
    await expect(fetchSolarProduction(query)).rejects.toMatchObject({ code: "location_unavailable" });
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 504 }));
    await expect(fetchSolarProduction(query)).rejects.toMatchObject({ code: "upstream_error" });
    const other = await answer({ ...query, angle: 35 });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(other), { status: 200 }));
    await expect(fetchSolarProduction(query)).rejects.toMatchObject({ code: "bad_response" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ...(await answer()), days: [[0]] }), { status: 200 }));
    await expect(fetchSolarProduction(query)).rejects.toMatchObject({ code: "bad_response" });
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchSolarProduction(query)).rejects.toBeInstanceOf(SolarProductionError);
  });

  it("gives up after 55 seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      const pending = fetchSolarProduction({ lat: 38.7, lon: -9.15, angle: 20, aspect: 0, loss: 14 });
      const settled = expect(pending).rejects.toMatchObject({ code: "timeout" });
      await vi.advanceTimersByTimeAsync(55_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});

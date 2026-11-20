import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSolarProductionHandler, ERROR_CACHE_CONTROL, SUCCESS_CACHE_CONTROL } from "./solarProductionApi";
import { inSolarCoverage, parseSolarQuery, roundSolarQuery, solarQueryString, type SolarProductionResponse } from "./solarProductionQuery";
import { decodeTypicalYear } from "./solarPvgis";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../scripts/fixtures/pvgis/${name}`, import.meta.url), "utf8"));

interface SeriesResponse {
  inputs: {
    meteo_data: { year_min: number; year_max: number };
    mounting_system: { fixed: { slope: { value: number }; azimuth: { value: number } } };
    pv_module: { system_loss: number };
  };
  outputs: { hourly: { time: string; P: number }[] };
}

const TMY = fixture("tmy-lisboa-trimmed.json");
const SERIES = fixture("seriescalc-lisboa-2023-two-days.json") as SeriesResponse;
/** The years the Lisbon TMY fixture selects. */
const TMY_YEARS = [2008, 2010, 2012, 2016, 2019, 2020, 2021, 2022, 2023];

/** A seriescalc response for `year` echoing the system asked for in `url`: 10 hours a day at `watts` W. */
function seriesFor(url: URL, watts: number) {
  const year = Number(url.searchParams.get("startyear"));
  const response = structuredClone(SERIES);
  response.inputs.meteo_data.year_min = year;
  response.inputs.meteo_data.year_max = year;
  response.inputs.mounting_system.fixed.slope.value = Number(url.searchParams.get("angle"));
  response.inputs.mounting_system.fixed.azimuth.value = Number(url.searchParams.get("aspect"));
  response.inputs.pv_module.system_loss = Number(url.searchParams.get("loss"));
  const hourly = [];
  for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 3_600_000) {
    const date = new Date(t);
    const stamp = `${year}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}:${String(date.getUTCHours()).padStart(2, "0")}10`;
    hourly.push({ time: stamp, P: date.getUTCHours() >= 8 && date.getUTCHours() < 18 ? watts : 0 });
  }
  response.outputs.hourly = hourly;
  return response;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** A PVGIS double: `respond` can override any call; otherwise it answers as PVGIS would. */
function pvgis(respond?: (url: URL, call: number, signal: AbortSignal) => Response | Promise<Response | undefined> | undefined) {
  const calls: URL[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url);
    const signal = init?.signal;
    if (!(signal instanceof AbortSignal)) throw new Error("no timeout signal");
    const override = await respond?.(url, calls.length, signal);
    if (override) return override;
    if (url.pathname.endsWith("/tmy")) return ok(TMY);
    if (url.pathname.endsWith("/seriescalc")) return ok(seriesFor(url, 400));
    throw new Error(`unexpected ${url}`);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const CANONICAL = "lat=38.70&lon=-9.15&angle=20&aspect=-45&loss=14";
const get = (query: string, method = "GET") => new Request(`https://wonder.money/api/solar-production?${query}`, { method });

async function body<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

afterEach(() => vi.restoreAllMocks());

describe("GET /api/solar-production", () => {
  it("answers a typical year for 1 kWp at the tilt and orientation asked, cacheable at the CDN for 30 days", async () => {
    const { fetch, calls } = pvgis();
    const response = await createSolarProductionHandler({ fetch })(get(CANONICAL));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(SUCCESS_CACHE_CONTROL);
    expect(SUCCESS_CACHE_CONTROL).toBe("public, s-maxage=2592000, stale-while-revalidate=86400");
    expect(response.headers.get("Content-Type")).toContain("application/json");

    // One tmy call, then one seriescalc per selected year, at the rounded coordinates.
    expect(calls).toHaveLength(1 + TMY_YEARS.length);
    expect(calls[0].toString()).toBe("https://re.jrc.ec.europa.eu/api/v5_3/tmy?lat=38.70&lon=-9.15&outputformat=json");
    expect(calls.slice(1).map((url) => Number(url.searchParams.get("startyear"))).sort()).toEqual(TMY_YEARS);
    expect(calls[1].toString()).toMatch(
      /^https:\/\/re\.jrc\.ec\.europa\.eu\/api\/v5_3\/seriescalc\?lat=38\.70&lon=-9\.15&outputformat=json&peakpower=1&loss=14&angle=20&aspect=-45&pvcalculation=1&startyear=\d{4}&endyear=\d{4}$/,
    );

    const result = await body<SolarProductionResponse>(response);
    expect(result.params).toEqual({ lat: 38.7, lon: -9.15, angle: 20, aspect: -45, loss: 14, peakpower: 1 });
    expect(result.source).toMatchObject({ version: "5.3", radiationDb: "PVGIS-SARAH3", meteoDb: "ERA5", yearMin: 2005, yearMax: 2023 });
    expect(result.monthsSelected).toEqual([2021, 2023, 2023, 2012, 2016, 2022, 2019, 2019, 2012, 2020, 2008, 2010]);
    expect(result.days).toHaveLength(365);
    expect(result.days[0]).toEqual([8, 400, 400, 400, 400, 400, 400, 400, 400, 400, 400]);
    expect(decodeTypicalYear(result.days).reduce((sum, value) => sum + value, 0)).toBe(365 * 10 * 400);
    expect(result.yearlyKwhPerKwp).toBe(1460);
  });

  it("sends PVGIS at most two calls at a time, as it answers fastest that way", async () => {
    let inFlight = 0;
    let most = 0;
    const { fetch, calls } = pvgis(async () => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return undefined;
    });
    expect((await createSolarProductionHandler({ fetch })(get(CANONICAL))).status).toBe(200);
    expect(calls).toHaveLength(1 + TMY_YEARS.length);
    expect(most).toBe(2);
  });

  it("redirects any other spelling of a query to its rounded, canonical form without calling PVGIS", async () => {
    const { fetch, calls } = pvgis();
    const handle = createSolarProductionHandler({ fetch });
    for (const query of [
      "lat=38.7223&lon=-9.1393&angle=20.4&aspect=-44.6&loss=14.2",
      "lon=-9.15&lat=38.70&angle=20&aspect=-45&loss=14",
      "lat=38.70&lon=-9.15&angle=20&aspect=-45",
      `${CANONICAL}&peakpower=3`,
    ]) {
      const response = await handle(get(query));
      expect(response.status).toBe(308);
      expect(response.headers.get("Location")).toBe(`/api/solar-production?${CANONICAL}`);
      expect(response.headers.get("Cache-Control")).toBe(SUCCESS_CACHE_CONTROL);
    }
    expect(calls).toHaveLength(0);
  });

  it("rounds coordinates to 0.05°, angle and aspect to a degree and losses to 1 %, and sends ±180 as PVGIS reads it", () => {
    expect(roundSolarQuery({ lat: 41.1579, lon: -8.6291, angle: 33.5, aspect: 89.4, loss: 13.6 })).toEqual({ lat: 41.15, lon: -8.65, angle: 34, aspect: 89, loss: 14 });
    expect(roundSolarQuery({ lat: 38.024, lon: -7.876, angle: 0.2, aspect: -0.3, loss: 0 })).toEqual({ lat: 38, lon: -7.9, angle: 0, aspect: 0, loss: 0 });
    expect(solarQueryString({ lat: 38, lon: -7.9, angle: 0, aspect: 180, loss: 0 })).toBe("lat=38.00&lon=-7.90&angle=0&aspect=-179&loss=0");
    expect(solarQueryString({ lat: 38, lon: -7.9, angle: 0, aspect: -180, loss: 0 })).toBe("lat=38.00&lon=-7.90&angle=0&aspect=-179&loss=0");
  });

  it("rejects a missing, non-numeric or out-of-range value, or a point outside Portugal, with 400 and a code", async () => {
    const { fetch, calls } = pvgis();
    const handle = createSolarProductionHandler({ fetch });
    const cases: [string, Record<string, string>][] = [
      ["lon=-9.15&angle=20&aspect=0", { error: "missing_parameter", parameter: "lat" }],
      ["lat=&lon=-9.15&angle=20&aspect=0", { error: "missing_parameter", parameter: "lat" }],
      ["lat=abc&lon=-9.15&angle=20&aspect=0", { error: "not_a_number", parameter: "lat" }],
      ["lat=38.7&lon=-9.15&angle=1e1&aspect=0", { error: "not_a_number", parameter: "angle" }],
      ["lat=38.7&lon=-9.15&angle=20&aspect=Infinity", { error: "not_a_number", parameter: "aspect" }],
      ["lat=38.7&lon=-9.15&angle=20&aspect=0x10", { error: "not_a_number", parameter: "aspect" }],
      ["lat=38.7&lon=-9.15&angle=20&aspect=0&loss=%2014", { error: "not_a_number", parameter: "loss" }],
      ["lat=91&lon=-9.15&angle=20&aspect=0", { error: "out_of_range", parameter: "lat" }],
      ["lat=38.7&lon=-181&angle=20&aspect=0", { error: "out_of_range", parameter: "lon" }],
      ["lat=38.7&lon=-9.15&angle=91&aspect=0", { error: "out_of_range", parameter: "angle" }],
      ["lat=38.7&lon=-9.15&angle=-1&aspect=0", { error: "out_of_range", parameter: "angle" }],
      ["lat=38.7&lon=-9.15&angle=20&aspect=-181", { error: "out_of_range", parameter: "aspect" }],
      ["lat=38.7&lon=-9.15&angle=20&aspect=0&loss=51", { error: "out_of_range", parameter: "loss" }],
      // Madrid, Paris, the open Atlantic between the mainland and Madeira.
      ["lat=40.42&lon=-3.70&angle=20&aspect=0", { error: "outside_coverage" }],
      ["lat=48.85&lon=2.35&angle=20&aspect=0", { error: "outside_coverage" }],
      ["lat=35.00&lon=-13.00&angle=20&aspect=0", { error: "outside_coverage" }],
    ];
    for (const [query, error] of cases) {
      const response = await handle(get(query));
      expect(response.status, query).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe(ERROR_CACHE_CONTROL);
      expect(await body(response), query).toEqual(error);
    }
    expect(calls).toHaveLength(0);
  });

  it("covers the mainland, Madeira and the Azores", () => {
    const valid = (lat: number, lon: number) => parseSolarQuery(new URLSearchParams({ lat: String(lat), lon: String(lon), angle: "30", aspect: "0" })).ok;
    for (const [lat, lon] of [
      [41.8061, -6.7567], // Bragança
      [37.0194, -7.9322], // Faro
      [38.7223, -9.1393], // Lisboa
      [32.6669, -16.9241], // Funchal
      [33.06, -16.34], // Porto Santo
      [37.7412, -25.6756], // Ponta Delgada
      [39.45, -31.2], // Flores
      [36.95, -25.1], // Santa Maria
    ]) {
      expect(inSolarCoverage(lat, lon), `${lat}, ${lon}`).toBe(true);
      expect(valid(lat, lon)).toBe(true);
    }
  });

  it("answers 405 to any method but GET and HEAD", async () => {
    const { fetch, calls } = pvgis();
    const response = await createSolarProductionHandler({ fetch })(get(CANONICAL, "POST"));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
    expect(await body(response)).toEqual({ error: "method_not_allowed" });
    expect(calls).toHaveLength(0);
  });

  it("retries a failed PVGIS call once", async () => {
    const { fetch, calls } = pvgis((_url, call) => (call === 1 ? new Response("busy", { status: 503 }) : undefined));
    const response = await createSolarProductionHandler({ fetch })(get(CANONICAL));
    expect(response.status).toBe(200);
    expect(calls[0].pathname).toMatch(/tmy$/);
    expect(calls[1].pathname).toMatch(/tmy$/);
  });

  it("answers 502, not cached, when PVGIS fails twice or answers something else, without logging the coordinates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const down = pvgis(() => new Response("down", { status: 500 }));
    const response = await createSolarProductionHandler({ fetch: down.fetch })(get(CANONICAL));
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe(ERROR_CACHE_CONTROL);
    expect(await body(response)).toEqual({ error: "upstream_error" });
    expect(down.calls).toHaveLength(2);

    const offline = pvgis(() => Promise.reject(new TypeError("fetch failed")));
    expect((await createSolarProductionHandler({ fetch: offline.fetch })(get(CANONICAL))).status).toBe(502);
    expect(offline.calls).toHaveLength(2);

    // A series for another tilt than the one asked.
    const wrong = pvgis((url) => {
      if (!url.pathname.endsWith("/seriescalc")) return undefined;
      const series = seriesFor(url, 400);
      series.inputs.mounting_system.fixed.slope.value = 35;
      return ok(series);
    });
    const mismatch = await createSolarProductionHandler({ fetch: wrong.fetch })(get(CANONICAL));
    expect(mismatch.status).toBe(502);
    expect(await body(mismatch)).toEqual({ error: "upstream_error" });

    for (const [message] of warn.mock.calls) {
      expect(String(message)).not.toMatch(/38\.7|9\.15/);
      expect(String(message)).toMatch(/^solar-production: upstream_error/);
    }
  });

  it("answers 422 when PVGIS has no data for the point, without retrying", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sea = pvgis(() => new Response(JSON.stringify({ message: "Location over the sea. Please, select another location", status: 400 }), { status: 400 }));
    const response = await createSolarProductionHandler({ fetch: sea.fetch })(get("lat=38.00&lon=-9.50&angle=20&aspect=0&loss=14"));
    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe(ERROR_CACHE_CONTROL);
    expect(await body(response)).toEqual({ error: "location_unavailable" });
    expect(sea.calls).toHaveLength(1);
  });

  it("gives up on a PVGIS call after its timeout, retried once, with 504", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const hanging = pvgis(
      (_url, _call, signal) => new Promise<Response>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))),
    );
    const started = Date.now();
    const response = await createSolarProductionHandler({ fetch: hanging.fetch, timeoutMs: 50 })(get(CANONICAL));
    expect(response.status).toBe(504);
    expect(await body(response)).toEqual({ error: "upstream_timeout" });
    expect(response.headers.get("Cache-Control")).toBe(ERROR_CACHE_CONTROL);
    expect(hanging.calls).toHaveLength(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("stops at the request's deadline", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const slow = pvgis(async (url) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return url.pathname.endsWith("/tmy") ? ok(TMY) : undefined;
    });
    const response = await createSolarProductionHandler({ fetch: slow.fetch, timeoutMs: 1000, deadlineMs: 20 })(get(CANONICAL));
    expect(response.status).toBe(504);
  });
});

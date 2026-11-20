// The handler behind src/pages/api/solar-production.ts: a typical year of hourly PV production for
// any tilt, orientation and location in Portugal, from PVGIS (EU JRC), which a browser cannot call
// (no CORS). The query, its limits and the response are in solarProductionQuery.ts.
//
// - Validation: a missing, non-numeric or out-of-range value, or a point outside SOLAR_COVERAGE, is
//   a 400 with a JSON error code. A valid query spelt otherwise than its canonical form (more
//   decimals, another order, extra parameters) is redirected to it, so the CDN caches one URL per
//   rounded query and PVGIS is asked at most once per URL and cache lifetime.
// - Upstream: fetchPvgisTypicalYear (shared with scripts/build-solar-production.mjs): one tmy call
//   and one seriescalc per selected year (up to 12), two at a time, as PVGIS answers fastest that
//   way. Each call times out after 8 s and is retried once on a network error, a timeout, a 429 or
//   a 5xx; the whole request gives up after 45 s (the function may run 60 s, astro.config.mjs).
//   A first request for a query takes 10 to 20 s; the CDN answers the next ones.
// - Caching: a success is public for 30 days at the CDN (s-maxage) and served stale for a day while
//   it revalidates; errors are no-store.
// - Privacy and rate limiting: coordinates are never logged. There is no store here: the rounding
//   and the CDN bound the cost, and a rate-limit rule, if one is needed, belongs in the Vercel
//   Firewall (apps/landing/AGENTS.md).

import {
  encodeTypicalYear,
  fetchPvgisTypicalYear,
  PVGIS_VERSION,
  PvgisResponseError,
} from "./solarPvgis";
import {
  parseSolarQuery,
  SOLAR_PRODUCTION_PATH,
  solarQueryString,
  type SolarProductionErrorCode,
  type SolarProductionResponse,
  type SolarQueryError,
} from "./solarProductionQuery";

export const SUCCESS_CACHE_CONTROL = "public, s-maxage=2592000, stale-while-revalidate=86400";
export const ERROR_CACHE_CONTROL = "no-store";

const USER_AGENT = "WonderMoney-landing/1.0 (+https://github.com/wondermoney/wondermoney)";
const SOURCE_URL = "https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en";
/** Plausible kWh per kWp a year for any tilt and orientation in Portugal (north-facing walls included). */
const YEARLY_RANGE = { min: 50, max: 2600 };

export interface SolarProductionOptions {
  fetch?: typeof fetch;
  /** Per PVGIS call and attempt. */
  timeoutMs?: number;
  /** For the whole request. */
  deadlineMs?: number;
}

class UpstreamError extends Error {
  constructor(readonly code: "location_unavailable" | "upstream_error" | "upstream_timeout") {
    super(code);
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": ERROR_CACHE_CONTROL, ...headers },
  });
}

const failure = (status: number, error: SolarProductionErrorCode | SolarQueryError) =>
  json(status, typeof error === "string" ? { error } : error);

/** A `get` for fetchPvgisTypicalYear: a timeout per attempt, one retry, and a deadline for the lot. */
function pvgisGet(fetcher: typeof fetch, timeoutMs: number, deadline: number) {
  return async (url: string): Promise<unknown> => {
    for (let attempt = 1; ; attempt++) {
      const left = deadline - Date.now();
      if (left <= 0) throw new UpstreamError("upstream_timeout");
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
          signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
        if (attempt === 2) throw new UpstreamError(timedOut ? "upstream_timeout" : "upstream_error");
        continue;
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new UpstreamError("upstream_error");
        }
      }
      // PVGIS answers 400 for a point it has no data for ("Location over the sea").
      if (response.status === 400) throw new UpstreamError("location_unavailable");
      if (attempt === 2 || (response.status !== 429 && response.status < 500)) throw new UpstreamError("upstream_error");
    }
  };
}

/** The route's GET handler. `options` are for tests: a fetch double and shorter timeouts. */
export function createSolarProductionHandler({ fetch: fetcher = fetch, timeoutMs = 8000, deadlineMs = 45_000 }: SolarProductionOptions = {}) {
  return async (request: Request): Promise<Response> => {
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return json(405, { error: "method_not_allowed" }, { Allow: "GET, HEAD" });
    const url = new URL(request.url);
    const parsed = parseSolarQuery(url.searchParams);
    if (!parsed.ok) return failure(400, parsed.error);
    const canonical = solarQueryString(parsed.query);
    if (url.search !== `?${canonical}`) {
      return new Response(null, {
        status: 308,
        headers: { Location: `${SOLAR_PRODUCTION_PATH}?${canonical}`, "Cache-Control": SUCCESS_CACHE_CONTROL },
      });
    }
    const { lat, lon, angle, aspect, loss } = parsed.query;
    try {
      const typical = await fetchPvgisTypicalYear(
        { lat, lon, angle, aspect, lossPercent: loss },
        pvgisGet(fetcher, timeoutMs, Date.now() + deadlineMs),
        { decimals: 2, concurrency: 2 },
      );
      const yearlyKwh = typical.year.reduce((sum, value) => sum + value, 0) / 1000;
      if (yearlyKwh < YEARLY_RANGE.min || yearlyKwh > YEARLY_RANGE.max) throw new PvgisResponseError("Implausible yearly production");
      const body: SolarProductionResponse = {
        days: encodeTypicalYear(typical.year),
        yearlyKwhPerKwp: Math.round(yearlyKwh),
        monthsSelected: typical.months.map((month) => month.year),
        source: {
          name: `PVGIS ${PVGIS_VERSION}, European Commission, Joint Research Centre`,
          url: SOURCE_URL,
          version: PVGIS_VERSION,
          radiationDb: typical.meteo.radiationDb,
          meteoDb: typical.meteo.meteoDb,
          yearMin: typical.meteo.yearMin,
          yearMax: typical.meteo.yearMax,
        },
        params: { ...parsed.query, peakpower: 1 },
      };
      return json(200, body, { "Cache-Control": SUCCESS_CACHE_CONTROL });
    } catch (error) {
      const code = error instanceof UpstreamError ? error.code : "upstream_error";
      // The code only: the query holds the visitor's coordinates.
      console.warn(`solar-production: ${code}${error instanceof PvgisResponseError ? " (unexpected PVGIS response)" : ""}`);
      return failure(code === "upstream_timeout" ? 504 : code === "location_unavailable" ? 422 : 502, code);
    }
  };
}

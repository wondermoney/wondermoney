#!/usr/bin/env node
// Refresh script for src/lib/calculators/data/fuelStations/ (index.ts and one JSON file per
// district): the cheapest stations by district, municipality and fuel on the fuel prices page.
//
// Source: DGEG (Direcao-Geral de Energia e Geologia), the station prices behind
// https://precoscombustiveis.dgeg.gov.pt/ ("Pesquisa de postos"). Its public API answers the
// search the site itself runs:
//
//   GET https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos
//       ?idsTiposComb=2101,3201,1120&qtdPorPagina=20000&pagina=1
//
// One request returns every station in mainland Portugal with a price for one of the three fuels
// (about 6,400 rows, 2.4 MB). DGEG's terms (site footer): the information is free and may be used
// freely, provided DGEG is named as the source, the date of the last update of the prices is shown
// and the information is reproduced faithfully. So every price keeps DGEG's own update time and
// is copied untouched; the page names DGEG.
//
// Per fuel, the snapshot keeps the 5 cheapest stations of mainland Portugal and of each district
// and the 3 cheapest of each municipality, with how many stations the area has and their median
// price; and, for the near-me search, every station with coordinates and its prices (about 3,200
// stations, 500 KB of JSON split by district so the page loads only the districts it needs).
//
// Refused (the old files stay): a failed or truncated response, fewer stations or municipalities
// than a sane floor, an unknown district, a feed whose newest price is days old, or more than 2%
// of prices that are out of range or far from the fuel's median. A single implausible price (a
// typing error at a station) is left out of the ranking rather than shown as the cheapest.
//
// Usage, from apps/landing (needs network; Node 18+ for fetch):
//
//   node scripts/build-fuel-stations.mjs [--from-file <response.json>] [--date YYYY-MM-DDTHH:MMZ]
//
// --from-file reads a saved API response instead of calling DGEG; --date sets the fetch time.
// scripts/build-daily-snapshots.mjs runs the same refresh at build time and keeps the committed
// files when it fails.
//
// Committed snapshots carry no station names and no street addresses. Many stations are sole
// traders named after their owner, and many streets are named after people, so a public
// repository should not hold them. Every write is "redacted" (name and street null; brand,
// locality, postcode, municipality and coordinates kept) unless the caller passes
// `redact: false`, which only the build step does, inside a Vercel build whose files are never
// committed. The page then shows the brand and locality in place of the name.
//
// A locality can hold a surname too (villages are often named after a family). When
// LEAK_PATTERNS is set (the repository's private leak patterns, newline-separated, as
// .github/scripts/leak-check.sh reads them; the data refresh workflow passes the secret), a
// locality one of them matches is left empty, and the page shows the brand and municipality.
// Neither the patterns nor a dropped locality is ever printed.

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SOURCE = {
  name: "DGEG, preços dos combustíveis por posto (Portugal continental)",
  url: "https://precoscombustiveis.dgeg.gov.pt/",
};
export const API_URL = "https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos";
export const USER_AGENT = "WonderMoney-landing-build/1.0 (+https://github.com/wondermoney/wondermoney)";
/** DGEG fuel type id and the label its API returns. The same three fuels as the averages. */
export const FUELS = [
  { key: "diesel", id: 2101, label: "Gasóleo simples" },
  { key: "gasoline95", id: 3201, label: "Gasolina simples 95" },
  { key: "lpg", id: 1120, label: "GPL Auto" },
];
/** DGEG's 18 mainland districts, with the slug of each district's data file. */
export const DISTRICTS = [
  ["aveiro", "Aveiro"],
  ["beja", "Beja"],
  ["braga", "Braga"],
  ["braganca", "Bragança"],
  ["castelo-branco", "Castelo Branco"],
  ["coimbra", "Coimbra"],
  ["evora", "Évora"],
  ["faro", "Faro"],
  ["guarda", "Guarda"],
  ["leiria", "Leiria"],
  ["lisboa", "Lisboa"],
  ["portalegre", "Portalegre"],
  ["porto", "Porto"],
  ["santarem", "Santarém"],
  ["setubal", "Setúbal"],
  ["viana-do-castelo", "Viana do Castelo"],
  ["vila-real", "Vila Real"],
  ["viseu", "Viseu"],
].map(([slug, name]) => ({ slug, name }));
export const TOP = { national: 5, district: 5, municipality: 3 };
export const PAGE_SIZE = 20_000;
/** Floors well under today's counts (2,923 diesel, 3,083 petrol, 432 LPG, 278 municipalities). */
export const MIN_ROWS = { diesel: 2_000, gasoline95: 2_000, lpg: 250 };
export const MIN_MUNICIPALITIES = 250;
export const PRICE_RANGE = { min: 0.5, max: 4 };
/** A price this far from the fuel's national median is treated as a typing error. */
export const MEDIAN_BAND = { below: 0.75, above: 1.5 };
export const MAX_DROPPED_SHARE = 0.02;
/** The newest station update must be at most this old at fetch time, or the feed is stale. */
export const MAX_FEED_AGE_DAYS = 3;
/** Prices not updated for this long are left out. */
export const MAX_PRICE_AGE_DAYS = 30;
/** Mainland Portugal; coordinates outside it are dropped and the map link uses the address. */
const BOUNDS = { latMin: 36.8, latMax: 42.3, lonMin: -9.6, lonMax: -6.1 };

const DAY = 86_400_000;
const median = (sorted) => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round3 = (value) => Math.round(value * 1000) / 1000;

/** "1,949 €" to 1.949. */
export function parsePrice(text) {
  const value = Number(String(text).replace("€", "").trim().replace(",", "."));
  if (!Number.isFinite(value)) throw new Error(`Unreadable price ${JSON.stringify(text)}`);
  return value;
}

/** "2026-11-20 10:55" (DGEG, Lisbon time) to a sortable string, or null when unreadable. */
function parseUpdated(text) {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(text)) ? String(text) : null;
}

const clean = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/**
 * LEAK_PATTERNS' entries as regular expressions: one per line, blank lines and # comments
 * skipped, as leak-check.sh reads them. A pattern JavaScript cannot compile stops the refresh
 * (the old files stay), named by its position only.
 */
export function privatePatterns(text = process.env.LEAK_PATTERNS ?? "") {
  return String(text)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => !/^\s*(#|$)/.test(line))
    .map((line, index) => {
      // Perl's leading inline flags, "(?i)name", are JavaScript's flags argument.
      const inline = /^\(\?([ims]+)\)/.exec(line);
      try {
        return inline ? new RegExp(line.slice(inline[0].length), inline[1]) : new RegExp(line);
      } catch {
        throw new Error(`LEAK_PATTERNS entry ${index + 1} is not a valid regular expression`);
      }
    });
}

/**
 * [name, brand, street, locality, postcode, municipality]; name and street null when redacted,
 * the locality empty when a private pattern matches it.
 */
function describe(row, municipality, redact, patterns) {
  const name = clean(row.Nome);
  const street = clean(row.Morada);
  const locality = clean(row.Localidade);
  return [
    redact || !name ? null : name,
    clean(row.Marca),
    redact || !street ? null : street,
    patterns.some((pattern) => pattern.test(locality)) ? "" : locality,
    clean(row.CodPostal),
    municipality,
  ];
}

function coordinates(row) {
  const lat = Number(row.Latitude);
  const lon = Number(row.Longitude);
  const inside = lat >= BOUNDS.latMin && lat <= BOUNDS.latMax && lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax;
  return inside ? [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5] : [null, null];
}

/**
 * DGEG's rows to the snapshot: { fetchedAt, newestUpdate, counts, national, districts }.
 * `fetchedAt` is an ISO time ("2026-11-20T05:00Z"). Throws when the response must not be shown.
 */
export function deriveSnapshot(apiRows, { fetchedAt, redact = true, patterns = privatePatterns() }) {
  if (!Array.isArray(apiRows)) throw new Error("Not a list of stations");
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) throw new Error(`Bad fetch time ${fetchedAt}`);
  const districtByName = new Map(DISTRICTS.map((district) => [district.name, district]));

  // Parse and range-check every row of the three fuels.
  const parsed = [];
  let dropped = 0;
  let newestUpdate = "";
  for (const row of apiRows) {
    const fuel = FUELS.find((candidate) => candidate.label === row.Combustivel);
    if (!fuel) continue;
    const district = districtByName.get(clean(row.Distrito));
    if (!district) throw new Error(`Unknown district ${JSON.stringify(row.Distrito)}`);
    const municipality = clean(row.Municipio);
    const updated = parseUpdated(row.DataAtualizacao);
    const price = parsePrice(row.Preco);
    if (!municipality || !Number.isInteger(row.Id) || !updated) {
      throw new Error(`Incomplete station row ${JSON.stringify(row.Id)}`);
    }
    if (updated > newestUpdate) newestUpdate = updated;
    const ageDays = (fetchedMs - Date.parse(`${updated.replace(" ", "T")}:00Z`)) / DAY;
    if (ageDays > MAX_PRICE_AGE_DAYS) continue;
    if (!(price > PRICE_RANGE.min && price < PRICE_RANGE.max)) {
      dropped++;
      continue;
    }
    parsed.push({ row, fuel: fuel.key, district, municipality, updated, price });
  }
  if (!newestUpdate) throw new Error("No station prices");
  const feedAge = (fetchedMs - Date.parse(`${newestUpdate.slice(0, 10)}T00:00:00Z`)) / DAY;
  if (feedAge > MAX_FEED_AGE_DAYS + 1) throw new Error(`Newest station price is from ${newestUpdate}: stale feed`);

  // Drop the prices far from their fuel's median.
  const medians = {};
  for (const fuel of FUELS) {
    const prices = parsed.filter((item) => item.fuel === fuel.key).map((item) => item.price).sort((a, b) => a - b);
    if (prices.length < MIN_ROWS[fuel.key]) {
      throw new Error(`Only ${prices.length} ${fuel.label} prices (floor ${MIN_ROWS[fuel.key]})`);
    }
    medians[fuel.key] = median(prices);
  }
  const kept = parsed.filter((item) => {
    const ratio = item.price / medians[item.fuel];
    const inBand = ratio >= MEDIAN_BAND.below && ratio <= MEDIAN_BAND.above;
    if (!inBand) dropped++;
    return inBand;
  });
  const considered = kept.length + dropped;
  if (dropped / considered > MAX_DROPPED_SHARE) {
    throw new Error(`${dropped} of ${considered} prices are implausible: refusing the response`);
  }
  const municipalities = new Set(kept.map((item) => `${item.district.slug}|${item.municipality}`));
  if (municipalities.size < MIN_MUNICIPALITIES) {
    throw new Error(`Only ${municipalities.size} municipalities (floor ${MIN_MUNICIPALITIES})`);
  }
  for (const district of DISTRICTS) {
    if (!kept.some((item) => item.district === district)) throw new Error(`No prices in ${district.name}`);
  }

  // Cheapest first; a tie goes to the more recent update, then to the name.
  kept.sort(
    (a, b) =>
      a.price - b.price ||
      b.updated.localeCompare(a.updated) ||
      clean(a.row.Nome).localeCompare(clean(b.row.Nome)) ||
      a.row.Id - b.row.Id,
  );

  /** One area's lists, from items already sorted cheapest first. */
  const area = (items, top, stations) => {
    const out = {};
    for (const fuel of FUELS) {
      const ofFuel = items.filter((item) => item.fuel === fuel.key);
      if (ofFuel.length === 0) continue;
      const chosen = ofFuel.slice(0, top);
      for (const item of chosen) {
        const [lat, lon] = coordinates(item.row);
        stations[item.row.Id] = [...describe(item.row, item.municipality, redact, patterns), lat, lon];
      }
      out[fuel.key] = {
        count: ofFuel.length,
        median: round3(median(ofFuel.map((item) => item.price).sort((a, b) => a - b))),
        top: chosen.map((item) => [item.row.Id, item.price, item.updated]),
      };
    }
    return out;
  };

  /**
   * Every priced station of a district that has coordinates, per fuel, cheapest first: what the
   * near-me search measures distances against. Also the district's bounding box, so the page loads
   * only the districts that can reach the visitor's radius.
   */
  const everyStation = (items, stations) => {
    const out = {};
    let bounds = null;
    for (const fuel of FUELS) {
      const located = [];
      for (const item of items) {
        if (item.fuel !== fuel.key) continue;
        const [lat, lon] = coordinates(item.row);
        if (lat === null || lon === null) continue;
        stations[item.row.Id] ??= [...describe(item.row, item.municipality, redact, patterns), lat, lon];
        located.push([item.row.Id, item.price, item.updated]);
        bounds = bounds
          ? [Math.min(bounds[0], lat), Math.min(bounds[1], lon), Math.max(bounds[2], lat), Math.max(bounds[3], lon)]
          : [lat, lon, lat, lon];
      }
      if (located.length > 0) out[fuel.key] = located;
    }
    return { all: out, bounds };
  };

  const nationalStations = {};
  const national = { stations: nationalStations, areas: { "": area(kept, TOP.national, nationalStations) } };
  const districts = DISTRICTS.map((district) => {
    const inDistrict = kept.filter((item) => item.district === district);
    const stations = {};
    const names = [...new Set(inDistrict.map((item) => item.municipality))].sort((a, b) => a.localeCompare(b, "pt"));
    const areas = { "": area(inDistrict, TOP.district, stations) };
    for (const name of names) {
      areas[name] = area(inDistrict.filter((item) => item.municipality === name), TOP.municipality, stations);
    }
    const { all, bounds } = everyStation(inDistrict, stations);
    if (!bounds) throw new Error(`No located stations in ${district.name}`);
    return { slug: district.slug, name: district.name, municipalities: names, bounds, data: { stations, areas, all } };
  });
  const counts = Object.fromEntries(FUELS.map((fuel) => [fuel.key, kept.filter((item) => item.fuel === fuel.key).length]));

  return { fetchedAt, newestUpdate, counts, dropped, redacted: redact, national, districts };
}

export function renderIndex(snapshot) {
  const districts = snapshot.districts.map((district) => ({
    slug: district.slug,
    name: district.name,
    bounds: district.bounds,
    municipalities: district.municipalities,
  }));
  return `// Generated by scripts/build-fuel-stations.mjs. Do not edit by hand: rerun the script.
//
// DGEG's station prices of gasoleo simples, gasolina simples 95 and GPL auto in mainland
// Portugal: the cheapest lists per area, and in each district's ./<slug>.json every located
// station's prices for the near-me search. A district's file is loaded when the visitor picks the
// district or searches near a point it reaches; [south, west, north, east] is its bounding box.
// The page never calls DGEG.

export const FUEL_STATIONS_SOURCE = {
  name: ${JSON.stringify(SOURCE.name)},
  url: ${JSON.stringify(SOURCE.url)},
  /** When the prices were collected from DGEG (UTC): the snapshot date the page shows. */
  fetchedAt: ${JSON.stringify(snapshot.fetchedAt)},
  asOf: ${JSON.stringify(snapshot.fetchedAt.slice(0, 10))},
  /** The most recent price update among all stations (DGEG's time, Lisbon). */
  newestUpdate: ${JSON.stringify(snapshot.newestUpdate)},
  /** True when station names and streets were left out, as in every committed snapshot. */
  redacted: ${JSON.stringify(snapshot.redacted)},
  /** Station prices per fuel in the snapshot, after the implausible ones were left out. */
  counts: ${JSON.stringify(snapshot.counts)},
  top: ${JSON.stringify(TOP)},
  /** Bump when the shape or the derivation changes. */
  version: 3,
} as const;

export const FUEL_STATION_DISTRICTS = ${JSON.stringify(districts, null, 2)} as const;

/** The cheapest stations of mainland Portugal, per fuel. Same shape as a district file. */
export const FUEL_STATIONS_NATIONAL = ${JSON.stringify(snapshot.national)};
`;
}

/** One JSON file per district: a station per line, so a refresh's diff stays readable. */
export function renderDistrict(data) {
  const stations = Object.entries(data.stations)
    .map(([id, station]) => `    ${JSON.stringify(id)}: ${JSON.stringify(station)}`)
    .join(",\n");
  const areas = Object.entries(data.areas)
    .map(([name, lists]) => `    ${JSON.stringify(name)}: ${JSON.stringify(lists)}`)
    .join(",\n");
  const all = Object.entries(data.all)
    .map(([fuel, prices]) => `    ${JSON.stringify(fuel)}: ${JSON.stringify(prices)}`)
    .join(",\n");
  return `{\n  "stations": {\n${stations}\n  },\n  "areas": {\n${areas}\n  },\n  "all": {\n${all}\n  }\n}\n`;
}

/** Asks DGEG once for the three fuels. */
export async function fetchRows({ fetchImpl = fetch } = {}) {
  const ids = FUELS.map((fuel) => fuel.id).join(",");
  const query = `idsTiposComb=${ids}&idMarca=&idTipoPosto=&idDistrito=&descricaoPosto=&idsMunicipios=&qtdPorPagina=${PAGE_SIZE}&pagina=1&orderBy=preco`;
  const response = await fetchImpl(`${API_URL}?${query}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`DGEG answered ${response.status}`);
  const json = await response.json();
  if (!json.status || !Array.isArray(json.resultado)) throw new Error(`DGEG: ${json.mensagem ?? "no result"}`);
  if (json.resultado.length >= PAGE_SIZE) throw new Error("DGEG's answer filled the page: it may be truncated");
  return json.resultado;
}

export const DATA_DIR = fileURLToPath(new URL("../src/lib/calculators/data/fuelStations", import.meta.url));

/**
 * Writes the snapshot into a fresh directory beside the old one and swaps them, so a crash
 * leaves the old files or the new ones, never half of each.
 */
export function writeSnapshot(snapshot, dir = DATA_DIR) {
  const next = `${dir}.next`;
  const previous = `${dir}.previous`;
  rmSync(next, { recursive: true, force: true });
  rmSync(previous, { recursive: true, force: true });
  mkdirSync(next, { recursive: true });
  writeFileSync(join(next, "index.ts"), renderIndex(snapshot));
  for (const district of snapshot.districts) {
    writeFileSync(join(next, `${district.slug}.json`), renderDistrict(district.data));
  }
  mkdirSync(dirname(dir), { recursive: true });
  let hadPrevious = true;
  try {
    renameSync(dir, previous);
  } catch {
    hadPrevious = false;
  }
  try {
    renameSync(next, dir);
  } catch (error) {
    if (hadPrevious) renameSync(previous, dir);
    throw error;
  }
  rmSync(previous, { recursive: true, force: true });
}

/** Fetches, validates and writes. Throws before writing anything when the data must not be shown. */
export async function refresh({
  fetchImpl = fetch,
  fetchedAt = new Date().toISOString().slice(0, 16) + "Z",
  dir = DATA_DIR,
  redact = true,
} = {}) {
  const rows = await fetchRows({ fetchImpl });
  const snapshot = deriveSnapshot(rows, { fetchedAt, redact });
  writeSnapshot(snapshot, dir);
  return snapshot;
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const fetchedAt = option("--date") ?? new Date().toISOString().slice(0, 16) + "Z";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(fetchedAt)) throw new Error("--date must be YYYY-MM-DDTHH:MMZ");
  const file = option("--from-file");
  let snapshot;
  if (file) {
    const json = JSON.parse(readFileSync(file, "utf8"));
    snapshot = deriveSnapshot(Array.isArray(json) ? json : json.resultado, { fetchedAt });
    writeSnapshot(snapshot);
  } else {
    snapshot = await refresh({ fetchedAt });
  }
  const stations = snapshot.districts.reduce((sum, district) => sum + Object.keys(district.data.stations).length, 0);
  console.log(
    `Wrote ${stations} stations in ${snapshot.districts.length} districts (prices to ${snapshot.newestUpdate}, ${snapshot.dropped} left out) to ${DATA_DIR}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

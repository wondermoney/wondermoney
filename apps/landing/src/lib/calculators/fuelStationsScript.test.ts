import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DISTRICTS,
  MAX_DROPPED_SHARE,
  PAGE_SIZE,
  USER_AGENT,
  deriveSnapshot,
  fetchRows,
  parsePrice,
  privatePatterns,
  refresh,
  renderDistrict,
  writeSnapshot,
  type DgegStationRow,
} from "../../../scripts/build-fuel-stations.mjs";

const FETCHED_AT = "2026-11-20T05:00Z";
const LABELS = { diesel: "Gasóleo simples", gasoline95: "Gasolina simples 95", lpg: "GPL Auto" } as const;

/**
 * A DGEG-shaped answer: 18 districts x 15 municipalities x 8 stations, diesel and petrol at every
 * station and LPG at one in eight. `edit` can change or drop (return null) any row.
 */
function apiRows(edit: (row: DgegStationRow, index: number) => DgegStationRow | null = (row) => row) {
  const rows: DgegStationRow[] = [];
  let id = 1000;
  for (const district of DISTRICTS) {
    for (let m = 0; m < 15; m++) {
      for (let s = 0; s < 8; s++) {
        id++;
        const fuels: Array<[keyof typeof LABELS, number]> = [
          ["diesel", 1.9],
          ["gasoline95", 1.8],
        ];
        if (s === 0) fuels.push(["lpg", 0.9]);
        for (const [fuel, base] of fuels) {
          const price = (base + s * 0.01 + m * 0.001).toFixed(3).replace(".", ",");
          rows.push({
            Id: id,
            Nome: `  Posto ${id} `,
            Municipio: `${district.name} ${m}`,
            Preco: `${price} €`,
            Marca: "MARCA ",
            Combustivel: LABELS[fuel],
            DataAtualizacao: s === 7 ? "2026-11-19 08:00" : "2026-11-20 04:30",
            Distrito: district.name,
            Morada: "Rua  Direita 1",
            Localidade: "Vila",
            CodPostal: "1000-001",
            Latitude: 38.7,
            Longitude: -9.1,
          });
        }
      }
    }
  }
  rows.push({ ...rows[0], Combustivel: "Gasolina 98", Preco: "0,100 €" });
  return rows.flatMap((row, index) => edit(row, index) ?? []);
}

describe("build-fuel-stations", () => {
  it("reads DGEG's comma prices", () => {
    expect(parsePrice("1,949 €")).toBe(1.949);
    expect(() => parsePrice("n/d")).toThrow(/Unreadable/);
  });

  it("keeps the 5 cheapest per fuel nationally and per district and the 3 cheapest per municipality", () => {
    const snapshot = deriveSnapshot(apiRows(), { fetchedAt: FETCHED_AT });
    expect(snapshot.newestUpdate).toBe("2026-11-20 04:30");
    expect(snapshot.counts).toEqual({ diesel: 2160, gasoline95: 2160, lpg: 270 });
    const national = snapshot.national.areas[""].diesel!;
    expect(national.count).toBe(2160);
    expect(national.top).toHaveLength(5);
    expect(national.top.map(([, price]) => price)).toEqual([1.9, 1.9, 1.9, 1.9, 1.9]);
    const aveiro = snapshot.districts[0];
    expect(aveiro.slug).toBe("aveiro");
    expect(aveiro.municipalities).toHaveLength(15);
    expect(aveiro.data.areas[""].gasoline95!.top).toHaveLength(5);
    const municipality = aveiro.data.areas["Aveiro 3"];
    expect(municipality.diesel!.top.map(([, price]) => price)).toEqual([1.903, 1.913, 1.923]);
    expect(municipality.diesel!.count).toBe(8);
    expect(municipality.diesel!.median).toBe(1.938);
    expect(municipality.lpg!.top).toHaveLength(1);
    // Only listed stations are stored, without name or street by default.
    const [, , updated] = municipality.diesel!.top[0];
    expect(updated).toBe("2026-11-20 04:30");
    const station = aveiro.data.stations[String(municipality.diesel!.top[0][0])];
    expect(snapshot.redacted).toBe(true);
    expect(station).toEqual([null, "MARCA", null, "Vila", "1000-001", "Aveiro 3", 38.7, -9.1]);
  });

  it("keeps every located station of a district with its prices, cheapest first, and the district's bounds", () => {
    const snapshot = deriveSnapshot(
      apiRows((row) => (row.Municipio === "Aveiro 2" ? { ...row, Latitude: 40.1 + (row.Id % 8) * 0.01, Longitude: -8.5 } : row)),
      { fetchedAt: FETCHED_AT },
    );
    const aveiro = snapshot.districts[0];
    expect(Object.keys(aveiro.data.stations)).toHaveLength(15 * 8);
    const all = aveiro.data.all!;
    expect(all.diesel).toHaveLength(15 * 8);
    expect(all.lpg).toHaveLength(15);
    const prices = all.gasoline95!.map(([, price]) => price);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    for (const [id, , updated] of all.diesel!) {
      expect(aveiro.data.stations[String(id)]).toBeDefined();
      expect(updated).toMatch(/^2026-11-(19|20) /);
    }
    expect(aveiro.bounds).toEqual([38.7, -9.1, 40.17, -8.5]);
    // The national list stays a short list: the near-me search reads the district files.
    expect(snapshot.national.all).toBeUndefined();
  });

  it("leaves a station without coordinates out of the near-me lists but keeps it in the cheapest lists", () => {
    const snapshot = deriveSnapshot(
      apiRows((row) => (row.Municipio === "Beja 0" ? { ...row, Latitude: 0, Longitude: 0 } : row)),
      { fetchedAt: FETCHED_AT },
    );
    const beja = snapshot.districts[1];
    const unlocated = new Set(beja.data.areas["Beja 0"].diesel!.top.map(([id]) => id));
    expect(beja.data.all!.diesel!.some(([id]) => unlocated.has(id))).toBe(false);
    expect(beja.data.all!.diesel).toHaveLength(14 * 8);
  });

  it("reads LEAK_PATTERNS as leak-check.sh does: one pattern a line, no blanks or comments, Perl's inline flags", () => {
    const patterns = privatePatterns("# private names\r\nExemplolandia\r\n\n  \n(?i)fictopolis\n");
    expect(patterns.map(String)).toEqual(["/Exemplolandia/", "/fictopolis/i"]);
    expect(privatePatterns("")).toEqual([]);
    expect(() => privatePatterns("ok\n(unclosed")).toThrow(/^LEAK_PATTERNS entry 2 is not a valid regular expression$/);
  });

  it("empties a locality a private pattern matches, and keeps the station", () => {
    const rows = apiRows((row) => (row.Municipio === "Aveiro 1" ? { ...row, Localidade: "Vila de Exemplolandia" } : row));
    const snapshot = deriveSnapshot(rows, { fetchedAt: FETCHED_AT, patterns: privatePatterns("Exemplolandia") });
    const aveiro = snapshot.districts[0];
    const [id] = aveiro.data.areas["Aveiro 1"].diesel!.top[0];
    expect(aveiro.data.stations[String(id)]).toEqual([null, "MARCA", null, "", "1000-001", "Aveiro 1", 38.7, -9.1]);
    expect(JSON.stringify(snapshot)).not.toContain("Exemplolandia");
    // Other localities stay, and without patterns nothing changes.
    expect(Object.values(aveiro.data.stations).filter((station) => station[3] === "Vila").length).toBeGreaterThan(100);
    const plain = deriveSnapshot(rows, { fetchedAt: FETCHED_AT, patterns: [] });
    expect(plain.districts[0].data.stations[String(id)][3]).toBe("Vila de Exemplolandia");
  });

  it("takes the patterns from LEAK_PATTERNS by default", () => {
    const rows = apiRows((row) => (row.Municipio === "Aveiro 1" ? { ...row, Localidade: "Exemplolandia" } : row));
    const previous = process.env.LEAK_PATTERNS;
    process.env.LEAK_PATTERNS = "Exemplolandia";
    try {
      expect(JSON.stringify(deriveSnapshot(rows, { fetchedAt: FETCHED_AT }))).not.toContain("Exemplolandia");
    } finally {
      if (previous === undefined) delete process.env.LEAK_PATTERNS;
      else process.env.LEAK_PATTERNS = previous;
    }
  });

  it("keeps names and streets, trimmed, only when asked not to redact", () => {
    const snapshot = deriveSnapshot(apiRows(), { fetchedAt: FETCHED_AT, redact: false });
    expect(snapshot.redacted).toBe(false);
    const aveiro = snapshot.districts[0];
    const station = aveiro.data.stations[String(aveiro.data.areas["Aveiro 3"].diesel!.top[0][0])];
    expect(station).toEqual([expect.stringMatching(/^Posto \d+$/), "MARCA", "Rua Direita 1", "Vila", "1000-001", "Aveiro 3", 38.7, -9.1]);
  });

  it("puts the more recently updated station first on a tie", () => {
    const snapshot = deriveSnapshot(
      apiRows((row) => (row.Municipio === "Beja 0" && row.Combustivel === LABELS.diesel ? { ...row, Preco: "1,800 €" } : row)),
      { fetchedAt: FETCHED_AT },
    );
    const top = snapshot.districts[1].data.areas["Beja 0"].diesel!.top;
    expect(top[0][2]).toBe("2026-11-20 04:30");
    expect(top.at(-1)![1]).toBe(1.8);
  });

  it("leaves out a single implausible price instead of ranking it first", () => {
    const snapshot = deriveSnapshot(
      apiRows((row, index) => (index === 0 ? { ...row, Preco: "0,199 €" } : row)),
      { fetchedAt: FETCHED_AT },
    );
    expect(snapshot.dropped).toBe(1);
    expect(snapshot.national.areas[""].diesel!.top[0][1]).toBe(1.9);
  });

  it("drops coordinates outside mainland Portugal and old prices", () => {
    const snapshot = deriveSnapshot(
      apiRows((row) => {
        if (row.Municipio !== "Faro 0") return row;
        return row.DataAtualizacao.startsWith("2026-11-19") ? { ...row, DataAtualizacao: "2026-09-01 10:00" } : { ...row, Latitude: 0, Longitude: 0 };
      }),
      { fetchedAt: FETCHED_AT },
    );
    const faro = snapshot.districts.find((district) => district.slug === "faro")!;
    expect(faro.data.areas["Faro 0"].diesel!.count).toBe(7);
    const id = faro.data.areas["Faro 0"].diesel!.top[0][0];
    expect(faro.data.stations[String(id)].slice(6)).toEqual([null, null]);
  });

  it.each([
    ["an unknown district", (row: DgegStationRow, index: number) => (index === 3 ? { ...row, Distrito: "Madeira" } : row), /Unknown district/],
    ["too few stations", (row: DgegStationRow, index: number) => (index % 2 ? null : row), /Only \d+ .* prices/],
    ["a stale feed", (row: DgegStationRow) => ({ ...row, DataAtualizacao: "2026-11-10 10:00" }), /stale feed/],
    ["a missing district", (row: DgegStationRow) => (row.Distrito === "Viseu" ? null : row), /No prices in Viseu/],
    [
      "many implausible prices",
      (row: DgegStationRow, index: number) => (index % 20 === 0 ? { ...row, Preco: "9,999 €" } : row),
      /implausible: refusing/,
    ],
    ["an incomplete row", (row: DgegStationRow, index: number) => (index === 5 ? { ...row, DataAtualizacao: "" } : row), /Incomplete/],
  ])("refuses %s", (_, edit, message) => {
    expect(() => deriveSnapshot(apiRows(edit), { fetchedAt: FETCHED_AT })).toThrow(message);
  });

  it("tolerates implausible prices under the threshold and leaves them out", () => {
    expect(MAX_DROPPED_SHARE).toBe(0.02);
    const snapshot = deriveSnapshot(
      apiRows((row, index) => (index % 100 === 0 ? { ...row, Preco: "9,999 €" } : row)),
      { fetchedAt: FETCHED_AT },
    );
    expect(snapshot.dropped).toBeGreaterThan(40);
    expect(snapshot.national.areas[""].diesel!.median).toBeLessThan(2.1);
  });

  it("asks DGEG once, with its own User-Agent, and refuses a failed or truncated answer", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const ok = (body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
      calls.push([String(url), init]);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    await fetchRows({ fetchImpl: ok({ status: true, resultado: [] }) as typeof fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toContain("PesquisarPostos?idsTiposComb=2101,3201,1120&");
    expect(calls[0][0]).toContain(`qtdPorPagina=${PAGE_SIZE}`);
    expect((calls[0][1]?.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).not.toMatch(/@/);
    await expect(fetchRows({ fetchImpl: ok({ status: false, mensagem: "erro" }) as typeof fetch })).rejects.toThrow(/erro/);
    await expect(
      fetchRows({ fetchImpl: ok({ status: true, resultado: new Array(PAGE_SIZE).fill({}) }) as typeof fetch }),
    ).rejects.toThrow(/truncated/);
    await expect(
      fetchRows({ fetchImpl: (async () => new Response("", { status: 503 })) as typeof fetch }),
    ).rejects.toThrow(/503/);
  });
});

describe("writing the station snapshot", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("replaces the whole directory, and a failed refresh leaves the old files untouched", async () => {
    dir = mkdtempSync(join(tmpdir(), "fuel-stations-"));
    const target = join(dir, "fuelStations");
    mkdirSync(target);
    writeFileSync(join(target, "index.ts"), "old");
    writeFileSync(join(target, "stale.json"), "{}");

    const bad = (async () => new Response(JSON.stringify({ status: true, resultado: apiRows().slice(0, 100) }))) as typeof fetch;
    await expect(refresh({ fetchImpl: bad, fetchedAt: FETCHED_AT, dir: target })).rejects.toThrow();
    expect(readFileSync(join(target, "index.ts"), "utf8")).toBe("old");

    const good = (async () => new Response(JSON.stringify({ status: true, resultado: apiRows() }))) as typeof fetch;
    await refresh({ fetchImpl: good, fetchedAt: FETCHED_AT, dir: target });
    const files = readdirSync(target).sort();
    expect(files).toEqual(["index.ts", ...DISTRICTS.map((district) => `${district.slug}.json`)].sort());
    expect(readdirSync(dir)).toEqual(["fuelStations"]);
    const index = readFileSync(join(target, "index.ts"), "utf8");
    expect(index).toContain('fetchedAt: "2026-11-20T05:00Z"');
    expect(index).toContain("redacted: true");
    expect(index).not.toMatch(/Posto \d+|Rua Direita/);
    expect(index).toContain('asOf: "2026-11-20"');
    const lisboa = JSON.parse(readFileSync(join(target, "lisboa.json"), "utf8"));
    expect(lisboa.areas["Lisboa 0"].diesel.top).toHaveLength(3);
    expect(lisboa.all.diesel).toHaveLength(15 * 8);
    expect(index).toContain('"bounds": [');
  });

  it("writes one station per line", () => {
    const snapshot = deriveSnapshot(apiRows(), { fetchedAt: FETCHED_AT });
    const text = renderDistrict(snapshot.districts[0].data);
    expect(JSON.parse(text)).toEqual(snapshot.districts[0].data);
    expect(text.split("\n").length).toBeGreaterThan(Object.keys(snapshot.districts[0].data.stations).length);
    dir = mkdtempSync(join(tmpdir(), "fuel-stations-"));
    writeSnapshot(snapshot, join(dir, "out"));
    expect(readdirSync(join(dir, "out"))).toHaveLength(19);
  });
});

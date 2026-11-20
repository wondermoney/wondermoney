import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ELECTRICITY_OFFERS, ELECTRICITY_OFFERS_SOURCE } from "./data/electricityOffers";
import { ERSE_TARIFFS, CONTRACTED_POWERS_KVA } from "./data/erseTariffs";
import {
  CONDITIONS_COLUMNS,
  MULTI_OPTION_FILTERS,
  YES_NO_FILTERS,
  decodeOptions,
  decodeYesNo,
  deriveOffers,
  exportDate,
  exportUrl,
  normalizeLink,
  parseCsv,
  parseDate,
  parseNumber,
  readExport,
  readZip,
  renderModule,
} from "../../../scripts/build-electricity-offers.mjs";

const SCRIPT = fileURLToPath(new URL("../../../scripts/build-electricity-offers.mjs", import.meta.url));
const MODULE = fileURLToPath(new URL("./data/electricityOffers.ts", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../../../scripts/fixtures/erse-offers/", import.meta.url));

/**
 * The fixture: nine offers and their price rows cut, byte for byte, from ERSE's 17 November 2026
 * export (BOM, CRLF, decimal comma): the TUR, an indexed offer (ALFAENERGIA_04), a dual offer
 * with a new-customer discount and mandatory services (EDPC_72), refunds as fractions (END_68,
 * GALP_109) and in scientific notation (REPSOL_09), a loyalty offer (AUDAX_01), a business-only
 * offer (ACCIONA_01) and a gas offer (CUR), the last two to be dropped.
 */
const fixture = {
  conditions: readFileSync(join(FIXTURES, "CondComerciais.csv"), "utf8"),
  prices: readFileSync(join(FIXTURES, "Precos_ELEGN.csv"), "utf8"),
};
const DATE = "2026-11-17";
const derive = (csv = fixture, date = DATE) => deriveOffers(csv, { date, minOffers: 1 });
const byId = (offers: ReturnType<typeof derive>, id: string) => offers.find((offer) => offer.id === id);

/** Replaces cells of one offer's row in CondComerciais.csv. */
function withCells(id: string, values: Record<string, string>) {
  const lines = fixture.conditions.split("\r\n");
  const header = lines[0].replace(/^\uFEFF/, "").split(";");
  for (const column of Object.keys(values)) if (!header.includes(column)) throw new Error(`No column ${column}`);
  const conditions = lines
    .map((line) => {
      const cells = line.split(";");
      if (cells[1] !== id) return line;
      for (const [column, value] of Object.entries(values)) cells[header.indexOf(column)] = value;
      return cells.join(";");
    })
    .join("\r\n");
  return { ...fixture, conditions };
}
const withCell = (id: string, column: string, value: string) => withCells(id, { [column]: value });

/** Replaces one price cell of an offer's row at a power and option. */
function withPrice(id: string, power: string, contagem: string, column: string, value: string) {
  const lines = fixture.prices.split("\r\n");
  const header = lines[0].replace(/^\uFEFF/, "").split(";");
  const at = header.indexOf(column);
  const prices = lines
    .map((line) => {
      const cells = line.split(";");
      if (cells[4] !== id || cells[1] !== power || cells[5] !== contagem) return line;
      cells[at] = value;
      return cells.join(";");
    })
    .join("\r\n");
  return { ...fixture, prices };
}

/** A zip like ERSE's: backslash paths, deflated, with DOS dates. One entry may be stored. */
function zip(entries: Array<{ name: string; data: Buffer; stored?: boolean; date?: [number, number, number] }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data, stored, date = [2026, 11, 17] } of entries) {
    const body = stored ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const dosDate = ((date[0] - 1980) << 9) | (date[1] << 5) | date[2];
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const fixtureZip = (csv = fixture) =>
  zip([
    { name: "csv\\CondComerciais.csv", data: Buffer.from(csv.conditions, "utf8") },
    { name: "csv\\Precos_ELEGN.csv", data: Buffer.from(csv.prices, "utf8"), stored: true },
  ]);

describe("build-electricity-offers: reading the export", () => {
  it("reads ERSE's zip, with backslash paths, deflated or stored entries and its file dates", () => {
    const files = readZip(fixtureZip());
    expect([...files.keys()]).toEqual(["csv/CondComerciais.csv", "csv/Precos_ELEGN.csv"]);
    expect(files.get("csv/Precos_ELEGN.csv")?.data.toString("utf8")).toBe(fixture.prices);
    expect(files.get("csv/CondComerciais.csv")?.modifiedOn).toBe("2026-11-17");
    expect(() => readZip(Buffer.from("not a zip"))).toThrow(/Not a zip/);
  });

  it("dates the export from its file name, else from the zip", () => {
    const files = readZip(fixtureZip());
    expect(exportDate("20261117 160141 CSV.zip", files)).toBe("2026-11-17");
    expect(exportDate("offers.zip", files)).toBe("2026-11-17");
    expect(() => exportDate("offers.zip", new Map())).toThrow(/No date/);
  });

  it("strips the BOM, splits on ; with CRLF or LF, trims cells and keeps empty ones", () => {
    const { header, rows } = parseCsv("\uFEFFA;B;C\r\n1; x ;\r\n\r\n");
    expect(header).toEqual(["A", "B", "C"]);
    expect(rows).toEqual([{ A: "1", B: "x", C: "" }]);
    expect(parseCsv("A;B\n1;2\n").rows).toEqual([{ A: "1", B: "2" }]);
    expect(() => parseCsv("A;B\r\n1;2;3")).toThrow(/line 2 has 3 cells, expected 2/);
    expect(() => parseCsv("")).toThrow(/empty/);
  });

  it("reads decimal commas, scientific notation and empty cells, and nothing else", () => {
    expect(parseNumber("0,1711")).toBe(0.1711);
    expect(parseNumber("12")).toBe(12);
    expect(parseNumber("2E-05")).toBe(0.00002);
    expect(parseNumber("0,0833333333333333")).toBe(0.0833333333333333);
    expect(parseNumber("")).toBeUndefined();
    expect(parseNumber(" ")).toBeUndefined();
    for (const bad of ["1.234,5", "0.17", "n/d", "1,2,3", "€1"]) expect(() => parseNumber(bad)).toThrow(/Unreadable/);
  });

  it("reads ERSE's day/month/year dates; an empty end date is open-ended", () => {
    expect(parseDate("01/10/2026")).toBe("2026-10-01");
    expect(parseDate("")).toBeNull();
    for (const bad of ["2026-10-01", "31/02/2026", "1/10/2026"]) expect(() => parseDate(bad)).toThrow(/Unreadable/);
  });

  it("keeps http(s) links, puts https:// in front of a bare host and drops anything else", () => {
    expect(normalizeLink(" https://www.galp.com/pt/ ")).toBe("https://www.galp.com/pt/");
    expect(normalizeLink("www.endesa.pt")).toBe("https://www.endesa.pt");
    expect(normalizeLink("www.audaxenergy.pt/particulares")).toBe("https://www.audaxenergy.pt/particulares");
    for (const bad of ["", " ", "-", "NA", "javascript:alert(1)", "ver condições gerais"]) {
      expect(normalizeLink(bad)).toBeUndefined();
    }
  });

  it("takes the export from Settings.json's csvPath, on ERSE's host only", () => {
    const url = exportUrl({ csvPath: "https://simuladorprecos.erse.pt/Admin/csvs/20261117 160141 CSV.zip" });
    expect(url.href).toBe("https://simuladorprecos.erse.pt/Admin/csvs/20261117%20160141%20CSV.zip");
    expect(() => exportUrl({})).toThrow(/no csvPath/);
    for (const csvPath of ["http://simuladorprecos.erse.pt/a.zip", "https://example.com/a.zip", "https://simuladorprecos.erse.pt/a.json"]) {
      expect(() => exportUrl({ csvPath })).toThrow(/Unexpected csvPath/);
    }
  });
});

describe("build-electricity-offers: filter codes", () => {
  // Every code in the 17 November 2026 export. The decoding agreed with the matching TxT* text
  // column (TxTContratação, TxTFatura, TxTPagamento, TxTAtendimento) on all 863 rows.
  const multi: Array<[keyof typeof MULTI_OPTION_FILTERS, string, string[]]> = [
    ["FiltroContratacao", "111", ["Eletrónica", "Presencial", "Telefónica"]],
    ["FiltroContratacao", "101", ["Eletrónica", "Telefónica"]],
    ["FiltroContratacao", "011", ["Presencial", "Telefónica"]],
    ["FiltroContratacao", "110", ["Eletrónica", "Presencial"]],
    ["FiltroContratacao", "100", ["Eletrónica"]],
    ["FiltroContratacao", "010", ["Presencial"]],
    ["FiltroContratacao", "001", ["Telefónica"]],
    ["Filtrofaturacao", "11", ["Fatura eletrónica", "Fatura em papel"]],
    ["Filtrofaturacao", "10", ["Fatura eletrónica"]],
    ["Filtrofaturacao", "01", ["Fatura em papel"]],
    ["FiltroPagamento", "111", ["Débito Direto", "Multibanco", "Numerário/Payshop/CTT"]],
    ["FiltroPagamento", "110", ["Débito Direto", "Multibanco"]],
    ["FiltroPagamento", "100", ["Débito Direto"]],
    ["FiltroPagamento", "011", ["Multibanco", "Numerário/Payshop/CTT"]],
    ["FiltroPagamento", "010", ["Multibanco"]],
    ["FiltroAtendimento", "1111", ["Por escrito", "Presencial", "Telefónico", "Eletrónico"]],
    ["FiltroAtendimento", "1011", ["Por escrito", "Telefónico", "Eletrónico"]],
    ["FiltroAtendimento", "1001", ["Por escrito", "Eletrónico"]],
    ["FiltroAtendimento", "0011", ["Telefónico", "Eletrónico"]],
    ["FiltroAtendimento", "0111", ["Presencial", "Telefónico", "Eletrónico"]],
    ["FiltroAtendimento", "1101", ["Por escrito", "Presencial", "Eletrónico"]],
    ["FiltroAtendimento", "1110", ["Por escrito", "Presencial", "Telefónico"]],
  ];

  it.each(multi)("decodes %s %s", (column, code, options) => {
    expect(decodeOptions(column, code)).toEqual(options);
  });

  it("refuses a multi-option code it cannot read", () => {
    for (const [column, code] of [
      ["FiltroPagamento", "000"],
      ["FiltroPagamento", "1111"],
      ["FiltroPagamento", "11"],
      ["FiltroPagamento", "120"],
      ["Filtrofaturacao", "00"],
      ["FiltroAtendimento", ""],
      ["FiltroAtendimento", "S"],
    ]) {
      expect(() => decodeOptions(column, code)).toThrow(/Unknown .* code/);
    }
    expect(() => decodeOptions("FiltroOutro", "1")).toThrow(/Unknown filter/);
  });

  it("decodes the yes/no filters and refuses anything but S or N", () => {
    expect(YES_NO_FILTERS).toHaveLength(8);
    for (const column of YES_NO_FILTERS) {
      expect(decodeYesNo(column, "S")).toBe(true);
      expect(decodeYesNo(column, "N")).toBe(false);
      for (const bad of ["s", "", "1", "Sim"]) expect(() => decodeYesNo(column, bad)).toThrow(/Unknown .* code/);
    }
    expect(() => decodeYesNo("FiltroOutro", "S")).toThrow(/Unknown filter/);
  });

  it("requires direct debit only when it is the one payment, and the e-invoice only when paper is not offered", () => {
    const offer = (pagamento: string, faturacao: string) =>
      byId(derive(withCells("END_68", { FiltroPagamento: pagamento, Filtrofaturacao: faturacao })), "END_68");
    expect(offer("100", "10")?.requirements).toEqual({ directDebit: true, eInvoice: true });
    expect(offer("110", "11")?.requirements).toEqual({ directDebit: false, eInvoice: false });
    expect(offer("010", "01")?.requirements).toEqual({ directDebit: false, eInvoice: false });
  });

  it("fails the run on an unknown code in a kept offer, not in a dropped one", () => {
    expect(() => derive(withCell("END_68", "FiltroPagamento", "000"))).toThrow(/Unknown FiltroPagamento code "000"/);
    expect(() => derive(withCell("END_68", "FiltroRestrições", "X"))).toThrow(/Unknown FiltroRestrições code "X"/);
    expect(() => derive(withCell("ACCIONA_01", "FiltroPagamento", "000"))).not.toThrow();
  });
});

describe("build-electricity-offers: offers", () => {
  it("keeps electricity and dual household offers valid on the date, the TUR first", () => {
    const offers = derive();
    expect(offers.map((offer) => offer.id)).toEqual([
      "TUR",
      "ALFAENERGIA_04",
      "AUDAX_01",
      "EDPC_72",
      "END_68",
      "GALP_109",
      "REPSOL_09",
    ]);
  });

  it("marks the regulated tariff and reads its prices, empty cells and missing high-power options", () => {
    const tur = byId(derive(), "TUR")!;
    expect(tur).toMatchObject({
      supplier: "TUR",
      name: "Condições de preço regulado",
      regulated: true,
      dual: false,
      segment: "all",
      indexed: false,
      socialTariff: true,
      durationMonths: 12,
      validFrom: "2026-10-01",
      validTo: "2026-12-31",
      mandatoryServicesPerYear: 0,
      refunds: { fixedPerYear: 0, powerPercent: 0, energyPercent: 0, energyPerKwh: 0 },
      newClient: { fixedPerYear: 0, powerPercent: 0, energyPercent: 0, energyPerKwh: 0 },
      requirements: { directDebit: false, eInvoice: false },
      conditions: "",
    });
    expect(tur.links.standardSheet).toBeUndefined();
    expect(tur.prices[3.45]).toEqual({
      simple: { powerPerDay: 0.1917, energy: 0.1711 },
      biHourly: { powerPerDay: 0.1917, offValley: 0.2045, valley: 0.1143 },
      triHourly: { powerPerDay: 0.1917, peak: 0.2553, shoulder: 0.1747, valley: 0.1143 },
    });
    // Above 20,7 kVA ERSE gives the TUR a tri-hourly price only.
    expect(tur.prices[27.6]).toEqual({ triHourly: { powerPerDay: 1.3655, peak: 0.3101, shoulder: 0.168, valley: 0.1021 } });
    expect(Object.keys(tur.prices)).toHaveLength(13);
  });

  it("reads the flags, amounts, links and texts of a free-market offer", () => {
    const offers = derive();
    expect(byId(offers, "ALFAENERGIA_04")).toMatchObject({
      indexed: true,
      segment: "domestic",
      links: { supplier: "https://www.alfaenergia.pt" },
    });
    expect(byId(offers, "EDPC_72")).toMatchObject({
      dual: true,
      mandatoryServicesPerYear: 720,
      newClient: { fixedPerYear: 120, powerPercent: 0, energyPercent: 0, energyPerKwh: 0 },
      requirements: { directDebit: true, eInvoice: true },
      validTo: "2026-11-30",
    });
    expect(byId(offers, "END_68")).toMatchObject({
      segment: "all",
      validTo: null,
      refunds: { fixedPerYear: 3.021, powerPercent: 0.0833333333333333, energyPercent: 0.0833333333333333, energyPerKwh: 0.001 },
      newClient: { fixedPerYear: 24.6 },
    });
    expect(byId(offers, "GALP_109")).toMatchObject({ conditioned: true, refunds: { powerPercent: 0.14 } });
    expect(byId(offers, "REPSOL_09")?.refunds.energyPerKwh).toBe(0.00002);
    expect(byId(offers, "AUDAX_01")).toMatchObject({ loyalty: true, validFrom: "2026-11-16" });
    expect(byId(offers, "EDPC_72")?.notes).toMatch(/^O contrato tem uma duração/);
    expect(byId(offers, "EDPC_72")?.prices[6.9]?.biHourly).toBeDefined();
    expect(byId(offers, "EDPC_72")?.prices[6.9]?.triHourly).toBeUndefined();
  });

  it("keeps an offer from its first to its last day, inclusive", () => {
    expect(byId(derive(fixture, "2026-11-30"), "EDPC_72")).toBeDefined();
    expect(byId(derive(fixture, "2026-12-01"), "EDPC_72")).toBeUndefined();
    expect(byId(derive(fixture, "2026-11-16"), "AUDAX_01")).toBeDefined();
    expect(byId(derive(fixture, "2026-11-15"), "AUDAX_01")).toBeUndefined();
    expect(byId(derive(fixture, "2026-12-31"), "END_68")?.validTo).toBeNull();
  });

  it("reads the fixture through the zip, dated by the export's file name", () => {
    const { offers, source } = readExport(fixtureZip(), { exportFile: "20261117 160141 CSV.zip", date: DATE, minOffers: 1 });
    expect(offers).toEqual(derive());
    expect(source).toEqual({ exportFile: "20261117 160141 CSV.zip", exportedOn: "2026-11-17", fetchedOn: DATE });
    expect(() => readExport(fixtureZip(), { exportFile: "20261117 160141 CSV.zip", date: "2026-11-16", minOffers: 1 })).toThrow(
      /dated after the snapshot date/,
    );
  });
});

describe("build-electricity-offers: refusing a bad export", () => {
  it("refuses missing columns", () => {
    const conditions = fixture.conditions.replace("FiltroPagamento;", "FiltroPagament;");
    expect(() => derive({ ...fixture, conditions })).toThrow(/Missing columns in CondComerciais.csv: FiltroPagamento/);
    const prices = fixture.prices.replace("TVVz", "TVVZ");
    expect(() => derive({ ...fixture, prices })).toThrow(/Missing columns in Precos_ELEGN.csv: TVVz/);
    expect(CONDITIONS_COLUMNS).toContain("CustoServicos_c/IVA (€/ano)");
  });

  it("refuses prices at or below zero, above 2 EUR/kWh, or unreadable", () => {
    expect(() => derive(withPrice("END_68", "3,45", "1", "TV|TVFV|TVP", "0"))).toThrow(/Implausible TV\|TVFV\|TVP of END_68 at 3,45 kVA/);
    expect(() => derive(withPrice("END_68", "3,45", "1", "TV|TVFV|TVP", "2,01"))).toThrow(/Implausible/);
    expect(() => derive(withPrice("END_68", "3,45", "1", "TV|TVFV|TVP", "-0,1"))).toThrow(/Implausible/);
    expect(() => derive(withPrice("END_68", "3,45", "1", "TF", "0"))).toThrow(/Implausible TF/);
    expect(() => derive(withPrice("END_68", "3,45", "1", "TF", "12"))).toThrow(/Implausible TF/);
    expect(() => derive(withPrice("END_68", "3,45", "1", "TF", "0.2"))).toThrow(/Unreadable TF/);
    expect(() => derive(withPrice("END_68", "3,45", "1", "TF", ""))).toThrow(/Missing TF of END_68/);
    expect(() => derive(withPrice("TUR", "3,45", "3", "TVVz", ""))).toThrow(/Missing TVVz of TUR/);
    expect(() => derive(withPrice("TUR", "3,45", "1", "TVV|TVC", "0,1"))).toThrow(/Unexpected TVV\|TVC/);
    expect(() => derive(withPrice("TUR", "3,45", "1", "Contagem", "4"))).toThrow(/Unknown Contagem/);
    expect(() => derive(withPrice("TUR", "3,45", "1", "Pot_Cont", "3,3"))).toThrow(/Unknown contracted power 3,3 for TUR/);
  });

  it("refuses implausible amounts and dates", () => {
    expect(() => derive(withCell("END_68", "ReembTF_ELE (%)", "1,5"))).toThrow(/Implausible ReembTF_ELE/);
    expect(() => derive(withCell("END_68", "ReembFixo (€/ano)", "-5"))).toThrow(/Implausible ReembFixo/);
    expect(() => derive(withCell("END_68", "Data ini", ""))).toThrow(/no start date/);
    expect(() => derive(withCell("END_68", "Data ini", "2026-11-06"))).toThrow(/Unreadable Data ini of END_68/);
    expect(() => derive(withCell("END_68", "DuracaoContrato", "0"))).toThrow(/Implausible DuracaoContrato/);
    expect(() => derive(withCell("END_68", "Segmento", "Res"))).toThrow(/Unknown Segmento/);
    expect(() => derive(withCell("END_68", "Fornecimento", "LUZ"))).toThrow(/Unknown Fornecimento/);
  });

  it("refuses a kept offer without prices, a second TUR or none, duplicates and too few offers", () => {
    const prices = fixture.prices
      .split("\r\n")
      .filter((line) => !line.startsWith("END;"))
      .join("\r\n");
    expect(() => derive({ ...fixture, prices })).toThrow(/Offer END_68 has no electricity prices/);
    expect(() => derive(withCell("TUR", "Segmento", "Ndom"))).toThrow(/Expected one regulated tariff \(TUR\), found 0/);
    const twice = fixture.conditions.replace(/\r\n$/, "") + "\r\n" + fixture.conditions.split("\r\n").find((line) => line.startsWith("END;"));
    expect(() => derive({ ...fixture, conditions: twice })).toThrow(/END_68 appears twice/);
    const header = fixture.conditions.split("\r\n")[0];
    expect(() => derive({ ...fixture, conditions: header })).toThrow(/Only 0 electricity offers/);
    expect(() => deriveOffers(fixture, { date: DATE })).toThrow(/Only 7 electricity offers valid on 2026-11-17: refusing to write/);
    expect(() => deriveOffers(fixture, { date: "17/11/2026" })).toThrow(/YYYY-MM-DD/);
  });

  it("exits with an error and leaves the module as it was", () => {
    const dir = mkdtempSync(join(tmpdir(), "erse-offers-"));
    try {
      const before = readFileSync(MODULE, "utf8");
      const mtime = statSync(MODULE).mtimeMs;
      // The fixture alone is far fewer offers than a real export, so the script refuses it.
      const file = join(dir, "20261117 160141 CSV.zip");
      writeFileSync(file, fixtureZip());
      expect(() =>
        execFileSync(process.execPath, [SCRIPT, "--from-file", file, "--date", DATE], { stdio: "pipe" }),
      ).toThrow(/refusing to write/);
      writeFileSync(file, "not a zip");
      expect(() => execFileSync(process.execPath, [SCRIPT, "--from-file", file, "--date", DATE], { stdio: "pipe" })).toThrow(
        /Not a zip/,
      );
      expect(readFileSync(MODULE, "utf8")).toBe(before);
      expect(statSync(MODULE).mtimeMs).toBe(mtime);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the committed electricity offers", () => {
  it("renders byte for byte from its own data", () => {
    expect(renderModule(ELECTRICITY_OFFERS, ELECTRICITY_OFFERS_SOURCE)).toBe(readFileSync(MODULE, "utf8"));
  });

  it("holds the TUR at the prices in erseTariffs.ts", () => {
    const tur = ELECTRICITY_OFFERS.filter((offer) => offer.regulated);
    expect(tur).toHaveLength(1);
    expect(tur[0].id).toBe("TUR");
    for (const power of CONTRACTED_POWERS_KVA) {
      const prices = tur[0].prices[power];
      expect(prices?.simple).toEqual({ powerPerDay: ERSE_TARIFFS.powerPerDay[power], energy: ERSE_TARIFFS.energyPerKwh.simple });
      expect(prices?.biHourly).toEqual({
        powerPerDay: ERSE_TARIFFS.powerPerDay[power],
        offValley: ERSE_TARIFFS.energyPerKwh.biPeak,
        valley: ERSE_TARIFFS.energyPerKwh.biOffPeak,
      });
    }
  });

  it("holds plausible offers, all valid on the snapshot date", () => {
    const { fetchedOn, exportedOn, offerCount, supplierCount } = ELECTRICITY_OFFERS_SOURCE;
    expect(exportedOn <= fetchedOn).toBe(true);
    expect(ELECTRICITY_OFFERS).toHaveLength(offerCount);
    expect(new Set(ELECTRICITY_OFFERS.map((offer) => offer.supplier)).size).toBe(supplierCount);
    expect(new Set(ELECTRICITY_OFFERS.map((offer) => offer.id)).size).toBe(offerCount);
    for (const offer of ELECTRICITY_OFFERS) {
      expect(offer.validFrom <= fetchedOn).toBe(true);
      if (offer.validTo !== null) expect(offer.validTo >= fetchedOn).toBe(true);
      expect(Object.keys(offer.prices).length).toBeGreaterThan(0);
      for (const link of Object.values(offer.links)) expect(link).toMatch(/^https?:\/\//);
    }
  });

  it("is loaded only with a dynamic import, so it stays out of other pages' bundles", () => {
    const src = fileURLToPath(new URL("../../", import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
      );
    const staticImports = files(src)
      .filter((file) => /\.(ts|tsx|astro|js|mjs)$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => /(from|import)\s+["'][^"']*data\/electricityOffers["']/.test(readFileSync(file, "utf8")));
    expect(staticImports).toEqual([]);
  });
});

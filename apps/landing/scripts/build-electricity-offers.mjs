#!/usr/bin/env node
// Refresh script for src/lib/calculators/data/electricityOffers.ts.
//
// Source: ERSE's price simulator ("Simulador de preços de energia"), which lists every supplier's
// commercial offers in BTN (suppliers are legally required to report them) and publishes them as
// a CSV export. `csvPath` in https://simuladorprecos.erse.pt/config/Settings.json names the current
// export, a zip holding (with backslash path separators) two files, both UTF-8 with a BOM, `;` as
// the separator, a decimal comma, unquoted cells and CRLF line ends:
//
//   csv\CondComerciais.csv  one row per offer: supplier (COM), id (COD_Proposta), terms, filters
//   csv\Precos_ELEGN.csv    prices by offer, contracted power (Pot_Cont) and time-of-use option
//                           (Contagem 1 simple, 2 bi-hourly, 3 tri-hourly), EUR before VAT and
//                           taxes: TF power term (EUR/day), then the energy terms (EUR/kWh) in
//                           columns "TV|TVFV|TVP", "TVV|TVC" and "TVVz". Gas rows (TFGN, TVGN)
//                           are ignored.
//
// Kept: electricity offers (Fornecimento ELE, and DUAL, which require a gas contract too), the
// household segments (Segmento Dom, domestic, and Tod, all customers; Ndom, business only, is
// dropped), valid on the snapshot date (Data ini <= date <= Data fim, an empty Data fim is
// open-ended). The regulated tariff (TUR, the "tarifa transitória" sold by SU Eletricidade) is
// one of the rows, kept and marked `regulated`. The method follows ERSE's "Manual do Simulador de
// Preços de Energia" (June 2026): https://www.erse.pt/media/5cen41xv/manual-simulador_jun26.pdf
//
// Filter codes. CondComerciais.csv describes each offer with Filtro* codes, which ERSE's simulator
// filters on. They were decoded from the simulator itself: the option labels of its filters
// (Translations_PT.json, read by erse.max.js: OUT_FILT_CONTRAT_*, OUT_FILT_FATURA_*,
// OUT_FILT_PAGAMENTO_*, and the yes/no filters OUT_FILT_*), and, for the order of the digits, the
// matching TxT* text column of every row of the 17 November 2026 export, which agreed for every
// code:
//
//   Multi-option codes: one digit per option, 1 = the offer allows it, 0 = it does not.
//     FiltroContratacao  3 digits  Eletrónica, Presencial, Telefónica              (TxTContratação)
//     Filtrofaturacao    2 digits  Fatura eletrónica, Fatura em papel             (TxTFatura)
//     FiltroPagamento    3 digits  Débito Direto, Multibanco, Numerário/Payshop/CTT (TxTPagamento)
//     FiltroAtendimento  4 digits  Por escrito, Presencial, Telefónico, Eletrónico (TxTAtendimento)
//   So FiltroPagamento 100 is an offer that requires direct debit (ERSE's "A oferta requer
//   pagamento por débito direto") and Filtrofaturacao 10 one that requires the electronic invoice.
//
//   Yes/no codes, S (sim) or N (não):
//     FiltroFidelização      the offer has a loyalty period ("Ofertas com fidelização")
//     FiltroRenovavel_ELE    100% renewable electricity ("Só energia 100% renovável")
//     FiltroRestrições       conditioned offer, not open to the general public ("Ofertas condicionadas")
//     FiltroPrecosIndex_ELE  energy prices indexed to the day-ahead market ("Oferta indexada")
//     FiltroServicosAdic     mandatory additional services ("Só com serviços adicionais")
//     FiltroTarifaSocial     the social tariff can be applied ("Tarifa social")
//     FiltroReembolsos       other refunds or discounts ("Outros descontos/reembolsos")
//     FiltroNovosClientes    a discount for new customers ("Ofertas para novos clientes")
//
// Any other code in a household electricity offer (gas-only and business-only rows are not read)
// stops the script: it never guesses.
//
// Refunds and new-customer discounts are copied as ERSE gives them: the % columns are fractions
// (0.02 is 2%), the EUR/kWh columns are EUR per kWh and the fixed amounts EUR a year. ERSE labels
// the new-customer fixed discount and the mandatory services "c/IVA" (VAT included); it does not say
// for the fixed refund. An empty cell is 0.
//
// Usage, from apps/landing (needs network; Node 18+ for fetch):
//
//   node scripts/build-electricity-offers.mjs [--from-file <export.zip>] [--date YYYY-MM-DD]
//
// --from-file reads a saved export zip instead of downloading the current one; --date sets the
// snapshot date, which is both the "fetched on" stamp and the day offers must be valid on
// (defaults to today, UTC). The export date comes from the zip's file name ("YYYYMMDD hhmmss
// CSV.zip"), or from the zip's own file dates when the name does not carry it. A malformed or
// implausible export is refused before anything is written, so a failed refresh keeps the old file.
// The generated module is committed: the page never calls ERSE.

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

export const SOURCE = {
  name: "ERSE, Simulador de preços de energia (exportação das ofertas comerciais)",
  url: "https://simuladorprecos.erse.pt/",
};
export const SETTINGS_URL = "https://simuladorprecos.erse.pt/config/Settings.json";

export const CONDITIONS_FILE = "csv/CondComerciais.csv";
export const PRICES_FILE = "csv/Precos_ELEGN.csv";

/** Contracted powers ERSE's simulator offers, kVA, as the export writes them. */
export const POWERS_KVA = [1.15, 2.3, 3.45, 4.6, 5.75, 6.9, 10.35, 13.8, 17.25, 20.7, 27.6, 34.5, 41.4];

/** Plausible price ranges, EUR before VAT: anything outside fails the run. */
export const PRICE_LIMITS = { energyPerKwh: 2, powerPerDay: 10 };

/** Fewer offers than this is a truncated export, not a market. */
export const MIN_OFFERS = 100;

export const MULTI_OPTION_FILTERS = {
  FiltroContratacao: ["Eletrónica", "Presencial", "Telefónica"],
  Filtrofaturacao: ["Fatura eletrónica", "Fatura em papel"],
  FiltroPagamento: ["Débito Direto", "Multibanco", "Numerário/Payshop/CTT"],
  FiltroAtendimento: ["Por escrito", "Presencial", "Telefónico", "Eletrónico"],
};
export const YES_NO_FILTERS = [
  "FiltroFidelização",
  "FiltroRenovavel_ELE",
  "FiltroRestrições",
  "FiltroPrecosIndex_ELE",
  "FiltroServicosAdic",
  "FiltroTarifaSocial",
  "FiltroReembolsos",
  "FiltroNovosClientes",
];

const AMOUNT_COLUMNS = {
  mandatoryServices: "CustoServicos_c/IVA (€/ano)",
  refunds: {
    fixedPerYear: "ReembFixo (€/ano)",
    powerPercent: "ReembTF_ELE (%)",
    energyPercent: "ReembTW_ELE (%)",
    energyPerKwh: "ReembW_ELE (€/kWh)",
  },
  newClient: {
    fixedPerYear: "DescontNovoCliente_c/IVA (€/ano)",
    powerPercent: "Desc. TF_ELE (%) - Novo Cliente",
    energyPercent: "Desc. TW_ELE (%) - Novo Cliente",
    energyPerKwh: "Desc. W_ELE (€/kWh) - Novo Cliente",
  },
};
const LINK_COLUMNS = {
  offer: "LinkOfertaCom",
  standardSheet: "LinkFichaPadrao",
  terms: "LinkCondicoesGerais",
  supplier: "LinkCOM",
};

export const CONDITIONS_COLUMNS = [
  "COM",
  "COD_Proposta",
  "NomeProposta",
  "TxTModalidade",
  "Segmento",
  "Fornecimento",
  "DuracaoContrato",
  "Data ini",
  "Data fim",
  ...Object.keys(MULTI_OPTION_FILTERS),
  ...YES_NO_FILTERS,
  AMOUNT_COLUMNS.mandatoryServices,
  ...Object.values(AMOUNT_COLUMNS.refunds),
  ...Object.values(AMOUNT_COLUMNS.newClient),
  "TxTERSE",
  ...Object.values(LINK_COLUMNS),
];
const ELECTRICITY_PRICE_COLUMNS = ["TF", "TV|TVFV|TVP", "TVV|TVC", "TVVz"];
export const PRICES_COLUMNS = ["COM", "Pot_Cont", "COD_Proposta", "Contagem", ...ELECTRICITY_PRICE_COLUMNS];

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Zip

/**
 * The files of a zip archive, keyed by path with forward slashes (ERSE writes backslashes).
 * Handles stored and deflated entries, which is all ERSE's export uses; anything else throws.
 * Each entry also carries its modification day (the zip's DOS date) as YYYY-MM-DD.
 */
export function readZip(buffer) {
  const zip = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const EOCD = 0x06054b50;
  let end = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at--) {
    if (zip.readUInt32LE(at) === EOCD) {
      end = at;
      break;
    }
  }
  if (end === -1) throw new Error("Not a zip archive");
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("Corrupt zip central directory");
    const method = zip.readUInt16LE(at + 10);
    const dosDate = zip.readUInt16LE(at + 14);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8").replaceAll("\\", "/");
    at += 46 + nameLength + extraLength + commentLength;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`Corrupt zip entry ${name}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Unsupported zip compression ${method} for ${name}`);
    if (data.length !== size) throw new Error(`Zip entry ${name} is truncated`);
    const year = 1980 + (dosDate >> 9);
    const month = String((dosDate >> 5) & 0xf).padStart(2, "0");
    const day = String(dosDate & 0x1f).padStart(2, "0");
    files.set(name, { data, modifiedOn: `${year}-${month}-${day}` });
  }
  return files;
}

// ---------------------------------------------------------------------------------------------
// CSV cells

/**
 * ERSE's `;` CSV to { header, rows } with every cell trimmed. Strips the BOM; every row must have
 * the header's number of cells (ERSE does not quote, so a stray `;` would show up here).
 */
export function parseCsv(text, label = "CSV") {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.length > 0 && lines.at(-1).trim() === "") lines.pop();
  if (lines.length === 0) throw new Error(`${label} is empty`);
  const header = lines[0].split(";").map((cell) => cell.trim());
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split(";");
    if (cells.length !== header.length) {
      throw new Error(`${label} line ${index + 2} has ${cells.length} cells, expected ${header.length}`);
    }
    return Object.fromEntries(header.map((name, i) => [name, cells[i].trim()]));
  });
  return { header, rows };
}

function requireColumns(header, columns, label) {
  const missing = columns.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new Error(`Missing columns in ${label}: ${missing.join(", ")}`);
}

/** "0,1711" to 0.1711, "2E-05" to 0.00002, an empty cell to undefined; anything else throws. */
export function parseNumber(text, what = "number") {
  const cell = String(text ?? "").trim();
  if (cell === "") return undefined;
  if (!/^-?\d+(,\d+)?(E[-+]?\d+)?$/i.test(cell)) throw new Error(`Unreadable ${what}: ${JSON.stringify(cell)}`);
  return Number(cell.replace(",", "."));
}

/** "17/11/2026" to "2026-11-17", an empty cell to null; anything else throws. */
export function parseDate(text, what = "date") {
  const cell = String(text ?? "").trim();
  if (cell === "") return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cell);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : "";
  if (!match || Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) || isoDay(Date.parse(`${iso}T00:00:00Z`)) !== iso) {
    throw new Error(`Unreadable ${what}: ${JSON.stringify(cell)}`);
  }
  return iso;
}

/** The options a multi-option Filtro* code allows, in ERSE's order. Throws on a code it can't read. */
export function decodeOptions(column, code) {
  const options = MULTI_OPTION_FILTERS[column];
  if (!options) throw new Error(`Unknown filter ${column}`);
  if (!new RegExp(`^[01]{${options.length}}$`).test(code) || !code.includes("1")) {
    throw new Error(`Unknown ${column} code ${JSON.stringify(code)}`);
  }
  return options.filter((_, i) => code[i] === "1");
}

/** S to true, N to false. Throws on anything else. */
export function decodeYesNo(column, code) {
  if (!YES_NO_FILTERS.includes(column)) throw new Error(`Unknown filter ${column}`);
  if (code === "S") return true;
  if (code === "N") return false;
  throw new Error(`Unknown ${column} code ${JSON.stringify(code)}`);
}

/** An http(s) link as given, a bare host ("www.example.pt") with https:// in front, else nothing. */
export function normalizeLink(text) {
  const cell = String(text ?? "").trim();
  if (/^https?:\/\/[^\s]+$/i.test(cell)) return cell;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(cell)) return `https://${cell}`;
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Offers

function amount(row, column, { max } = {}) {
  const value = parseNumber(row[column], `${column} of ${row.COD_Proposta}`) ?? 0;
  if (value < 0 || (max !== undefined && value > max)) {
    throw new Error(`Implausible ${column} ${value} for ${row.COD_Proposta}`);
  }
  return value;
}

function amounts(row, columns) {
  return {
    fixedPerYear: amount(row, columns.fixedPerYear),
    powerPercent: amount(row, columns.powerPercent, { max: 1 }),
    energyPercent: amount(row, columns.energyPercent, { max: 1 }),
    energyPerKwh: amount(row, columns.energyPerKwh, { max: PRICE_LIMITS.energyPerKwh }),
  };
}

function offerFrom(row) {
  const id = row.COD_Proposta;
  for (const column of ["COM", "NomeProposta"]) {
    if (row[column] === "") throw new Error(`Offer ${id} has no ${column}`);
  }
  const validFrom = parseDate(row["Data ini"], `Data ini of ${id}`);
  if (validFrom === null) throw new Error(`Offer ${id} has no start date`);
  const validTo = parseDate(row["Data fim"], `Data fim of ${id}`);
  const duration = parseNumber(row.DuracaoContrato, `DuracaoContrato of ${id}`);
  if (duration !== undefined && !(Number.isInteger(duration) && duration > 0)) {
    throw new Error(`Implausible DuracaoContrato ${duration} for ${id}`);
  }
  const options = Object.fromEntries(
    Object.keys(MULTI_OPTION_FILTERS).map((column) => [column, decodeOptions(column, row[column])]),
  );
  const flags = Object.fromEntries(YES_NO_FILTERS.map((column) => [column, decodeYesNo(column, row[column])]));
  const only = (list, option) => list.length === 1 && list[0] === option;
  const links = {};
  for (const [key, column] of Object.entries(LINK_COLUMNS)) {
    const link = normalizeLink(row[column]);
    if (link) links[key] = link;
  }
  return {
    id,
    supplier: row.COM,
    name: row.NomeProposta,
    regulated: id === "TUR" && row.COM === "TUR",
    dual: row.Fornecimento === "DUAL",
    segment: row.Segmento === "Dom" ? "domestic" : "all",
    indexed: flags.FiltroPrecosIndex_ELE,
    renewable: flags.FiltroRenovavel_ELE,
    conditioned: flags["FiltroRestrições"],
    loyalty: flags["FiltroFidelização"],
    socialTariff: flags.FiltroTarifaSocial,
    durationMonths: duration ?? null,
    validFrom,
    validTo,
    mandatoryServicesPerYear: amount(row, AMOUNT_COLUMNS.mandatoryServices),
    refunds: amounts(row, AMOUNT_COLUMNS.refunds),
    newClient: amounts(row, AMOUNT_COLUMNS.newClient),
    requirements: {
      directDebit: only(options.FiltroPagamento, "Débito Direto"),
      eInvoice: only(options.Filtrofaturacao, "Fatura eletrónica"),
    },
    conditions: row.TxTModalidade,
    notes: row.TxTERSE,
    links,
    prices: {},
  };
}

function price(row, column, limit) {
  const what = `${column} of ${row.COD_Proposta} at ${row.Pot_Cont} kVA`;
  const value = parseNumber(row[column], what);
  if (value === undefined) throw new Error(`Missing ${what}`);
  if (!(value > 0 && value <= limit)) throw new Error(`Implausible ${what}: ${value}`);
  return value;
}

const OPTIONS = {
  1: (row, powerPerDay) => ({
    key: "simple",
    prices: { powerPerDay, energy: price(row, "TV|TVFV|TVP", PRICE_LIMITS.energyPerKwh) },
  }),
  2: (row, powerPerDay) => ({
    key: "biHourly",
    prices: {
      powerPerDay,
      offValley: price(row, "TV|TVFV|TVP", PRICE_LIMITS.energyPerKwh),
      valley: price(row, "TVV|TVC", PRICE_LIMITS.energyPerKwh),
    },
  }),
  3: (row, powerPerDay) => ({
    key: "triHourly",
    prices: {
      powerPerDay,
      peak: price(row, "TV|TVFV|TVP", PRICE_LIMITS.energyPerKwh),
      shoulder: price(row, "TVV|TVC", PRICE_LIMITS.energyPerKwh),
      valley: price(row, "TVVz", PRICE_LIMITS.energyPerKwh),
    },
  }),
};

const compareIds = (a, b) => a.localeCompare(b, "en", { numeric: true });

/**
 * The two CSV texts of the export to the electricity offers valid on `date`, regulated tariff
 * first, then by supplier and id. Throws on missing columns, an unreadable cell or filter code,
 * an implausible price, a kept offer without prices, no regulated tariff, or too few offers.
 */
export function deriveOffers({ conditions, prices }, { date, minOffers = MIN_OFFERS } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) throw new Error("The snapshot date must be YYYY-MM-DD");
  const offersCsv = parseCsv(conditions, "CondComerciais.csv");
  const pricesCsv = parseCsv(prices, "Precos_ELEGN.csv");
  requireColumns(offersCsv.header, CONDITIONS_COLUMNS, "CondComerciais.csv");
  requireColumns(pricesCsv.header, PRICES_COLUMNS, "Precos_ELEGN.csv");

  const offers = new Map();
  const seen = new Set();
  for (const row of offersCsv.rows) {
    const id = row.COD_Proposta;
    if (id === "") throw new Error("An offer in CondComerciais.csv has no COD_Proposta");
    if (seen.has(id)) throw new Error(`Offer ${id} appears twice`);
    seen.add(id);
    if (!["ELE", "DUAL", "GN"].includes(row.Fornecimento)) {
      throw new Error(`Unknown Fornecimento ${JSON.stringify(row.Fornecimento)} for ${id}`);
    }
    if (!["Dom", "Tod", "Ndom"].includes(row.Segmento)) {
      throw new Error(`Unknown Segmento ${JSON.stringify(row.Segmento)} for ${id}`);
    }
    if (row.Fornecimento === "GN" || row.Segmento === "Ndom") continue;
    const offer = offerFrom(row);
    if (offer.validFrom > date || (offer.validTo !== null && offer.validTo < date)) continue;
    offers.set(id, offer);
  }

  for (const row of pricesCsv.rows) {
    const offer = offers.get(row.COD_Proposta);
    if (!offer) continue;
    // No electricity price at all: a gas-only row of a dual offer, or an option the offer does not
    // have at this power (the TUR has no simple or bi-hourly price above 20,7 kVA).
    if (ELECTRICITY_PRICE_COLUMNS.every((column) => row[column] === "")) continue;
    const power = parseNumber(row.Pot_Cont, `Pot_Cont of ${offer.id}`);
    if (!POWERS_KVA.includes(power)) throw new Error(`Unknown contracted power ${row.Pot_Cont} for ${offer.id}`);
    const option = OPTIONS[row.Contagem];
    if (!option) throw new Error(`Unknown Contagem ${JSON.stringify(row.Contagem)} for ${offer.id}`);
    // A simple price has one energy term and a bi-hourly one two: a value past them is misaligned.
    const extra = ELECTRICITY_PRICE_COLUMNS.slice(1 + Number(row.Contagem)).find((column) => row[column] !== "");
    if (extra) throw new Error(`Unexpected ${extra} in a Contagem ${row.Contagem} price of ${offer.id}`);
    const { key, prices: optionPrices } = option(row, price(row, "TF", PRICE_LIMITS.powerPerDay));
    const atPower = (offer.prices[power] ??= {});
    if (atPower[key]) throw new Error(`Two ${key} prices for ${offer.id} at ${row.Pot_Cont} kVA`);
    atPower[key] = optionPrices;
  }

  const list = [...offers.values()];
  for (const offer of list) {
    if (Object.keys(offer.prices).length === 0) throw new Error(`Offer ${offer.id} has no electricity prices`);
    offer.prices = Object.fromEntries(
      POWERS_KVA.filter((power) => offer.prices[power]).map((power) => [power, offer.prices[power]]),
    );
  }
  if (list.length < minOffers) {
    throw new Error(`Only ${list.length} electricity offers valid on ${date}: refusing to write`);
  }
  const regulated = list.filter((offer) => offer.regulated);
  if (regulated.length !== 1) throw new Error(`Expected one regulated tariff (TUR), found ${regulated.length}`);
  return list.sort(
    (a, b) =>
      Number(b.regulated) - Number(a.regulated) || compareIds(a.supplier, b.supplier) || compareIds(a.id, b.id),
  );
}

/** The export's day: from its file name ("20261117 160141 CSV.zip"), else the zip's own dates. */
export function exportDate(fileName, files) {
  const match = /(\d{4})(\d{2})(\d{2}) \d{6}/.exec(fileName);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const day = files.get(CONDITIONS_FILE)?.modifiedOn;
  if (!day) throw new Error(`No date for the export ${fileName}`);
  return day;
}

/** The export zip to { offers, source }; throws before anything is written. */
export function readExport(zip, { exportFile, date, minOffers } = {}) {
  const files = readZip(zip);
  const text = (name) => {
    const file = files.get(name);
    if (!file) throw new Error(`The export has no ${name}`);
    return file.data.toString("utf8");
  };
  const offers = deriveOffers({ conditions: text(CONDITIONS_FILE), prices: text(PRICES_FILE) }, { date, minOffers });
  const exportedOn = exportDate(exportFile, files);
  if (exportedOn > date) throw new Error(`The export (${exportedOn}) is dated after the snapshot date ${date}`);
  return { offers, source: { exportFile, exportedOn, fetchedOn: date } };
}

// ---------------------------------------------------------------------------------------------
// Module

/** A value as TypeScript source: unquoted identifier keys, numeric keys as numbers. */
function literal(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) || /^\d+(\.\d+)?$/.test(k) ? k : JSON.stringify(k));
  return `{ ${entries.map(([k, v]) => `${key(k)}: ${literal(v)}`).join(", ")} }`;
}

function renderOffer(offer) {
  const { prices, ...rest } = offer;
  const fields = Object.entries(rest).map(([k, v]) => `    ${k}: ${literal(v)},`);
  const powers = Object.entries(prices).map(([power, options]) => `      ${power}: ${literal(options)},`);
  return `  {\n${fields.join("\n")}\n    prices: {\n${powers.join("\n")}\n    },\n  },`;
}

export function renderModule(offers, { exportFile, exportedOn, fetchedOn }) {
  const suppliers = new Set(offers.map((offer) => offer.supplier));
  return `// Generated by scripts/build-electricity-offers.mjs. Do not edit by hand: rerun the script.
//
// Every supplier's household electricity offer in mainland Portugal valid on the snapshot date, from
// ERSE's price simulator export. Prices are EUR before VAT and taxes, power per day and energy per
// kWh. Refund and new-customer % fields are fractions (0.02 is 2%). The comparator loads this
// module with a dynamic import(), so keep it out of static imports. Educational data, not a quote.

import type { ElectricityOffer } from "../electricityOfferTypes";

export const ELECTRICITY_OFFERS_SOURCE = {
  name: ${JSON.stringify(SOURCE.name)},
  url: ${JSON.stringify(SOURCE.url)},
  /** The export this file was generated from (ERSE's csvPath file name). */
  exportFile: ${JSON.stringify(exportFile)},
  /** The day ERSE produced the export: the "data as of" the page shows. */
  exportedOn: ${JSON.stringify(exportedOn)},
  /** When this file was generated; offers are those valid on this day. */
  fetchedOn: ${JSON.stringify(fetchedOn)},
  offerCount: ${offers.length},
  supplierCount: ${suppliers.size},
  /** Bump when the derivation changes, not when the offers change. */
  version: 1,
} as const;

export const ELECTRICITY_OFFERS: readonly ElectricityOffer[] = [
${offers.map(renderOffer).join("\n")}
];
`;
}

// ---------------------------------------------------------------------------------------------

/** Settings.json to the export's URL, refusing anything but an https zip on ERSE's host. */
export function exportUrl(settings) {
  const path = settings?.csvPath;
  if (typeof path !== "string") throw new Error("Settings.json has no csvPath");
  const url = new URL(path, SETTINGS_URL);
  if (url.protocol !== "https:" || !/(^|\.)erse\.pt$/.test(url.hostname) || !url.pathname.endsWith(".zip")) {
    throw new Error(`Unexpected csvPath ${JSON.stringify(path)}`);
  }
  return url;
}

async function download() {
  const settingsResponse = await fetch(SETTINGS_URL);
  if (!settingsResponse.ok) throw new Error(`ERSE answered ${settingsResponse.status} for Settings.json`);
  const settings = JSON.parse((await settingsResponse.text()).replace(/^\uFEFF/, ""));
  const url = exportUrl(settings);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ERSE answered ${response.status} for ${url.href}`);
  return { zip: Buffer.from(await response.arrayBuffer()), exportFile: decodeURIComponent(basename(url.pathname)) };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(name);
    return at === -1 ? undefined : args[at + 1];
  };
  const date = option("--date") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("--date must be YYYY-MM-DD");
  const file = option("--from-file");
  const { zip, exportFile } = file ? { zip: readFileSync(file), exportFile: basename(file) } : await download();
  const { offers, source } = readExport(zip, { exportFile, date });
  const out = fileURLToPath(new URL("../src/lib/calculators/data/electricityOffers.ts", import.meta.url));
  writeFileSync(out, renderModule(offers, source));
  console.log(`Wrote ${offers.length} offers from ${source.exportFile} (${source.exportedOn}), valid on ${date}, to ${out}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

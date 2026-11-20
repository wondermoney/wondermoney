#!/usr/bin/env node
// Refresh script for the products of the PPR comparison: src/lib/calculators/data/pprFunds.ts (CMVM)
// and src/lib/calculators/data/pprInsurance.ts (ASF).
//
// Sources: the two supervisors' own public PPR lists. No comparison site, blog or seller is read.
//
//   CMVM  PPR in the form of investment funds. The Portal do Investidor's "Lista de PPR sob a forma
//         de Fundos de Investimento" (https://investidor.cmvm.pt/PInvestidor/Comparator), an
//         OutSystems page refreshed daily. The script calls the same screen services the page calls:
//         DataActionGetPPRs (every share class: annualised returns at 1, 2, 3, 5 and 10 years to the
//         last business day of the previous calendar year, TEC and risk class) and ActionExportPPRs
//         (the page's "Exportar em Excel" file, the only place the list names each fund's manager).
//         ServiceAPIEncryptInputs turns a fund number into the page's link to the fund's IFI (key
//         investor information document). The services need the module's version token
//         (moduleservices/moduleversioninfo), each call's apiVersion (read from the screen's
//         PInvestidor.Comparator.PPRList.mvc.js) and OutSystems' anonymous CSRF token, so a new
//         CMVM deploy is followed automatically; a changed screen makes the script fail instead.
//   ASF   PPR in the form of insurance and pension funds. The "Plataforma de comparação de Planos de
//         Poupança-Reforma" (https://www.asf.com.pt/plataforma-ppr), built under Norma Regulamentar
//         n.º 11/2024-R: GET /o/servicosasf/get-list-ppr/1/0/{type} returns the products on sale of
//         one type as JSON (1 insurance not linked to funds, 2 insurance linked to funds, 3 pension
//         funds). Insurers and pension fund managers report the figures by 15 April each year, for
//         the last complete calendar year. The site answers only browsers (an F5 bot check sends a
//         script challenge to any other client), so the script does not fetch it: save the three
//         JSON answers from a browser (open each URL, save the page as asf-1.json, asf-2.json and
//         asf-3.json) and pass the folder with --asf-dir. The ASF updates its figures once a year,
//         so this is a yearly step (in May), plus a product launch worth adding.
//
// What is kept: every PPR the CMVM lists for which it publishes a TEC or a return, and every PPR
// the ASF lists as on sale. A figure the source does not publish stays null and the page says
// "not published"; nothing is estimated. Each check below throws before the module is written, so
// a failed or changed source leaves the committed data as it was.
//
// Usage, from apps/landing (Node 22+):
//
//   node scripts/build-ppr-products.mjs [--date YYYY-MM-DD]          CMVM funds (needs network)
//   node scripts/build-ppr-products.mjs --asf-dir <dir> [--date ...]  ASF products, from saved files
//
// --date sets the fetch date (defaults to today, UTC). The CMVM run is monthly, by
// .github/workflows/landing-data-refresh.yml in its own set (ppr).

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

export const USER_AGENT = "WonderMoney-landing-build/1.0 (+https://github.com/wondermoney/wondermoney)";
export const CMVM_BASE = "https://investidor.cmvm.pt/PInvestidor/";
export const CMVM_LIST_URL = `${CMVM_BASE}Comparator`;
export const ASF_PLATFORM_URL = "https://www.asf.com.pt/plataforma-ppr";
/** The platform's list of the products on sale of one type; append the type number. */
export const ASF_API = "https://www.asf.com.pt/o/servicosasf/get-list-ppr/1/0/";
/** OutSystems' built-in token for anonymous calls; the page sends the same one. */
export const OUTSYSTEMS_ANONYMOUS_CSRF = "T6C+9iB49TLra4jEsMeSckDMNhQ=";
const CMVM_SCREEN = "Comparator.PPRList";
const CMVM_SCREEN_JS = `${CMVM_BASE}scripts/PInvestidor.Comparator.PPRList.mvc.js`;
const CMVM_SERVICE = "screenservices/PInvestidor/Comparator/PPRList/";

/** ASF API type number to the kind of PPR. */
export const ASF_TYPES = { 1: "insuranceGuaranteed", 2: "insuranceLinked", 3: "pensionFund" };
/** The ASF's wording for each type, checked on every row so a renumbered API fails. */
const ASF_TYPE_LABELS = {
  insuranceGuaranteed: "Contrato de seguro do ramo «Vida» não ligado a fundos de investimento",
  insuranceLinked: "Contrato de seguro do ramo «Vida» ligado a fundos de investimento",
  pensionFund: "Fundo de pensões",
};

/** CMVM fund types (DES_TIP) to a short category the page names in every locale. */
export const CMVM_FUND_TYPES = {
  "FUNDOS DE POUPANÇA-REFORMA HARMONIZADOS": "ucits",
  "FUNDOS DE AÇÕES DE FUNDOS POUPANÇA-REFORMA HARMONIZADOS": "ucitsEquity",
  "FUNDOS DE OBRIGAÇÕES DE FUNDOS POUPANÇA-REFORMA HARMONIZADOS": "ucitsBond",
  "FUNDOS FLEXÍVEIS DE FUNDOS POUPANÇA-REFORMA HARMONIZADOS": "ucitsFlexible",
  "FUNDOS DE POUPANÇA-REFORMA NÃO HARMONIZADOS": "alternative",
};

/** The ASF's guarantee wording (capital and return) to a key. */
export const ASF_GUARANTEES = {
  "a todo o tempo": "always",
  "no vencimento": "atMaturity",
  "outra situação": "other",
  "sem garantia": "none",
};

/** Below these counts a list is treated as broken, not as a market that shrank overnight. */
export const MIN_ROWS = { cmvm: 40, insuranceGuaranteed: 10, insuranceLinked: 10, pensionFund: 15 };

const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

/**
 * "3,10%", " -0,81% ", "4.98" to a number in percent; "", " - " and null to null. Throws on
 * anything else, and on a value outside `[min, max]`.
 */
export function parsePercent(value, field, { min = -90, max = 300 } = {}) {
  const text = clean(value).replace(/%$/, "").trim();
  if (text === "" || text === "-") return null;
  if (!/^-?\d+(?:[.,]\d+)?$/.test(text)) throw new Error(`${field}: not a percentage: "${value}"`);
  const number = Number(text.replace(",", "."));
  if (number < min || number > max) throw new Error(`${field}: ${number}% is outside ${min}% to ${max}%`);
  return Math.round(number * 100) / 100;
}

/** "1" to "7" to the number; "" and 0 to null. */
export function parseRiskClass(value, field) {
  const text = clean(value);
  if (text === "" || text === "0") return null;
  if (!/^[1-7]$/.test(text)) throw new Error(`${field}: risk class "${value}" is not 1 to 7`);
  return Number(text);
}

/**
 * A CMVM fund name to its product name, short name and share class:
 * "Caixa Arrojado PPR / OICVM - Fundo de Investimento Aberto de Poupança Reforma" to the short name
 * "Caixa Arrojado PPR / OICVM", and " ... - Categoria B" to the share class "B".
 */
export function splitCmvmName(raw) {
  let name = clean(raw);
  let shareClass = null;
  const category = name.match(/\s*-\s*Categoria\s+(\S+)$/i);
  if (category) {
    shareClass = category[1];
    name = name.slice(0, category.index).trim();
  }
  const cut = name.search(/\s*[-,]\s*(?=fundo de investimento)/i);
  const shortName = cut > 0 ? name.slice(0, cut).trim() : name;
  return { name, shortName, shareClass };
}

/** The ASF's capital or return guarantee wording to a key; throws on new wording. */
export function parseGuarantee(value, field) {
  const text = clean(value).toLowerCase();
  if (text === "") return null;
  const key = ASF_GUARANTEES[text];
  if (!key) throw new Error(`${field}: unknown guarantee "${value}"`);
  return key;
}

/**
 * Both lists fill horizons a product has no history for with 0.00% instead of leaving them empty
 * (a 10-year 0.00% next to a 1-year 4.39%). A run of exact zeros at the longest horizons is read as
 * not published; a zero followed by a published longer return is kept.
 */
export function dropPlaceholderZeros(returns) {
  const result = { ...returns };
  for (const key of ["y10", "y5", "y3", "y1"]) {
    if (result[key] === null) continue;
    if (result[key] !== 0) break;
    result[key] = null;
  }
  return result;
}

/** Fee bounds as published, min and max in percent; null when neither is published. */
function feeRange(min, max, field) {
  const low = parsePercent(min, `${field} min`, { min: 0, max: 100 });
  const high = parsePercent(max, `${field} max`, { min: 0, max: 100 });
  if (low === null && high === null) return null;
  if (low !== null && high !== null && low > high) throw new Error(`${field}: minimum ${low}% above maximum ${high}%`);
  return [low ?? high, high ?? low];
}

/** Header names of the CMVM export, in order; a renamed or moved column fails the run. */
export const CMVM_EXPORT_HEADER = [
  "Fundo",
  "Tipo de Fundo",
  "Sociedade Gestora",
  "Retorno YtD",
  "Retorno a 1 ano",
  "Retorno a 2 anos",
  "Retorno a 3 anos",
  "Retorno a 5 anos",
  "Retorno a 10 anos",
  "TEC",
  "Classe de Risco",
];

/** Rows of the CMVM export (an array of arrays, header first) to { name: manager }. */
export function managersFromExport(rows) {
  const [header, ...body] = rows;
  if (JSON.stringify((header ?? []).map(clean)) !== JSON.stringify(CMVM_EXPORT_HEADER))
    throw new Error(`CMVM export: unexpected header ${JSON.stringify(header)}`);
  const managers = new Map();
  for (const row of body) {
    const name = clean(row[0]);
    const manager = clean(row[2]);
    if (!name) continue;
    if (!manager) throw new Error(`CMVM export: no manager for ${name}`);
    const known = managers.get(name);
    if (known && known !== manager) throw new Error(`CMVM export: two managers for ${name}`);
    managers.set(name, manager);
  }
  return managers;
}

/**
 * CMVM PPRList rows, the export's managers and the IFI links by fund number, to products. Rows with
 * no TEC and no return are left out: the list has nothing to compare for them yet.
 */
export function buildCmvmProducts(list, managers, ifiLinks) {
  const products = [];
  for (const row of list) {
    const field = `CMVM ${clean(row.NOM_FUN)}`;
    const value = (key) => (row[`HAS_${key}`] ? row[key] : null);
    const returns = dropPlaceholderZeros({
      y1: parsePercent(value("REND_1Y"), `${field} 1y`),
      y3: parsePercent(value("REND_3Y"), `${field} 3y`),
      y5: parsePercent(value("REND_5Y"), `${field} 5y`),
      y10: parsePercent(value("REND_10Y"), `${field} 10y`),
    });
    const yearlyCost = parsePercent(value("TAXA_TEC"), `${field} TEC`, { min: 0, max: 10 });
    if (yearlyCost === null && Object.values(returns).every((item) => item === null)) continue;
    const fundType = CMVM_FUND_TYPES[clean(row.DES_TIP)];
    if (!fundType) throw new Error(`${field}: unknown fund type "${row.DES_TIP}"`);
    const manager = managers.get(clean(row.NOM_FUN));
    if (!manager) throw new Error(`${field}: not in the CMVM export`);
    const fundNumber = Number(row.NUM_FUN);
    if (!Number.isInteger(fundNumber) || fundNumber <= 0) throw new Error(`${field}: no fund number`);
    const { shortName, shareClass } = splitCmvmName(row.NOM_FUN);
    products.push({
      id: `cmvm-${clean(row.Id)}`,
      name: shortName,
      shareClass,
      manager,
      kind: "fund",
      category: fundType,
      riskClass: parseRiskClass(row.PPRRiskClassId, `${field} risk`),
      yearlyCost,
      subscriptionFee: null,
      redemptionFee: null,
      transferFee: null,
      returns,
      capitalGuarantee: null,
      returnGuarantee: null,
      minGuaranteedRate: null,
      documentUrl: ifiLinks.get(fundNumber) ?? null,
    });
  }
  return products;
}

/** ASF rows of one type to products. Only products on sale are kept. */
export function buildAsfProducts(rows, kind) {
  const products = [];
  const names = new Map();
  for (const row of rows) names.set(clean(row.NomComercial), (names.get(clean(row.NomComercial)) ?? 0) + 1);
  for (const row of rows) {
    if (row.EmComercializacao !== true) continue;
    const name = clean(row.NomComercial);
    const field = `ASF ${name}`;
    if (clean(row.TipoPPR) !== ASF_TYPE_LABELS[kind]) throw new Error(`${field}: type "${row.TipoPPR}", expected ${kind}`);
    const id = Number(row.CodPPR_PK);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${field}: no product code`);
    const category = clean(row.CategoriaUP);
    // A share class is named only when the list has the same product more than once.
    const shareClass = names.get(name) > 1 && category && !/^não aplicável$/i.test(category) ? category : null;
    const capitalGuarantee = parseGuarantee(row.CapitalGarantido, `${field} capital guarantee`);
    products.push({
      id: `asf-${id}`,
      name,
      shareClass,
      manager: clean(row.EmpresaSeguros),
      kind,
      category: null,
      riskClass: parseRiskClass(row.IndicadorRisco, `${field} risk`),
      yearlyCost: parsePercent(row.ValTxCustosAnual, `${field} yearly cost`, { min: 0, max: 10 }),
      subscriptionFee: feeRange(row.ValComissaoSubscricaoMin, row.ValComissaoSubscricaoMax, `${field} subscription`),
      redemptionFee: feeRange(row.ValComissaoReembolsoMin, row.ValComissaoReembolsoMax, `${field} redemption`),
      transferFee: feeRange(row.ValComissaoTransferenciaMin, row.ValComissaoTransferenciaMax, `${field} transfer`),
      returns: dropPlaceholderZeros({
        y1: parsePercent(row.ValRendibilidadeAnualizada1, `${field} 1y`),
        y3: parsePercent(row.ValRendibilidadeAnualizada3, `${field} 3y`),
        y5: parsePercent(row.ValRendibilidadeAnualizada5, `${field} 5y`),
        y10: parsePercent(row.ValRendibilidadeAnualizada10, `${field} 10y`),
      }),
      capitalGuarantee,
      returnGuarantee: parseGuarantee(row.RendibilidadeGarantida, `${field} return guarantee`),
      // The guaranteed minimum is meaningful only where the capital or the return is guaranteed.
      minGuaranteedRate:
        capitalGuarantee && capitalGuarantee !== "none"
          ? parsePercent(row.ValTxRendibilidadeMinGarantida, `${field} minimum rate`, { min: 0, max: 20 })
          : null,
      documentUrl: null,
    });
  }
  return products;
}

/** CMVM returns run to the last business day of the year before the list's update. */
export function cmvmReturnsYear(updatedOn) {
  return Number(updatedOn.slice(0, 4)) - 1;
}

/**
 * ASF figures refer to the last complete calendar year, reported by 15 April and published by the
 * end of April; files saved before May still hold the report of the year before.
 */
export function asfReturnsYear(fetchedOn) {
  const [year, month] = fetchedOn.split("-").map(Number);
  return month >= 5 ? year - 1 : year - 2;
}

/** Throws when an id repeats or a list is shorter than `MIN_ROWS`; returns the counts by list. */
export function checkProducts(products, lists) {
  const counts = { cmvm: 0, insuranceGuaranteed: 0, insuranceLinked: 0, pensionFund: 0 };
  const ids = new Set();
  for (const product of products) {
    if (ids.has(product.id)) throw new Error(`Duplicate product id ${product.id}`);
    ids.add(product.id);
    counts[product.kind === "fund" ? "cmvm" : product.kind] += 1;
  }
  for (const list of lists) {
    if (counts[list] < MIN_ROWS[list]) throw new Error(`Only ${counts[list]} ${list} products (expected at least ${MIN_ROWS[list]})`);
  }
  return counts;
}

const KIND_ORDER = { fund: 0, insuranceLinked: 1, insuranceGuaranteed: 2, pensionFund: 3 };

export function sortProducts(products) {
  return [...products].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.name.localeCompare(b.name, "pt", { sensitivity: "base" }) ||
      String(a.shareClass ?? "").localeCompare(String(b.shareClass ?? ""), "pt") ||
      a.id.localeCompare(b.id),
  );
}

const literal = (value) => (value === null || value === undefined ? "null" : JSON.stringify(value));

function renderProduct(product) {
  const r = product.returns;
  const fee = (range) => (range ? `[${range[0]}, ${range[1]}]` : "null");
  return `  { id: ${literal(product.id)}, name: ${literal(product.name)}, shareClass: ${literal(product.shareClass)}, manager: ${literal(product.manager)}, kind: ${literal(product.kind)}, category: ${literal(product.category)}, riskClass: ${literal(product.riskClass)}, yearlyCost: ${literal(product.yearlyCost)}, subscriptionFee: ${fee(product.subscriptionFee)}, redemptionFee: ${fee(product.redemptionFee)}, transferFee: ${fee(product.transferFee)}, returns: { y1: ${literal(r.y1)}, y3: ${literal(r.y3)}, y5: ${literal(r.y5)}, y10: ${literal(r.y10)} }, capitalGuarantee: ${literal(product.capitalGuarantee)}, returnGuarantee: ${literal(product.returnGuarantee)}, minGuaranteedRate: ${literal(product.minGuaranteedRate)}, documentUrl: ${literal(product.documentUrl)} },`;
}

const HEADER = `// PPR (planos de poupança-reforma) on sale in Portugal, as their supervisor publishes them.
// Figures are in percent, exactly as published; null means the source does not publish it. Returns
// are annualised, after the product's yearly costs and before entry and exit fees and tax.
// Educational data only.`;

/** The CMVM funds module, data/pprFunds.ts. */
/** The CMVM updates its list every day; a list more than a week older than the fetch is stale. */
export const CMVM_MAX_AGE_DAYS = 7;

export function renderFundsModule({ products, updatedOn, fetchedOn }) {
  const counts = checkProducts(products, ["cmvm"]);
  if (counts.cmvm !== products.length) throw new Error("The funds module takes CMVM funds only");
  const age = (Date.parse(`${fetchedOn}T00:00:00Z`) - Date.parse(`${updatedOn}T00:00:00Z`)) / 86_400_000;
  if (!(age >= -1 && age <= CMVM_MAX_AGE_DAYS)) throw new Error(`CMVM: the list was last updated on ${updatedOn}, ${age} days before ${fetchedOn}`);
  return `// Generated by scripts/build-ppr-products.mjs. Do not edit by hand: rerun the script.
//
${HEADER}

import type { PprProduct } from "../pprTypes"

export const PPR_FUNDS_SOURCE = {
  name: "CMVM, Portal do Investidor: Lista de PPR sob a forma de Fundos de Investimento",
  url: ${JSON.stringify(CMVM_LIST_URL)},
  /** The day the script read the list; the CMVM updates it every day. */
  fetchedOn: ${JSON.stringify(fetchedOn)},
  /** Returns run to the last business day of this year. */
  returnsYear: ${cmvmReturnsYear(updatedOn)},
  /** Bump when the derivation changes, not when the figures do. */
  version: 1,
} as const

export const PPR_FUNDS: readonly PprProduct[] = [
${sortProducts(products).map(renderProduct).join("\n")}
]
`;
}

/** The ASF products module, data/pprInsurance.ts. */
export function renderInsuranceModule({ products, fetchedOn }) {
  const lists = ["insuranceGuaranteed", "insuranceLinked", "pensionFund"];
  const counts = checkProducts(products, lists);
  if (counts.cmvm > 0) throw new Error("The insurance module takes ASF products only");
  return `// Generated by scripts/build-ppr-products.mjs --asf-dir. Do not edit by hand: rerun the script.
//
${HEADER}

import type { PprProduct } from "../pprTypes"

export const PPR_INSURANCE_SOURCE = {
  name: "ASF, Plataforma de comparação de Planos de Poupança-Reforma",
  url: ${JSON.stringify(ASF_PLATFORM_URL)},
  regulationUrl: "https://www.asf.com.pt/biblioteca/Catalogo/winlibimg.aspx?skey=F1CB29C3D86B4381AA8257DF98A13C4B&doc=33927&img=15641",
  /** The day the platform's lists were saved. */
  fetchedOn: ${JSON.stringify(fetchedOn)},
  /** Returns and yearly costs refer to this calendar year, reported by 15 April of the next. */
  returnsYear: ${asfReturnsYear(fetchedOn)},
  /** Bump when the derivation changes, not when the figures do. */
  version: 1,
} as const

export const PPR_INSURANCE: readonly PprProduct[] = [
${sortProducts(products).map(renderProduct).join("\n")}
]
`;
}

async function getText(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { "User-Agent": USER_AGENT, ...init.headers } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/** The apiVersion the screen's script passes for one service, as `"<path>", "<apiVersion>"`. */
export function apiVersion(script, service) {
  const marker = `"${CMVM_SERVICE}${service}", "`;
  const start = script.indexOf(marker);
  if (start === -1) throw new Error(`CMVM: ${service} is no longer in the PPR list screen`);
  const version = script.slice(start + marker.length).split('"')[0];
  if (!/^[\w+/=-]{10,}$/.test(version)) throw new Error(`CMVM: odd apiVersion for ${service}: ${version}`);
  return version;
}

async function cmvmCall(session, service, body) {
  const text = await getText(`${CMVM_BASE}${CMVM_SERVICE}${service}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      Accept: "application/json",
      "X-CSRFToken": OUTSYSTEMS_ANONYMOUS_CSRF,
    },
    body: JSON.stringify({
      versionInfo: { moduleVersion: session.moduleVersion, apiVersion: apiVersion(session.script, service) },
      viewName: CMVM_SCREEN,
      ...body,
    }),
  });
  const json = JSON.parse(text);
  if (json.exception || !json.data) throw new Error(`CMVM ${service}: ${json.exception?.message ?? "no data"}`);
  return json.data;
}

const NO_FILTERS = { FundTypes: { List: [] }, ManagingEntities: { List: [] }, RiskClasses: { List: [] }, SearchCode: "" };

async function fetchCmvm() {
  const { versionToken } = JSON.parse(await getText(`${CMVM_BASE}moduleservices/moduleversioninfo`));
  if (!versionToken) throw new Error("CMVM: no module version token");
  const session = { moduleVersion: versionToken, script: await getText(CMVM_SCREEN_JS) };
  const listData = await cmvmCall(session, "DataActionGetPPRs", {
    screenData: {
      variables: {
        TableSort: "NOM_FUN",
        StartIndex: 0,
        MaxRecords: 5000,
        SelectedFilters: NO_FILTERS,
        FetchDecryptInputs: { FundComparatorTypeId: 1, DataFetchStatus: 1 },
      },
    },
  });
  const list = listData.PPRList?.List ?? [];
  if (list.length !== Number(listData.PPRCount)) throw new Error(`CMVM: ${list.length} rows, the list counts ${listData.PPRCount}`);
  const updatedOn = String(listData.UpdatedOn ?? "").slice(0, 10);
  if (!isDate(updatedOn)) throw new Error(`CMVM: no update date (${listData.UpdatedOn})`);
  const exportData = await cmvmCall(session, "ActionExportPPRs", {
    inputParameters: { SelectedFilters: NO_FILTERS, FundComparatorTypeId: 1 },
  });
  const workbook = XLSX.read(Buffer.from(exportData.PPRBinary ?? "", "base64"), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const managers = managersFromExport(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }));
  const ifiLinks = new Map();
  for (const fundNumber of [...new Set(list.map((row) => Number(row.NUM_FUN)))].sort((a, b) => a - b)) {
    const inputs = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`Input${index + 1}`, index === 0 ? String(fundNumber) : ""]));
    const { EncryptedText } = await cmvmCall(session, "ServiceAPIEncryptInputs", { inputParameters: inputs });
    if (!/^[0-9A-F]{32,}$/.test(EncryptedText ?? "")) throw new Error(`CMVM: no IFI link for fund ${fundNumber}`);
    ifiLinks.set(fundNumber, `${CMVM_BASE}PDF_fundo?Input=${EncryptedText}`);
  }
  return { products: buildCmvmProducts(list, managers, ifiLinks), updatedOn };
}

/** The three saved ASF answers (asf-1.json, asf-2.json, asf-3.json in `dir`) to products. */
export function readAsfDir(dir) {
  const products = [];
  for (const [type, kind] of Object.entries(ASF_TYPES)) {
    const text = readFileSync(join(dir, `asf-${type}.json`), "utf8");
    if (!text.trimStart().startsWith("[")) throw new Error(`asf-${type}.json is not the platform's JSON list (saved the bot check page?)`);
    products.push(...buildAsfProducts(JSON.parse(text), kind));
  }
  return products;
}

function write(out, source) {
  const temporary = `${out}.tmp`;
  writeFileSync(temporary, source);
  renameSync(temporary, out);
}

/** Fetches the CMVM list and writes the funds module; nothing is written unless every check passes. */
export async function refreshFunds({ fetchedOn, out }) {
  const { products, updatedOn } = await fetchCmvm();
  write(out, renderFundsModule({ products, updatedOn, fetchedOn }));
  return { count: products.length, updatedOn };
}

/** Reads saved ASF lists and writes the insurance module. */
export function refreshInsurance({ dir, fetchedOn, out }) {
  const products = readAsfDir(dir);
  write(out, renderInsuranceModule({ products, fetchedOn }));
  return { count: products.length };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const fetchedOn = option("--date") ?? new Date().toISOString().slice(0, 10);
  const asfDir = option("--asf-dir");
  if (!isDate(fetchedOn) || (args.includes("--asf-dir") && !asfDir)) {
    console.error("Usage: node scripts/build-ppr-products.mjs [--asf-dir <dir>] [--date YYYY-MM-DD]");
    process.exit(1);
  }
  const data = (file) => fileURLToPath(new URL(`../src/lib/calculators/data/${file}`, import.meta.url));
  if (asfDir) {
    const out = data("pprInsurance.ts");
    const { count } = refreshInsurance({ dir: asfDir, fetchedOn, out });
    console.log(`Wrote ${count} PPR from the ASF platform to ${out}`);
  } else {
    const out = data("pprFunds.ts");
    const { count, updatedOn } = await refreshFunds({ fetchedOn, out });
    console.log(`Wrote ${count} PPR funds from the CMVM list of ${updatedOn} to ${out}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

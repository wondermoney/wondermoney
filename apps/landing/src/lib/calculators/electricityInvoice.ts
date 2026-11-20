// Reads a household electricity invoice's figures from the text of its PDF, for the electricity
// tariff comparator. Pure: the page extracts the text in the browser with pdf.js
// (invoicePdf.ts, loaded only when a file is chosen) and passes it here as positioned text items;
// the file is never uploaded. Only what an invoice states is returned, each field with how sure the
// reading is; the page fills only the fields found and shows them before using them.
//
// Each supported layout is learned from the supplier's own public "how to read your invoice" page,
// whose annotated sample invoice shows the labels below. No customer invoice was used, and the tests
// use synthetic text built from those samples with made-up numbers. Sources, read on 2026-11-20:
//
// - EDP Comercial: https://www.edp.pt/particulares/apoio-cliente/como-ler-fatura/ (sample invoice
//   of 29 September 2024, electricity and gas, and of 3 November 2025, electric mobility only).
// - Galp: https://www.galp.com/pt/casa/ajuda/gestao-contratual-leituras-faturacao-e-pagamentos/como-posso-ler-minha-fatura-galp
//   (sample invoice of August 2025).
// - Goldenergy: https://goldenergy.pt/fatura/ (sample invoice of 6 March 2025).
// - Endesa: https://www.endesa.pt/particulares/news-endesa/poupanca/fatura-energia-novidades
//   (article of 14 July 2021; sample invoice of 1 July 2020).
// - Iberdrola: https://www.iberdrola.pt/apoio-cliente/a-sua-fatura (the site refuses automated
//   requests; read in the Internet Archive's copy of 7 June 2026,
//   http://web.archive.org/web/20260607162719/https://www.iberdrola.pt/apoio-cliente/a-sua-fatura).
//
// Not supported: SU Eletricidade (the regulated supplier). Its public help
// (https://www.sueletricidade.pt/pt-pt/faqs/categoria/nova-fatura/371) describes the invoice's
// sections in prose but shows no sample with the line labels, so its layout cannot be learned from
// an official source. Other suppliers' invoices get the "not supported" message.
//
// What a layout gives:
// - Every sample is on the simple option, so a simple invoice reads with high confidence. Bi- and
//   tri-hourly lines are matched by ERSE's period names (vazio, fora de vazio, ponta, cheias),
//   which no sample shows on these lines, so their kWh and prices come back marked to check.
// - Prices are the contracted ones before VAT and before any discount line. Where an invoice
//   splits the power price into the supplier's part and the network access part (Goldenergy,
//   Endesa), the two are added, as ERSE's offer prices include both.
// - The days are the days the power term was billed, the period the comparison prices.
// - Credit notes, adjustments of earlier bills, network access breakdowns, taxes, gas and electric
//   mobility sections are left out.

import type { ContractedPowerKva } from "./electricityOfferTypes";
import {
  CONTRACTED_POWER_OPTIONS_KVA,
  TARIFF_COMPARISON_LIMITS,
  type HourlyCycle,
  type TariffOption,
} from "./electricityTariffComparison";
import { OPTION_PERIODS } from "./electricityTariffComparator";
import type { KnownSupplierCode } from "./electricitySuppliers";

// ---------------------------------------------------------------------------------------------
// From positioned text to lines

/** A run of text on a PDF page, as pdf.js gives it: x and y of its baseline start, in points. */
export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The page's text as lines, top to bottom, each in reading order. Items on the same baseline
 * (within a third of their height) are one line; a gap wider than a fifth of the text height
 * between two items becomes a space.
 */
export function linesFromItems(pages: readonly (readonly PdfTextItem[])[]): string[] {
  const lines: string[] = [];
  for (const items of pages) {
    const rows: { y: number; height: number; items: PdfTextItem[] }[] = [];
    const sorted = items.filter((item) => item.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of sorted) {
      const height = item.height > 0 ? item.height : 10;
      const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2, Math.min(candidate.height, height) / 3));
      if (row) row.items.push(item);
      else rows.push({ y: item.y, height, items: [item] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      let text = "";
      let end = Number.NEGATIVE_INFINITY;
      for (const item of row.items) {
        const gap = item.x - end;
        if (text !== "" && gap > row.height / 5) text += " ";
        text += item.str;
        end = item.x + item.width;
      }
      const line = text.replace(/\s+/g, " ").trim();
      if (line !== "") lines.push(line);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// What a reading holds

/** "high": read from a field the supplier documents. "check": inferred, or a layout not shown. */
export type InvoiceConfidence = "high" | "check";

export interface InvoiceField<T> {
  value: T;
  confidence: InvoiceConfidence;
}

export interface InvoicePrices {
  /** The power term, € a day before VAT, network access included. */
  powerPerDay?: number;
  /** € per kWh before VAT, one per period of the option, in PERIOD_KEYS order. */
  energy?: number[];
}

export interface InvoiceReading {
  supplier?: InvoiceField<KnownSupplierCode>;
  contractedPower?: InvoiceField<ContractedPowerKva>;
  option?: InvoiceField<TariffOption>;
  cycle?: InvoiceField<HourlyCycle>;
  /** The days the invoice bills; always present with kwhByPeriod. */
  periodDays?: InvoiceField<number>;
  /** kWh per period of `option`, in PERIOD_KEYS order (simple; off-valley, valley; peak, shoulder, valley). */
  kwhByPeriod?: InvoiceField<number[]>;
  prices?: InvoiceField<InvoicePrices>;
}

export type InvoiceLayoutId = "edp" | "endesa" | "galp" | "goldenergy" | "iberdrola";

export type InvoiceResult =
  | { ok: true; layout: InvoiceLayoutId; reading: InvoiceReading }
  /** "unsupported": no supported supplier's layout. "noElectricity": a supported supplier, but no electricity figures. */
  | { ok: false; reason: "unsupported" | "noElectricity" };

/** The layouts the reader knows, with the supplier code ERSE's offers use. */
export const INVOICE_LAYOUTS: readonly { id: InvoiceLayoutId; supplier: KnownSupplierCode }[] = [
  { id: "edp", supplier: "EDPC" },
  { id: "endesa", supplier: "END" },
  { id: "galp", supplier: "GALP" },
  { id: "goldenergy", supplier: "GOLD" },
  { id: "iberdrola", supplier: "IBD" },
];

// ---------------------------------------------------------------------------------------------
// Text helpers. Lines are matched lower case and without accents.

const fold = (line: string) =>
  line
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u00a0\u202f]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** A price: a comma is the decimal mark (dots group thousands); without a comma, a dot is. */
function parsePrice(token: string): number {
  const clean = token.replace(/\s/g, "");
  const value = clean.includes(",") ? Number(clean.replace(/\./g, "").replace(",", ".")) : Number(clean);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** A quantity: a comma is the decimal mark, and a dot before three digits groups thousands. */
function parseQuantity(token: string): number {
  const clean = token.replace(/\s/g, "");
  if (clean.includes(",")) return parsePrice(clean);
  return Number(/^\d{1,3}(\.\d{3})+$/.test(clean) ? clean.replace(/\./g, "") : clean);
}

const NUMBER = String.raw`\d[\d.]*(?:,\d+)?`;
const DECIMAL = String.raw`\d+[.,]\d+`;
const withoutBrackets = (line: string) => line.replace(/\([^)]*\)/g, " ");

/** "157 kWh 0,166823 €": the kWh and the price after them. Bracketed notes such as "(>100kWh)" are skipped. */
function kwhAndPrice(line: string): { kwh: number; price: number } | null {
  const match = new RegExp(String.raw`(${NUMBER})\s*kwh\b\s*(${DECIMAL})`).exec(withoutBrackets(line));
  return match ? { kwh: parseQuantity(match[1]), price: parsePrice(match[2]) } : null;
}

/** "31 dias 0,3046 €": the days and the price a day after them. */
function daysAndPrice(line: string): { days: number; price: number } | null {
  const match = new RegExp(String.raw`\b(\d{1,3})\s*dias?\b\s*(${DECIMAL})`).exec(withoutBrackets(line));
  return match ? { days: Number(match[1]), price: parsePrice(match[2]) } : null;
}

/** Days from the first to the last of two dates "dd/mm/yyyy", both counted, as the invoices bill them. */
function dateSpanDays(line: string): number | null {
  const match = /(\d{2})\/(\d{2})\/(\d{4})\s*(?:-|a)?\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(line);
  if (!match) return null;
  const [d1, m1, y1, d2, m2, y2] = match.slice(1).map(Number);
  const days = (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000 + 1;
  return days >= 1 ? days : null;
}

/** The contracted power options, matched to the cent of a kVA. */
function contractedPowerOf(token: string): ContractedPowerKva | undefined {
  const value = parsePrice(token);
  return CONTRACTED_POWER_OPTIONS_KVA.find((power) => Math.abs(power - value) < 0.005);
}

const OPTION_WORD = String.raw`simples|bi-?horari[ao]|tri-?horari[ao]`;

function optionOf(word: string | undefined): TariffOption | undefined {
  if (!word) return undefined;
  if (/^simples$|sem ciclo/.test(word)) return "simple";
  if (/^bi-?horari/.test(word)) return "biHourly";
  if (/^tri-?horari/.test(word)) return "triHourly";
  return undefined;
}

function cycleOf(word: string | undefined): HourlyCycle | undefined {
  if (word === "diario") return "daily";
  if (word === "semanal") return "weekly";
  return undefined;
}

type Period = "simple" | "offValley" | "valley" | "peak" | "shoulder";

/** The ERSE period a label names; "fora de vazio" before "vazio". */
function periodOf(text: string): Period | undefined {
  if (/\bfora (?:de )?vazio\b/.test(text)) return "offValley";
  if (/\bvazio\b/.test(text)) return "valley";
  if (/\bponta\b/.test(text)) return "peak";
  if (/\bcheias?\b/.test(text)) return "shoulder";
  if (/\bsimples\b/.test(text)) return "simple";
  return undefined;
}

/**
 * The value of a label set above its value, as in a two-column box ("Ciclo horário" over
 * "Diário"): looked for after the label on its line, then anywhere on the next line.
 */
function labelled(lines: readonly string[], label: RegExp, value: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i].search(label);
    if (at === -1) continue;
    const sameLine = value.exec(lines[i].slice(at).replace(label, ""));
    if (sameLine) return sameLine[1];
    const nextLine = i + 1 < lines.length ? value.exec(lines[i + 1]) : null;
    if (nextLine) return nextLine[1];
  }
  return undefined;
}

/** The first capture of `pattern` in any line. */
function firstMatch(lines: readonly string[], pattern: RegExp): RegExpExecArray | null {
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) return match;
  }
  return null;
}

/**
 * The lines of the sections that bill electricity: from a line matching `start` until one matching
 * `stop`. A stop line is not part of the section, a start line is.
 */
function sectionLines(lines: readonly string[], start: readonly RegExp[], stop: readonly RegExp[]): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (stop.some((pattern) => pattern.test(line))) inside = false;
    else if (start.some((pattern) => pattern.test(line))) inside = true;
    if (inside) out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Layouts

interface EnergyLine {
  period: Period | undefined;
  kwh: number;
  price: number;
}

interface PowerLine {
  days: number;
  price: number;
  /** Lines of one part of the price (the supplier's, the network access) are averaged; parts are added. */
  part: string;
}

/** What a layout reads; the shared step turns it into the reading. */
interface LayoutRead {
  contractedPower?: { value: ContractedPowerKva; labelled: boolean };
  option?: TariffOption;
  cycle?: HourlyCycle;
  energy: EnergyLine[];
  power: PowerLine[];
  /** Days when no power line gives them. */
  days?: number;
  /** Prices the invoice states as totals (Galp's "Informações de preço"), which win over the lines'. */
  statedPrices?: { powerPerDay?: number; energy: Partial<Record<Period, number>> };
}

interface Layout {
  id: InvoiceLayoutId;
  supplier: KnownSupplierCode;
  /** How many times the invoice names the supplier. */
  marker: RegExp;
  read: (lines: readonly string[]) => LayoutRead;
}

const KVA = String.raw`(\d+(?:[.,]\d+)?)\s*kva`;

/** A kVA the layout's own label gives, when it is one of the contracted power options. */
function statedPower(token: string | undefined): LayoutRead["contractedPower"] {
  const value = token === undefined ? undefined : contractedPowerOf(token);
  return value === undefined ? undefined : { value, labelled: true };
}

/** The kVA wherever the layout's own label gives it, else the one kVA value the invoice names. */
function powerFrom(lines: readonly string[], labelledPatterns: readonly RegExp[]): LayoutRead["contractedPower"] {
  for (const pattern of labelledPatterns) {
    const match = firstMatch(lines, pattern);
    const value = match ? contractedPowerOf(match[1]) : undefined;
    if (value !== undefined) return { value, labelled: true };
  }
  const found = new Set<ContractedPowerKva>();
  for (const line of lines) {
    for (const match of line.matchAll(new RegExp(KVA, "g"))) {
      const value = contractedPowerOf(match[1]);
      if (value !== undefined) found.add(value);
    }
  }
  return found.size === 1 ? { value: [...found][0], labelled: false } : undefined;
}

/** A cycle stated next to "ciclo" or under "Ciclo horário". */
function cycleFrom(lines: readonly string[]): HourlyCycle | undefined {
  return (
    cycleOf(firstMatch(lines, /\bciclo (?:horario )?(diario|semanal)\b/)?.[1]) ??
    cycleOf(labelled(lines, /\bciclo horario\b/, /\b(diario|semanal)\b/))
  );
}

/** Energy lines whose period is on the line or on the period heading above them ("Simples", "Vazio"). */
function energyUnderHeadings(lines: readonly string[]): EnergyLine[] {
  const energy: EnergyLine[] = [];
  let heading: Period | undefined;
  for (const line of lines) {
    const reading = kwhAndPrice(line);
    if (!reading) {
      const only = /^(simples|fora (?:de )?vazio|vazio|ponta|cheias?)$/.exec(line);
      if (only) heading = periodOf(only[1]);
      continue;
    }
    const label = line.slice(0, line.search(/\d/));
    energy.push({ period: periodOf(label) ?? heading, ...reading });
  }
  return energy;
}

const EDP: Layout = {
  id: "edp",
  supplier: "EDPC",
  marker: /\bedp comercial\b/g,
  read(lines) {
    // "Os meus dados": "Potência" over "4,6 kVA (simples)"; the detail repeats "Potência (4,6 kVA)".
    const stated = firstMatch(lines, new RegExp(String.raw`${KVA}\s*\((${OPTION_WORD})\)`));
    const section = sectionLines(
      lines,
      [/^eletricidade$/],
      [/^nota de (?:credito|debito)\b/, /^taxas, impostos/, /^mobilidade eletrica\b/, /^gas natural$/, /^o total da fatura inclui\b/, /^servicos$/],
    );
    const power: PowerLine[] = [];
    let underPower = false;
    for (const line of section) {
      if (/^potencia\b/.test(line)) underPower = true;
      const days = underPower ? daysAndPrice(line) : null;
      if (days) {
        power.push({ ...days, part: "total" });
        underPower = false;
      }
    }
    return {
      contractedPower: statedPower(stated?.[1]) ?? powerFrom(lines, [/^potencia \((\d+(?:[.,]\d+)?)\s*kva\)/]),
      option: optionOf(stated?.[2]),
      cycle: cycleFrom(lines),
      energy: energyUnderHeadings(section.filter((line) => !/^potencia\b/.test(line))),
      power,
    };
  },
};

const GALP: Layout = {
  id: "galp",
  supplier: "GALP",
  marker: /\bgalp\b/g,
  read(lines) {
    // The electricity bar: "Eletricidade  CPE …  Tarifa 6.9 kVA Simples".
    const bar = firstMatch(lines, new RegExp(String.raw`\btarifa\s*${KVA}\s*(${OPTION_WORD})\b`));
    const section = sectionLines(lines, [/^comercializacao\b/], [/^tarifas de acesso\b/, /^taxas e impostos\b/, /^gas natural\b/, /^servicos\b/, /^descontos\b/]);
    const energy: EnergyLine[] = [];
    const power: PowerLine[] = [];
    let days: number | undefined;
    for (const line of section) {
      const label = /\benergia ((?:simples|fora (?:de )?vazio|vazio|ponta|cheias?))\b/.exec(line);
      const reading = label ? kwhAndPrice(line) : null;
      if (label && reading) energy.push({ period: periodOf(label[1]), ...reading });
      if (/\bpotencia contratada\b/.test(line) && days === undefined) days = dateSpanDays(line) ?? undefined;
    }
    // "Informações de preço": "Energia Simples: 0.17740000 €/kWh", "Potência Contratada: 0.54960000 €/dia".
    const statedEnergy: Partial<Record<Period, number>> = {};
    for (const line of lines) {
      for (const match of line.matchAll(new RegExp(String.raw`energia ((?:simples|fora (?:de )?vazio|vazio|ponta|cheias?))\s*:\s*(${DECIMAL})\s*€\s*/\s*kwh`, "g"))) {
        const period = periodOf(match[1]);
        if (period) statedEnergy[period] = parsePrice(match[2]);
      }
    }
    const boxPower = firstMatch(lines, new RegExp(String.raw`potencia contratada\s*:\s*(${DECIMAL})\s*€\s*/\s*dia`));
    return {
      contractedPower: statedPower(bar?.[1]) ?? powerFrom(lines, []),
      option: optionOf(bar?.[2]),
      cycle: cycleFrom(lines),
      energy,
      power,
      days,
      statedPrices: { powerPerDay: boxPower ? parsePrice(boxPower[1]) : undefined, energy: statedEnergy },
    };
  },
};

const GOLDENERGY: Layout = {
  id: "goldenergy",
  supplier: "GOLD",
  marker: /\bgold ?energy\b/g,
  read(lines) {
    // "Potência:" over "4,6 kVA/Simples".
    const stated =
      firstMatch(lines, new RegExp(String.raw`${KVA}\s*/\s*(${OPTION_WORD})\b`)) ??
      firstMatch(lines, new RegExp(String.raw`potencia:\s*${KVA}\s*/\s*(${OPTION_WORD})\b`));
    // The detail runs from "Fatura nº" to the end, except a credit note's lines.
    const section = sectionLines(lines, [/^fatura n/], [/^nota de credito\b/]);
    const energy: EnergyLine[] = [];
    const power: PowerLine[] = [];
    for (const line of section) {
      const consumption = /^consumo elec?tricidade\b(.*?)\b(?:medido|estimado)\b/.exec(line);
      const reading = consumption ? kwhAndPrice(line) : null;
      if (consumption && reading) energy.push({ period: periodOf(consumption[1]), ...reading });
      const term = /^(acesso as redes )?potencia contratada\b/.exec(line);
      const days = term ? daysAndPrice(line) : null;
      if (term && days) power.push({ ...days, part: term[1] ? "access" : "supplier" });
    }
    return {
      contractedPower: statedPower(stated?.[1]) ?? powerFrom(lines, [/^potencia contratada\s*(\d+(?:[.,]\d+)?)\s*kva/]),
      option: optionOf(stated?.[2]),
      cycle: cycleFrom(lines),
      energy,
      power,
    };
  },
};

const ENDESA: Layout = {
  id: "endesa",
  supplier: "END",
  marker: /\bendesa\b/g,
  read(lines) {
    // "Dados da Conta": "Potência" and "Ciclo horário" over "3,45kVA" and "Sem ciclo".
    const cycleWord = labelled(lines, /\bciclo horario\b/, /\b(sem ciclo|diario|semanal)\b/);
    const section = sectionLines(lines, [/^luz\b.*\bfatura\b/, /^luz \(consumo\)/], [/^total luz\b/, /^gas\b/, /^servicos\b/, /^taxas e impostos\b/, /^nota de credito\b/]);
    const energy: EnergyLine[] = [];
    const power: PowerLine[] = [];
    for (const line of section) {
      const term = /^termo de energia\b(.*)/.exec(line);
      const reading = term ? kwhAndPrice(line) : null;
      if (term && reading) energy.push({ period: periodOf(withoutBrackets(term[1])), ...reading });
      const fixed = /^termo (de potencia|fixo acesso as redes)\b/.exec(line);
      const days = fixed ? daysAndPrice(line) : null;
      if (fixed && days) power.push({ ...days, part: fixed[1] === "de potencia" ? "supplier" : "access" });
    }
    return {
      contractedPower:
        statedPower(labelled(lines, /\bpotencia\b/, new RegExp(KVA))) ?? powerFrom(lines, [/^termo de potencia \((\d+(?:[.,]\d+)?)\s*kva\)/]),
      option: cycleWord === "sem ciclo" ? "simple" : optionOf(firstMatch(lines, new RegExp(String.raw`\b(${OPTION_WORD})\b`))?.[1]),
      cycle: cycleOf(cycleWord),
      energy,
      power,
    };
  },
};

const IBERDROLA: Layout = {
  id: "iberdrola",
  supplier: "IBD",
  marker: /\biberdrola\b/g,
  read(lines) {
    // "Dados do seu contrato": "Tipo de Tarifa" and "Ciclo Horário" over their values.
    const tariff = labelled(lines, /\btipo de tarifa\b/, new RegExp(String.raw`\b(${OPTION_WORD})\b`));
    const section = sectionLines(
      lines,
      [/^consumo de energia$/, /^potencia contratada \d/],
      [/^acertos de valores\b/, /^servicos adicionais$/, /^debitos e creditos$/, /^taxas e impostos$/],
    );
    const energy: EnergyLine[] = [];
    const power: PowerLine[] = [];
    for (const line of section) {
      const label = /^energia ((?:simples|fora (?:de )?vazio|vazio|ponta|cheias?))\b/.exec(line);
      const reading = label ? kwhAndPrice(line) : null;
      if (label && reading) energy.push({ period: periodOf(label[1]), ...reading });
      const days = /^potencia contratada\b/.test(line) ? daysAndPrice(line) : null;
      if (days) power.push({ ...days, part: "total" });
    }
    return {
      contractedPower: powerFrom(lines, [/^potencia contratada\s*(\d+(?:[.,]\d+)?)\s*kva$/]),
      option: optionOf(tariff),
      cycle: cycleFrom(lines),
      energy,
      power,
    };
  },
};

const LAYOUTS: readonly Layout[] = [EDP, ENDESA, GALP, GOLDENERGY, IBERDROLA];

// ---------------------------------------------------------------------------------------------
// From a layout's lines to the reading

const PERIODS_OF: Record<TariffOption, readonly Period[]> = {
  simple: ["simple"],
  biHourly: ["offValley", "valley"],
  triHourly: ["peak", "shoulder", "valley"],
};

/** The option the periods billed imply. */
function optionFromPeriods(periods: ReadonlySet<Period | undefined>): TariffOption {
  if (periods.has("peak") || periods.has("shoulder")) return periods.has("offValley") ? "biHourly" : "triHourly";
  if (periods.has("valley") || periods.has("offValley")) return "biHourly";
  return "simple";
}

/**
 * The kWh and the price of each of the option's periods. A simple contract adds every line (a
 * smart meter registers vazio, ponta and cheias even then); bi-hourly counts ponta and cheias as
 * off-valley. Null when the lines cannot give the option's periods (tri-hourly from bi-hourly lines).
 */
function byPeriod(option: TariffOption, energy: readonly EnergyLine[]): { kwh: number[]; prices: number[]; consistent: boolean } | null {
  const bucket = (line: EnergyLine): Period | undefined => {
    if (option === "simple") return "simple";
    if (option === "biHourly") return line.period === "valley" ? "valley" : line.period === undefined || line.period === "simple" ? undefined : "offValley";
    return line.period === "peak" || line.period === "shoulder" || line.period === "valley" ? line.period : undefined;
  };
  const kwh: number[] = [];
  const prices: number[] = [];
  let consistent = true;
  for (const period of PERIODS_OF[option]) {
    const lines = energy.filter((line) => bucket(line) === period);
    if (lines.length === 0 || energy.some((line) => bucket(line) === undefined)) return null;
    const total = lines.reduce((sum, line) => sum + line.kwh, 0);
    const weighted = total > 0 ? lines.reduce((sum, line) => sum + line.kwh * line.price, 0) / total : lines[0].price;
    if (lines.some((line) => Math.abs(line.price - lines[0].price) > 1e-6)) consistent = false;
    kwh.push(Math.round(total * 1000) / 1000);
    prices.push(Math.round(weighted * 1e6) / 1e6);
  }
  return { kwh, prices, consistent };
}

/** Power lines to one price a day and the days billed: each part's days-weighted price, parts added. */
function powerTerm(lines: readonly PowerLine[]): { price: number; days: number } | null {
  if (lines.length === 0) return null;
  const parts = new Map<string, PowerLine[]>();
  for (const line of lines) parts.set(line.part, [...(parts.get(line.part) ?? []), line]);
  let price = 0;
  let days = 0;
  for (const partLines of parts.values()) {
    const partDays = partLines.reduce((sum, line) => sum + line.days, 0);
    if (partDays <= 0) return null;
    price += partLines.reduce((sum, line) => sum + line.days * line.price, 0) / partDays;
    days = Math.max(days, partDays);
  }
  return { price: Math.round(price * 1e6) / 1e6, days };
}

const validPrice = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value > 0 && value <= 5;

/** The layout of the invoice: the supported supplier it names most, if exactly one. */
function layoutOf(lines: readonly string[]): Layout | undefined {
  const text = lines.join("\n");
  const counts = LAYOUTS.map((layout) => ({ layout, count: text.match(layout.marker)?.length ?? 0 })).filter((entry) => entry.count > 0);
  counts.sort((a, b) => b.count - a.count);
  if (counts.length === 0 || (counts.length > 1 && counts[0].count === counts[1].count)) return undefined;
  return counts[0].layout;
}

/** Reads an electricity invoice's figures from its text lines (linesFromItems). */
export function readElectricityInvoice(rawLines: readonly string[]): InvoiceResult {
  const lines = rawLines.map(fold).filter((line) => line !== "");
  const layout = layoutOf(lines);
  if (!layout) return { ok: false, reason: "unsupported" };
  const read = layout.read(lines);
  const reading: InvoiceReading = {};

  if (read.contractedPower?.value !== undefined) {
    reading.contractedPower = { value: read.contractedPower.value, confidence: read.contractedPower.labelled ? "high" : "check" };
  }
  const energy = read.energy.filter((line) => Number.isFinite(line.kwh) && line.kwh >= 0 && Number.isFinite(line.price));
  const option = read.option ?? (energy.length > 0 ? optionFromPeriods(new Set(energy.map((line) => line.period))) : undefined);
  if (option) reading.option = { value: option, confidence: read.option ? "high" : "check" };
  if (read.cycle && option !== "simple") reading.cycle = { value: read.cycle, confidence: "high" };

  // Every sample invoice is simple; other options are read by the period names alone.
  const documented = option === "simple";
  const power = powerTerm(read.power);
  const days = power?.days ?? read.days;
  const periods = option && energy.length > 0 ? byPeriod(option, energy) : null;
  if (periods && days !== undefined && days >= 1 && days <= TARIFF_COMPARISON_LIMITS.maxDays) {
    reading.periodDays = { value: days, confidence: "high" };
    reading.kwhByPeriod = { value: periods.kwh, confidence: documented && read.option ? "high" : "check" };
  }

  const prices: InvoicePrices = {};
  const powerPerDay = read.statedPrices?.powerPerDay ?? power?.price;
  if (validPrice(powerPerDay)) prices.powerPerDay = powerPerDay;
  let energyConsistent = periods?.consistent ?? false;
  let energyPrices = periods?.prices;
  if (option && read.statedPrices && PERIODS_OF[option].every((period) => read.statedPrices?.energy[period] !== undefined)) {
    energyPrices = PERIODS_OF[option].map((period) => read.statedPrices?.energy[period] as number);
    energyConsistent = true;
  }
  if (energyPrices && energyPrices.length === OPTION_PERIODS[option as TariffOption] && energyPrices.every(validPrice)) prices.energy = energyPrices;
  if (prices.powerPerDay !== undefined || prices.energy) {
    const complete = prices.powerPerDay !== undefined && prices.energy !== undefined;
    reading.prices = { value: prices, confidence: complete && energyConsistent && documented && read.option ? "high" : "check" };
  }

  if (!reading.contractedPower && !reading.option && !reading.kwhByPeriod && !reading.prices) return { ok: false, reason: "noElectricity" };
  reading.supplier = { value: layout.supplier, confidence: "high" };
  return { ok: true, layout: layout.id, reading };
}

// ---------------------------------------------------------------------------------------------
// Into the comparator's form

/** The comparator form's fields an invoice can fill (its FormState has these and more). */
export interface InvoiceFormFields {
  contractedPower: ContractedPowerKva;
  option: TariffOption;
  cycle: HourlyCycle;
  mode: "quick" | "full";
  source: "periods" | "total" | "diagram";
  period: "month" | "year" | "days";
  days: number;
  periods: number[];
  myTariffOn: boolean;
  myPower: number;
  myEnergy: number[];
}

/**
 * The form with the invoice's figures in it; every field the reading lacks keeps its value. kWh
 * move the form to the full mode, kWh per period over the invoice's days; prices switch on "my
 * tariff".
 */
export function applyInvoiceReading<T extends InvoiceFormFields>(form: T, reading: InvoiceReading): T {
  const next: T = { ...form };
  if (reading.contractedPower) next.contractedPower = reading.contractedPower.value;
  if (reading.option) next.option = reading.option.value;
  if (reading.cycle) next.cycle = reading.cycle.value;
  const fill = (current: readonly number[], values: readonly number[]) => current.map((value, index) => values[index] ?? value);
  if (reading.kwhByPeriod && reading.periodDays) {
    next.mode = "full";
    next.source = "periods";
    next.period = "days";
    next.days = reading.periodDays.value;
    next.periods = fill(form.periods, reading.kwhByPeriod.value);
  }
  const prices = reading.prices?.value;
  if (prices) {
    next.myTariffOn = true;
    if (prices.powerPerDay !== undefined) next.myPower = prices.powerPerDay;
    if (prices.energy) next.myEnergy = fill(form.myEnergy, prices.energy);
  }
  return next;
}

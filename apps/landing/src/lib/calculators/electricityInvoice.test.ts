import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyInvoiceReading,
  INVOICE_LAYOUTS,
  linesFromItems,
  readElectricityInvoice,
  type InvoiceFormFields,
  type InvoiceReading,
  type PdfTextItem,
} from "./electricityInvoice";
import {
  EDP_BI_HOURLY,
  EDP_MOBILITY_ONLY,
  EDP_SIMPLE,
  ENDESA_SIMPLE,
  GALP_SIMPLE,
  GOLDENERGY_SIMPLE,
  IBERDROLA_SIMPLE,
  UNKNOWN_SUPPLIER,
} from "./electricityInvoice.fixtures";
import { ELECTRICITY_SUPPLIER_NAMES } from "./electricitySuppliers";

function read(lines: readonly string[]): InvoiceReading {
  const result = readElectricityInvoice(lines);
  if (!result.ok) throw new Error(`not read: ${result.reason}`);
  return result.reading;
}

/** Each field's value, and the fields read with less than high confidence. */
function summary(reading: InvoiceReading) {
  const values = Object.fromEntries(Object.entries(reading).map(([key, field]) => [key, field.value]));
  const toCheck = Object.entries(reading)
    .filter(([, field]) => field.confidence !== "high")
    .map(([key]) => key)
    .sort();
  return { values, toCheck };
}

describe("reading an electricity invoice", () => {
  it("reads EDP Comercial's simple invoice and leaves out the credit note, the access breakdown and the taxes", () => {
    const result = readElectricityInvoice(EDP_SIMPLE);
    expect(result.ok && result.layout).toBe("edp");
    expect(summary(read(EDP_SIMPLE))).toEqual({
      values: {
        supplier: "EDPC",
        contractedPower: 4.6,
        option: "simple",
        periodDays: 30,
        kwhByPeriod: [160],
        prices: { powerPerDay: 0.29, energy: [0.19] },
      },
      toCheck: [],
    });
  });

  it("reads Galp's prices from its price box, not from the supplier-only block, and the kWh once", () => {
    expect(summary(read(GALP_SIMPLE))).toEqual({
      values: {
        supplier: "GALP",
        contractedPower: 5.75,
        option: "simple",
        periodDays: 30,
        kwhByPeriod: [240],
        prices: { powerPerDay: 0.46, energy: [0.15] },
      },
      toCheck: [],
    });
  });

  it("adds Goldenergy's measured and estimated meter periods on a simple contract and its two power terms", () => {
    expect(summary(read(GOLDENERGY_SIMPLE))).toEqual({
      values: {
        supplier: "GOLD",
        contractedPower: 3.45,
        option: "simple",
        periodDays: 30,
        kwhByPeriod: [165],
        prices: { powerPerDay: 0.21, energy: [0.17] },
      },
      toCheck: [],
    });
  });

  it("reads Endesa's simple invoice ('Sem ciclo') and adds the network access to the power term", () => {
    expect(summary(read(ENDESA_SIMPLE))).toEqual({
      values: {
        supplier: "END",
        contractedPower: 4.6,
        option: "simple",
        periodDays: 30,
        kwhByPeriod: [210],
        prices: { powerPerDay: 0.27, energy: [0.16] },
      },
      toCheck: [],
    });
  });

  it("reads Iberdrola's invoice without the adjustment of an earlier bill, the discounts or the taxes", () => {
    expect(summary(read(IBERDROLA_SIMPLE))).toEqual({
      values: {
        supplier: "IBD",
        contractedPower: 6.9,
        option: "simple",
        periodDays: 30,
        kwhByPeriod: [200],
        prices: { powerPerDay: 0.4, energy: [0.15] },
      },
      toCheck: [],
    });
  });

  it("reads a bi-hourly invoice by its period names, marked to check since no sample shows one", () => {
    expect(summary(read(EDP_BI_HOURLY))).toEqual({
      values: {
        supplier: "EDPC",
        contractedPower: 6.9,
        option: "biHourly",
        cycle: "daily",
        periodDays: 31,
        kwhByPeriod: [140, 110],
        prices: { powerPerDay: 0.41, energy: [0.23, 0.12] },
      },
      toCheck: ["kwhByPeriod", "prices"],
    });
  });

  it("says when a supported supplier's invoice has no home electricity to read", () => {
    expect(readElectricityInvoice(EDP_MOBILITY_ONLY)).toEqual({ ok: false, reason: "noElectricity" });
  });

  it("says when the supplier's layout is not supported, or the text names no supplier at all", () => {
    expect(readElectricityInvoice(UNKNOWN_SUPPLIER)).toEqual({ ok: false, reason: "unsupported" });
    expect(readElectricityInvoice([])).toEqual({ ok: false, reason: "unsupported" });
    // Two suppliers named as often: no guess.
    expect(readElectricityInvoice(["Galp", "Endesa", "Potência 3,45 kVA"])).toEqual({ ok: false, reason: "unsupported" });
  });

  it("splits tri-hourly lines by period and refuses to make three periods out of two", () => {
    const tri = EDP_BI_HOURLY.map((line) => line.replace("(bi-horária)", "(tri-horária)"))
      .flatMap((line) => (line === "Fora vazio" ? ["Ponta"] : [line]))
      .flatMap((line) => (line.startsWith("1 out a 31 out 2026 140 kWh") ? [line, "Cheias", "1 out a 31 out 2026 60 kWh 0,1800 € 10,80 € 23%"] : [line]));
    expect(read(tri).kwhByPeriod?.value).toEqual([140, 60, 110]);
    expect(read(tri).prices?.value.energy).toEqual([0.23, 0.18, 0.12]);

    const fromBi = EDP_BI_HOURLY.map((line) => line.replace("(bi-horária)", "(tri-horária)"));
    const reading = read(fromBi);
    expect(reading.option?.value).toBe("triHourly");
    expect(reading.kwhByPeriod).toBeUndefined();
    expect(reading.prices?.value).toEqual({ powerPerDay: 0.41 });
    expect(reading.prices?.confidence).toBe("check");
  });

  it("infers the option from the periods billed when the invoice does not state it, marked to check", () => {
    const unstated = EDP_BI_HOURLY.map((line) => (line === "6,9 kVA (bi-horária)" ? "6,9 kVA" : line));
    const reading = read(unstated);
    expect(reading.option).toEqual({ value: "biHourly", confidence: "check" });
    expect(reading.contractedPower).toEqual({ value: 6.9, confidence: "high" });
  });

  it("averages a price that changed during the period by kWh, and asks to check it", () => {
    const changed = IBERDROLA_SIMPLE.map((line) => line.replace("40 kWh 0,1500€/kWh", "40 kWh 0,2000€/kWh"));
    const reading = read(changed);
    expect(reading.prices?.value.energy).toEqual([0.16]);
    expect(reading.prices?.confidence).toBe("check");
    expect(reading.kwhByPeriod).toEqual({ value: [200], confidence: "high" });
  });

  it("leaves out a contracted power that is not an option and a price outside 0 to 5 euro", () => {
    const odd = ENDESA_SIMPLE.map((line) =>
      line.replace("4,6kVA", "4,4kVA").replace("(4.6 kVA)", "(4.4 kVA)").replace("0,160000 €", "6,000000 €"),
    );
    const reading = read(odd);
    expect(reading.contractedPower).toBeUndefined();
    expect(reading.prices?.value).toEqual({ powerPerDay: 0.27 });
  });

  it("reads thousands of kWh and a dot or a comma as the decimal mark", () => {
    const large = GOLDENERGY_SIMPLE.map((line) => line.replace("50 KWH 0,1700", "1.250 KWH 0,1700"));
    expect(read(large).kwhByPeriod?.value).toEqual([1365]);
    const galpComma = GALP_SIMPLE.map((line) => line.replace("0.15000000 €/kWh", "0,15000000 €/kWh"));
    expect(read(galpComma).prices?.value.energy).toEqual([0.15]);
  });

  it("names only suppliers the comparator knows", () => {
    for (const layout of INVOICE_LAYOUTS) expect(ELECTRICITY_SUPPLIER_NAMES[layout.supplier]).toBeTruthy();
  });

  it("cites an official source with the date read for every layout, and keeps fixtures free of personal data", () => {
    const source = readFileSync(fileURLToPath(new URL("./electricityInvoice.ts", import.meta.url)), "utf8");
    for (const host of ["edp.pt", "galp.com", "goldenergy.pt", "endesa.pt", "iberdrola.pt", "sueletricidade.pt"]) {
      expect(source).toContain(`https://www.${host}`.replace("www.goldenergy", "goldenergy"));
    }
    expect(source).toMatch(/read on \d{4}-\d{2}-\d{2}/);
    const fixtures = readFileSync(fileURLToPath(new URL("./electricityInvoice.fixtures.ts", import.meta.url)), "utf8");
    // No CPE (PT + 16 digits), NIF or IBAN-shaped numbers.
    expect(fixtures).not.toMatch(/PT\s?\d{4}\s?\d{3,4}\s?\d{3,4}/);
    expect(fixtures).not.toMatch(/\b[1-35-9]\d{8}\b/);
    expect(fixtures).not.toMatch(/PT50\d/);
  });
});

describe("text lines from pdf.js items", () => {
  const item = (str: string, x: number, y: number, width = str.length * 5, height = 10): PdfTextItem => ({ str, x, y, width, height });

  it("groups items on one baseline into a line in reading order, top line first, page by page", () => {
    const pages = [
      [item("0,1900 €", 300, 700.5), item("Simples", 50, 720), item("90 kWh", 200, 700), item("1 set a 28 set 2026", 50, 699)],
      [item("Potência (4,6 kVA)", 50, 500)],
    ];
    expect(linesFromItems(pages)).toEqual(["Simples", "1 set a 28 set 2026 90 kWh 0,1900 €", "Potência (4,6 kVA)"]);
  });

  it("joins the pieces of a split word and drops empty items", () => {
    expect(linesFromItems([[item("Pot", 50, 100, 15), item("ência", 65, 100), item(" ", 100, 100), item("6,9 kVA", 120, 100)]])).toEqual([
      "Potência 6,9 kVA",
    ]);
  });
});

describe("filling the comparator form", () => {
  const form: InvoiceFormFields & { bill: number } = {
    bill: 50,
    contractedPower: 3.45,
    option: "simple",
    cycle: "daily",
    mode: "quick",
    source: "total",
    period: "month",
    days: 30,
    periods: [200, 130, 70],
    myTariffOn: false,
    myPower: Number.NaN,
    myEnergy: [Number.NaN, Number.NaN, Number.NaN],
  };

  it("puts every field read into the form, in the full mode, and leaves the rest as it was", () => {
    expect(applyInvoiceReading(form, read(EDP_BI_HOURLY))).toEqual({
      ...form,
      contractedPower: 6.9,
      option: "biHourly",
      cycle: "daily",
      mode: "full",
      source: "periods",
      period: "days",
      days: 31,
      periods: [140, 110, 70],
      myTariffOn: true,
      myPower: 0.41,
      myEnergy: [0.23, 0.12, Number.NaN],
    });
  });

  it("changes only what was read", () => {
    const powerOnly: InvoiceReading = { contractedPower: { value: 6.9, confidence: "high" } };
    expect(applyInvoiceReading(form, powerOnly)).toEqual({ ...form, contractedPower: 6.9 });
    expect(applyInvoiceReading(form, {})).toEqual(form);
  });
});

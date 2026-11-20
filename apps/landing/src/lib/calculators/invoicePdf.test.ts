import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { readElectricityInvoice } from "./electricityInvoice";
import { EDP_SIMPLE, GALP_SIMPLE } from "./electricityInvoice.fixtures";

// In the browser the worker is a URL Vite emits; in Node pdf.js imports it from a file URL.
vi.mock("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url", () => ({
  default: pathToFileURL(createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs")).href,
}));
const { InvoicePdfError, readInvoicePdfLines } = await import("./invoicePdf");

/**
 * A minimal PDF with Helvetica text: each page a list of rows, each row text runs at an x
 * position, in WinAnsi so Portuguese accents survive. Built by hand so the test needs no PDF
 * library: pdf.js reads it as it reads an invoice.
 */
function makePdf(pages: readonly (readonly (readonly [number, string])[])[][]): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1;
  const pageIds: number[] = [];
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pagesId = objects.length + 1 + pages.length * 2;
  for (const rows of pages) {
    // WinAnsi has the euro sign at 0x80, where Latin-1 has a control character.
    const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`).replace(/€/g, "\x80");
    const stream = rows
      .map((runs, index) => runs.map(([x, text]) => `BT /F1 9 Tf ${x} ${800 - index * 14} Td (${escape(text)}) Tj ET`).join("\n"))
      .join("\n");
    const content = add(`<< /Length ${Buffer.from(stream, "latin1").length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/** A fixture's lines as rows of one run each, split across pages of 30 rows. */
const asPages = (lines: readonly string[]) => {
  const rows = lines.map((line) => [[50, line] as const]);
  return Array.from({ length: Math.ceil(rows.length / 30) }, (_, page) => rows.slice(page * 30, page * 30 + 30));
};

describe("reading an invoice PDF with pdf.js", () => {
  it("gives the fixture's lines back from a PDF, and the reader reads them", async () => {
    const lines = await readInvoicePdfLines(makePdf(asPages(EDP_SIMPLE)));
    expect(lines).toEqual(EDP_SIMPLE);
    expect(readElectricityInvoice(lines)).toMatchObject({ ok: true, layout: "edp" });
  });

  it("puts table columns drawn as separate runs on one line", async () => {
    const period = [50, "01/09/2026 - 30/09/2026"] as const;
    const power = [period, [170, "Potência Contratada 5,75kVA"], [300, "1"], [350, "0,20000000 €"], [440, "30"], [460, "6,00€"]] as const;
    const energy = [period, [170, "Energia Simples (medida)"], [300, "150 kWh"], [350, "0,10000000 €/kWh"], [440, "1"], [460, "15,00€"]] as const;
    const lines = await readInvoicePdfLines(makePdf([[[[50, "Comercialização 30,00€"]], power, energy]]));
    expect(lines).toEqual([
      "Comercialização 30,00€",
      "01/09/2026 - 30/09/2026 Potência Contratada 5,75kVA 1 0,20000000 € 30 6,00€",
      "01/09/2026 - 30/09/2026 Energia Simples (medida) 150 kWh 0,10000000 €/kWh 1 15,00€",
    ]);
    const result = readElectricityInvoice([GALP_SIMPLE[1], ...lines, "Galp Energia"]);
    expect(result.ok && result.reading.kwhByPeriod?.value).toEqual([150]);
  });

  it("says when a file is not a PDF or has no text", async () => {
    await expect(readInvoicePdfLines(new TextEncoder().encode("not a pdf"))).rejects.toEqual(new InvoicePdfError("unreadable"));
    await expect(readInvoicePdfLines(makePdf([[]]))).rejects.toEqual(new InvoicePdfError("noText"));
  });
});

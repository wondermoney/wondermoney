// Extracts the text of an invoice PDF in the browser with pdf.js, for electricityInvoice.ts.
// pdf.js and its worker are loaded with dynamic imports when the visitor chooses a file, so they
// never reach the page's initial bundle. The file is read from memory and never sent anywhere:
// pdf.js gets no URL for fonts, character maps or decoders, so it fetches nothing, and only the
// text layer is read (no page is rendered). The legacy build keeps older mobile browsers working.

import { linesFromItems, type PdfTextItem } from "./electricityInvoice";

/** Invoices run to a few pages; anything longer is read up to here. */
const MAX_PAGES = 12;

export type InvoicePdfErrorCode = "unreadable" | "encrypted" | "noText";

export class InvoicePdfError extends Error {
  constructor(readonly code: InvoicePdfErrorCode) {
    super(code);
    this.name = "InvoicePdfError";
  }
}

/** The PDF's text as lines (linesFromItems). Throws InvoicePdfError. */
export async function readInvoicePdfLines(data: Uint8Array): Promise<string[]> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    useWasm: false,
    enableXfa: false,
    stopAtErrors: false,
  });
  try {
    const document = await task.promise;
    const pages: PdfTextItem[][] = [];
    for (let number = 1; number <= Math.min(document.numPages, MAX_PAGES); number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(
        content.items.flatMap((item) =>
          "str" in item
            ? [{ str: item.str, x: Number(item.transform[4]), y: Number(item.transform[5]), width: item.width, height: item.height }]
            : [],
        ),
      );
    }
    const lines = linesFromItems(pages);
    if (lines.length === 0) throw new InvoicePdfError("noText");
    return lines;
  } catch (error) {
    if (error instanceof InvoicePdfError) throw error;
    throw new InvoicePdfError(error instanceof Error && error.name === "PasswordException" ? "encrypted" : "unreadable");
  } finally {
    await task.destroy();
  }
}

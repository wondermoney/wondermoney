export const convertPDFToImage = async (pdfContents: string): Promise<string[]> => {
  const { pdf } = await import('pdf-to-img');

  const pages = [];
  const document = await pdf(pdfContents, { scale: 1 });

  for await (const image of document) {
    pages.push(image.toString('base64'));
  }
  return pages;
};

/**
 * Reads a PDF's embedded text layer, concatenated across pages.
 *
 * Returns `''` for a scanned/image-only PDF (no text layer) and for anything pdf.js cannot open,
 * so callers can treat "no text" as a single fall-back-to-OCR condition rather than juggling
 * error types. A PDF that *does* carry text is always worth preferring over vision: the glyphs are
 * read, not recognised, so the result is deterministic.
 *
 * pdf.js is already in the tree as `pdf-to-img`'s renderer; it is declared directly in
 * `package.json` because this is a first-class use of it rather than a borrowed transitive dep.
 */
export const extractPDFTextLayer = async (pdfContents: Buffer | Uint8Array): Promise<string> => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  try {
    // `data` is transferred and neutered by pdf.js, so hand it a copy — callers reuse their buffer
    // (the OCR fall-back re-reads the very same bytes).
    const document = await getDocument({
      data: new Uint8Array(pdfContents),
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
    }

    await document.destroy();
    return pages.join('\n');
  } catch {
    return '';
  }
};

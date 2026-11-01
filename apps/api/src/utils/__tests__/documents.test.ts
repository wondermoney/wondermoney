import { describe, expect, it } from 'vitest';

import { convertPDFToImage, extractPDFTextLayer } from '@utils/documents';

/** A well-formed PDF, `width`×`height` points, one line of Helvetica text per page. */
function buildPdf(pageTexts: string[], width = 200, height = 100): Buffer {
  const pageId = (index: number) => 4 + index * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageTexts.map((_, index) => `${pageId(index)} 0 R`).join(' ')}] /Count ${pageTexts.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pageTexts.flatMap((text, index) => {
      const stream = `BT /F1 12 Tf 10 40 Td (${text}) Tj ET`;
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId(index) + 1} 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
    }),
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function pngSize(base64: string) {
  const png = Buffer.from(base64, 'base64');
  return { height: png.readUInt32BE(20), signature: png.subarray(0, 8).toString('hex'), width: png.readUInt32BE(16) };
}

describe('extractPDFTextLayer', () => {
  it('reads the text layer of every page, one line per page', async () => {
    await expect(extractPDFTextLayer(buildPdf(['Taxa base 2,474%', 'Serie F']))).resolves.toBe('Taxa base 2,474%\nSerie F');
  });

  it('leaves the caller\'s buffer usable for the OCR fall-back', async () => {
    const pdf = buildPdf(['Receipt']);
    const before = Buffer.from(pdf);

    await extractPDFTextLayer(pdf);

    expect(pdf.equals(before)).toBe(true);
  });

  it('returns an empty string for bytes pdf.js cannot open', async () => {
    await expect(extractPDFTextLayer(Buffer.from('not a pdf'))).resolves.toBe('');
  });
});

describe('convertPDFToImage', () => {
  it('renders each page to a PNG at the page size, for the OCR vision call', async () => {
    const pdf = buildPdf(['Total 12,50 EUR', 'Page two'], 200, 100);

    const pages = await convertPDFToImage(`data:application/pdf;base64,${pdf.toString('base64')}`);

    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(pngSize(page)).toEqual({ height: 100, signature: '89504e470d0a1a0a', width: 200 });
    }
  });
});

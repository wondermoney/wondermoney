/**
 * Content-type detection from a file's leading bytes.
 *
 * A client declares a content type in the upload request and the store records it, but neither
 * is trustworthy: a `.pdf` that is really a zip, or an image whose declared type was simply
 * wrong, would otherwise be stored and served as what it claimed to be. Every upload that
 * matters (receipt OCR, transaction attachments) is checked against these signatures.
 *
 * Only the types WonderMoney accepts are recognised; anything else reads as `null`.
 */

export const SUPPORTED_FILE_CONTENT_TYPES = ['application/pdf', 'image/heic', 'image/jpeg', 'image/png', 'image/webp'] as const;

export type SupportedFileContentType = (typeof SUPPORTED_FILE_CONTENT_TYPES)[number];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** ISO base media files carry their brand at bytes 8..12; HEIC/HEIF use one of these. */
const HEIC_BRANDS = new Set(['heic', 'heim', 'heis', 'heix', 'hevc', 'hevm', 'hevs', 'hevx', 'mif1', 'msf1']);

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/**
 * The content type the bytes actually are, or `null` when it is not one WonderMoney accepts.
 */
export function sniffFileContentType(bytes: Uint8Array): null | SupportedFileContentType {
  if (startsWith(bytes, PDF_SIGNATURE)) return 'application/pdf';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(bytes, JPEG_SIGNATURE)) return 'image/jpeg';
  // WebP is a RIFF container whose form type is "WEBP" — checking only "RIFF" would also match
  // a WAV or an AVI.
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp' && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return 'image/heic';
  return null;
}

/**
 * Whether the bytes match the content type the client declared. `image/jpg` is the legacy alias
 * some clients still send for JPEG.
 */
export function bytesMatchContentType(bytes: Uint8Array, declaredContentType: string): boolean {
  const declared = declaredContentType === 'image/jpg' ? 'image/jpeg' : declaredContentType;
  return sniffFileContentType(bytes) === declared;
}

/** The file extension for a supported content type. */
export function extensionForContentType(contentType: SupportedFileContentType): string {
  switch (contentType) {
    case 'application/pdf': return 'pdf';
    case 'image/heic': return 'heic';
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
  }
}

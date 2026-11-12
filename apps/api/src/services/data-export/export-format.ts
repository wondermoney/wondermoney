/**
 * The WonderMoney export format: a zip that a person can open in a spreadsheet and that
 * WonderMoney can read back (restore, wondermoney/wondermoney#67).
 *
 * Layout:
 *
 *   manifest.json            format and app version, export time, export-local household and
 *                            member ids, currency, and per-file row counts and SHA-256
 *   data/<entity>.json       one JSON array per entity, one row per line
 *   csv/<name>.csv           spreadsheet copies of the most-used tables
 *
 * Every row has an export-local `id` (1, 2, 3... per file) and refers to other rows by those ids
 * (`accountId`, `categoryId`...). Database keys never leave the server. Currencies are ISO codes;
 * assets are symbol, exchange and ISIN; transaction types, statuses and enums are their stored
 * names. Money is a decimal string (`"-12.3"`), so no amount loses precision in a JSON parser.
 *
 * Versioning: bump the minor version for an additive change (a new file or field a reader may
 * ignore) and the major version when a reader of the old version would misread the file. A
 * restore rejects an unknown major version and migrates older minor versions.
 *
 * Password protection (wondermoney/wondermoney#66):
 *
 * A protected export is the same archive as a standard WinZip AES zip, so 7-Zip, Keka, WinRAR
 * and similar tools open it with the password, without WonderMoney. The layout gains one file:
 *
 *   README.txt               first entry, NOT encrypted: says the archive is protected and how
 *                            to open it ({@link ENCRYPTED_EXPORT_README})
 *   manifest.json, data/*, csv/*
 *                            each encrypted on its own, exactly as described below
 *
 * Every encrypted entry follows the WinZip AE-2 specification
 * (https://www.winzip.com/en/support/aes-encryption/):
 *
 *   - local and central headers: general-purpose flag bit 0 set, compression method 99, and an
 *     AES extra field (id 0x9901) with vendor version 2 ("AE-2"), vendor id "AE", strength 3
 *     (AES-256) and the real compression method (8, deflate). The header CRC-32 is 0 (AE-2).
 *   - data: a 16-byte random salt, a 2-byte password verification value, the ciphertext, and a
 *     10-byte authentication code.
 *   - keys: PBKDF2-HMAC-SHA1 over the UTF-8 password and the salt, 1000 iterations, 66 bytes:
 *     32 for AES-256 (CTR mode, little-endian counter from 1), 32 for HMAC-SHA1, 2 for the
 *     verification value.
 *   - integrity: HMAC-SHA1 over the ciphertext, truncated to 10 bytes. A wrong password fails
 *     the verification value; a changed byte fails the authentication code.
 *
 * The salt is per entry, so two exports of the same data never share a key. The format fixes the
 * key derivation at 1000 PBKDF2 iterations, which is cheap to brute-force: the password rule
 * ({@link EXPORT_PASSWORD_MIN_LENGTH} characters at least) carries the protection, not the KDF.
 *
 * What is not protected: entry names, sizes and dates are in clear in the zip headers, and the
 * central directory is not authenticated. A reader (such as a restore) therefore treats the archive as
 * protected when `manifest.json` is encrypted, and then requires every other entry but README.txt
 * to be AES-encrypted too and to match the manifest's SHA-256: a file swapped, added or removed
 * by someone without the password is caught there (`export-archive-reader.ts`). The manifest has
 * no field for the encryption, so a protected and an unprotected export of the same data hold the
 * same manifest and the format version does not change.
 */
export const EXPORT_FORMAT = 'wondermoney-export';
/**
 * 1.1 added `data/manual-assets.json` and `data/manual-asset-valuations.json`. 1.2 added
 * `data/loan-rate-periods.json` and the `VARIABLE` loan rate type.
 */
export const EXPORT_FORMAT_VERSION = '1.2';

export interface ExportManifest {
  appVersion: string;
  /** The household's display currency: the exporting member's currency. */
  currency: null | string;
  exportedAt: string;
  /** The member who made the export, by their id in `data/members.json`. */
  exportedBy: { memberId: number };
  files: ExportManifestFile[];
  format: typeof EXPORT_FORMAT;
  formatVersion: typeof EXPORT_FORMAT_VERSION;
  household: { id: number; ownerMemberId: null | number };
  /**
   * What the export holds: everything the exporting member can see in their household. The other
   * member's private accounts, and everything that hangs off them, are left out.
   */
  scope: 'member-visible';
}

export interface ExportManifestFile {
  bytes: number;
  path: string;
  rows: number;
  sha256: string;
}

/** The shortest password a protected export accepts, in characters (Unicode code points). */
export const EXPORT_PASSWORD_MIN_LENGTH = 16;
/** The longest, to bound the work one request can ask for. */
export const EXPORT_PASSWORD_MAX_LENGTH = 256;

export const ENCRYPTED_EXPORT_README_PATH = 'README.txt';

/** The one unencrypted file of a protected export, in the three languages the app speaks. */
export const ENCRYPTED_EXPORT_README = `WonderMoney data export (password protected)

The files in this archive are encrypted with AES-256 (WinZip AES). Open it with 7-Zip
(Windows, Linux), Keka (macOS), WinRAR, or WonderMoney's restore, and enter the password you
chose when you started the export. The built-in zip tools of some systems cannot open
encrypted archives. A forgotten password cannot be recovered: start a new export instead.

---

Exportação de dados WonderMoney (protegida por palavra-passe)

Os ficheiros deste arquivo estão cifrados com AES-256 (WinZip AES). Abra-o com o 7-Zip
(Windows, Linux), o Keka (macOS), o WinRAR ou o restauro do WonderMoney, e introduza a
palavra-passe que escolheu ao iniciar a exportação. As ferramentas de zip integradas de alguns
sistemas não abrem arquivos cifrados. Uma palavra-passe esquecida não pode ser recuperada:
inicie uma nova exportação.

---

Exportación de datos de WonderMoney (protegida con contraseña)

Los archivos de este zip están cifrados con AES-256 (WinZip AES). Ábralo con 7-Zip
(Windows, Linux), Keka (macOS), WinRAR o la restauración de WonderMoney, e introduzca la
contraseña que eligió al iniciar la exportación. Las herramientas de zip integradas de algunos
sistemas no abren archivos cifrados. Una contraseña olvidada no se puede recuperar: inicie una
nueva exportación.
`;

/** `wondermoney-export-2026-11-08.zip`, dated in UTC. */
export function exportFileName(at: Date): string {
  return `wondermoney-export-${at.toISOString().slice(0, 10)}.zip`;
}

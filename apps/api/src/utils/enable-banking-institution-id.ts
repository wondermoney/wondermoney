export interface EnableBankingInstitutionRef {
  country: string;
  name: string;
}

/**
 * Enable Banking identifies an institution by `{name, country}`, not an opaque id
 * (unlike GoCardless). The frontend bank picker still needs a single stable string to
 * carry from `getBankList` to `startBankConnection`, so this synthesizes one rather
 * than exposing raw `name`/`country` as separate request fields.
 *
 * Encoding: `base64url("{country}::{name}")`. `country` is always a fixed 2-letter
 * ISO code, so `decodeEnableBankingInstitutionId` slices it back off by position
 * rather than splitting on `::` — that stays correct even if a bank's own name
 * happens to contain `::`.
 */
export function encodeEnableBankingInstitutionId({ country, name }: EnableBankingInstitutionRef): string {
  return Buffer.from(`${country}::${name}`, 'utf8').toString('base64url');
}

/** Returns `null` (never throws) for a malformed/tampered id — callers should treat that as a 400. */
export function decodeEnableBankingInstitutionId(id: string): EnableBankingInstitutionRef | null {
  let decoded: string;
  try {
    decoded = Buffer.from(id, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (decoded.length < 5 || decoded[2] !== ':' || decoded[3] !== ':') return null;
  const country = decoded.slice(0, 2);
  const name = decoded.slice(4);
  if (!country.trim() || !name.trim()) return null;
  return { country, name };
}

/**
 * A distinct, human-legible id for `AccountFinancialInstitution.id` (Phase 1d), separate from
 * `encodeEnableBankingInstitutionId`'s base64url bank-picker id above (which round-trips through
 * the frontend and is opaque by design). This one only needs to be **stable** and **never collide
 * with a legacy GoCardless opaque institution id** — GoCardless ids look like
 * `SANDBOXFINANCE_SFIN0000` or `REVOLUT_REVOGB21` (bank code + BIC-ish suffix, no colons), so a
 * `enable_banking:{country}:{slug}` prefix can't collide with one in practice. The
 * `(provider, id)` composite unique constraint (Phase 1a migration) is the actual backstop; this
 * is just defense in depth plus a readable id for debugging/logs.
 */
export function buildEnableBankingInstitutionRecordId({ country, name }: EnableBankingInstitutionRef): string {
  return `enable_banking:${country.toLowerCase()}:${slugify(name)}`;
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'institution';
}

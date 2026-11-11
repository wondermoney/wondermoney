import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { ImportAdapter, ImportParseResult, ImportSourceAccount, ImportWarning, NormalizedImportRow, ParsedImportRow } from './types';

/**
 * CAMT.053 (ISO 20022 end-of-day bank statement) reader, for the staged import session.
 *
 * A CAMT.053 file is an XML `Document` holding one `BkToCstmrStmt` with one or more `Stmt`
 * blocks. Each `Stmt` is a source account labelled by its IBAN (`Acct/Id/IBAN`, or the `Othr/Id`
 * a bank writes instead); a file with more than one asks for an account mapping.
 *
 * Every `Ntry` becomes a row: `BookgDt` (falling back to `ValDt`) is the date, `Amt` with
 * `CdtDbtInd` the signed amount and currency, the counterparty name in
 * `NtryDtls/TxDtls/RltdPties` the merchant, and `RmtInf/Ustrd` the description. An entry whose
 * `Sts` is not `BOOK` is skipped with a warning.
 *
 * A batch booking (several `TxDtls` under one `Ntry`) imports as one row per detail when the
 * details add up to the entry's amount, and as the single entry otherwise.
 *
 * The external id is the entry's (or detail's) `AcctSvcrRef`, then `NtryRef`, then a date+amount
 * fingerprint marked `externalIdTrusted: false`. A reference repeated inside its statement is a
 * fingerprint too, so a batch never dedups itself.
 *
 * ## XXE
 *
 * A CAMT.053 file never has a document type declaration, and one that does is refused before
 * parsing: the parser resolves no external entity, and rejecting the `DOCTYPE` also refuses the
 * internal entity declarations an expansion attack needs.
 */

export interface Camt053AdapterOptions {
  /** The currency of a row whose statement and entry name none: the target account's. Unused: a row with no currency takes the account's. */
  accountCurrency?: string;
}

/** The file is not a readable CAMT.053 document. */
export class Camt053UnreadableError extends Error {
  constructor(readonly code: 'doctype' | 'not_camt053' | 'unreadable' = 'unreadable') {
    super(code === 'doctype' ? 'This file declares a document type, which a bank statement never has' : code === 'not_camt053' ? 'This file is not a CAMT.053 document' : 'Could not read the CAMT.053 file');
    this.name = 'Camt053UnreadableError';
  }
}

/**
 * Whether the bytes look like a CAMT.053 document: the ISO 20022 statement wrapper
 * (`BkToCstmrStmt`) and a `Stmt` block. CAMT.052 (intraday reports) and CAMT.054
 * (notifications) carry neither.
 */
export function isCamt053File(input: Uint8Array): boolean {
  const head = decodeText(input).slice(0, 16_384);
  return /<(?:[A-Za-z0-9_.-]+:)?BkToCstmrStmt[\s>]/.test(head) && /<(?:[A-Za-z0-9_.-]+:)?Stmt[\s>]/.test(head);
}

export const camt053ImportAdapter: ImportAdapter<Camt053AdapterOptions> = {
  format: 'camt053',
  async parse(input) {
    const text = decodeText(input);
    if (/<!DOCTYPE/i.test(text)) throw new Camt053UnreadableError('doctype');
    const document = readDocument(text);
    const statements = readStatements(document, text);
    if (statements.length === 0) throw new Camt053UnreadableError('not_camt053');
    return buildResult(statements);
  },
};

// ---------------------------------------------------------------------------------------------
// Reading the document
// ---------------------------------------------------------------------------------------------

type XmlNode = Record<string, unknown>;

/** A UTF-8 file with or without a byte-order mark; CAMT.053 is always UTF-8. */
function decodeText(input: Uint8Array): string {
  const bytes = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  return new TextDecoder('utf-8').decode(bytes);
}

/** The parsed tree, with the arrays the reader walks. Values stay strings: an amount is not a number until it is read. */
function readDocument(text: string): XmlNode {
  if (XMLValidator.validate(text) !== true) throw new Camt053UnreadableError('unreadable');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseAttributeValue: false,
    parseTagValue: false,
    removeNSPrefix: true,
    trimValues: true,
    isArray: (name) => name === 'Stmt' || name === 'Ntry' || name === 'TxDtls' || name === 'Ustrd',
  });
  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch {
    throw new Camt053UnreadableError('unreadable');
  }
  const document = asNode(parsed);
  if (!document) throw new Camt053UnreadableError('not_camt053');
  return document;
}

function asNode(value: unknown): XmlNode | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as XmlNode) : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A leaf's text: a bare string, or the `#text` of a node that carries attributes (`Amt Ccy`). */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  const text = asNode(value)?.['#text'];
  if (typeof text === 'string') return text.trim() || undefined;
  return typeof text === 'number' ? String(text) : undefined;
}

/** The text at a path of single children (`Acct/Id/IBAN`). */
function pathText(node: XmlNode | undefined, ...path: string[]): string | undefined {
  let current: unknown = node;
  for (const name of path) {
    const next = asNode(current);
    if (!next) return undefined;
    current = next[name];
  }
  return textOf(current);
}

/** The first non-empty text among the paths (a bank writes `Cd` or `Prtry`, `Dt` or `DtTm`). */
function firstText(node: XmlNode | undefined, paths: string[][]): string | undefined {
  for (const path of paths) {
    const text = pathText(node, ...path);
    if (text !== undefined) return text;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Statements and entries
// ---------------------------------------------------------------------------------------------

interface CamtDetail {
  acctSvcrRef?: string;
  additionalInfo?: string;
  amount?: string;
  counterparty?: string;
  creditDebit?: string;
  currency?: string;
  line: number;
  remittance?: string;
}

interface CamtEntry {
  acctSvcrRef?: string;
  additionalInfo?: string;
  amount?: string;
  bookingDate?: string;
  creditDebit?: string;
  currency?: string;
  details: CamtDetail[];
  line: number;
  ntryRef?: string;
  status?: string;
  valueDate?: string;
}

interface CamtStatement {
  currency?: string;
  entries: CamtEntry[];
  iban?: string;
  otherId?: string;
}

/** The lines of the `Ntry` and `TxDtls` elements, in document order: the row numbers the person can find. */
function elementLines(text: string): { entries: number[]; details: number[] } {
  const entries: number[] = [];
  const details: number[] = [];
  let line = 1;
  let scanned = 0;
  for (const match of text.matchAll(/<(?:[A-Za-z0-9_.-]+:)?(Ntry|TxDtls)(?=[\s/>])/g)) {
    const index = match.index ?? 0;
    for (let position = scanned; position < index; position++) if (text[position] === '\n') line++;
    scanned = index;
    if (match[1] === 'Ntry') entries.push(line);
    else details.push(line);
  }
  return { entries, details };
}

function readStatements(document: XmlNode, text: string): CamtStatement[] {
  const root = asNode(document['Document']) ?? document;
  const wrapper = asNode(root['BkToCstmrStmt']);
  if (!wrapper) return [];
  const lines = elementLines(text);
  const statements: CamtStatement[] = [];
  let entryIndex = 0;
  const detailCursor = { index: 0 };
  for (const raw of asArray(wrapper['Stmt'])) {
    const node = asNode(raw);
    if (!node) continue;
    const statement: CamtStatement = { entries: [] };
    const iban = pathText(node, 'Acct', 'Id', 'IBAN');
    const otherId = pathText(node, 'Acct', 'Id', 'Othr', 'Id');
    if (iban) statement.iban = iban.replace(/\s+/g, '').toUpperCase();
    if (otherId) statement.otherId = otherId;
    const currency = normalizeCurrency(pathText(node, 'Acct', 'Ccy'));
    if (currency) statement.currency = currency;
    for (const rawEntry of asArray(node['Ntry'])) {
      const entryNode = asNode(rawEntry);
      const entryLine = lines.entries[entryIndex] ?? 1;
      entryIndex += 1;
      if (!entryNode) continue;
      statement.entries.push(readEntry(entryNode, entryLine, lines.details, detailCursor));
    }
    statements.push(statement);
  }
  return statements;
}

function readEntry(node: XmlNode, line: number, detailLines: number[], detailCursor: { index: number }): CamtEntry {
  const entry: CamtEntry = { details: [], line };
  const acctSvcrRef = pathText(node, 'AcctSvcrRef');
  if (acctSvcrRef) entry.acctSvcrRef = acctSvcrRef;
  const ntryRef = pathText(node, 'NtryRef');
  if (ntryRef) entry.ntryRef = ntryRef;
  const amount = readAmount(node['Amt']);
  if (amount) entry.amount = amount.value;
  if (amount?.currency) entry.currency = amount.currency;
  const creditDebit = pathText(node, 'CdtDbtInd');
  if (creditDebit) entry.creditDebit = creditDebit.toUpperCase();
  const status = firstText(node, [['Sts', 'Cd'], ['Sts', 'Prtry'], ['Sts']]);
  if (status) entry.status = status.toUpperCase();
  const bookingDate = firstText(node, [['BookgDt', 'Dt'], ['BookgDt', 'DtTm']]);
  if (bookingDate) entry.bookingDate = bookingDate;
  const valueDate = firstText(node, [['ValDt', 'Dt'], ['ValDt', 'DtTm']]);
  if (valueDate) entry.valueDate = valueDate;
  const additionalInfo = firstText(node, [['AddtlNtryInf'], ['NtryDtls', 'AddtlNtryInf']]);
  if (additionalInfo) entry.additionalInfo = additionalInfo;

  for (const rawDetail of asArray(pathTextNode(node, 'NtryDtls', 'TxDtls'))) {
    const detailLine = detailLines[detailCursor.index] ?? line;
    detailCursor.index += 1;
    const detailNode = asNode(rawDetail);
    if (!detailNode) continue;
    entry.details.push(readDetail(detailNode, detailLine));
  }
  return entry;
}

/** The children at a path, as the array `isArray` makes of `TxDtls` (one `NtryDtls` holds them). */
function pathTextNode(node: XmlNode, name: string, child: string): unknown[] {
  const holders = asArray(node[name]);
  return holders.flatMap((holder) => asArray(asNode(holder)?.[child]));
}

function readDetail(node: XmlNode, line: number): CamtDetail {
  const detail: CamtDetail = { line };
  const acctSvcrRef = pathText(node, 'Refs', 'AcctSvcrRef');
  if (acctSvcrRef) detail.acctSvcrRef = acctSvcrRef;
  const amount = readAmount(node['Amt']);
  if (amount) detail.amount = amount.value;
  if (amount?.currency) detail.currency = amount.currency;
  const creditDebit = pathText(node, 'CdtDbtInd');
  if (creditDebit) detail.creditDebit = creditDebit.toUpperCase();
  const counterparty = readCounterparty(node);
  if (counterparty) detail.counterparty = counterparty;
  const remittance = readRemittance(node);
  if (remittance) detail.remittance = remittance;
  const additionalInfo = pathText(node, 'AddtlTxInf');
  if (additionalInfo) detail.additionalInfo = additionalInfo;
  return detail;
}

/**
 * The other party's name: `Cdtr` for money out and `Dbtr` for money in, each either directly
 * (`Cdtr/Nm`) or through the party choice (`Cdtr/Pty/Nm`), with the other side as the fallback.
 */
function readCounterparty(node: XmlNode): string | undefined {
  const parties = asNode(node['RltdPties']);
  if (!parties) return undefined;
  const nameOf = (side: string) => firstText(parties, [[side, 'Nm'], [side, 'Pty', 'Nm']]);
  const out = node['CdtDbtInd'] !== undefined ? textOf(node['CdtDbtInd'])?.toUpperCase() === 'DBIT' : undefined;
  const creditor = nameOf('Cdtr');
  const debtor = nameOf('Dbtr');
  if (out === true) return creditor ?? debtor;
  if (out === false) return debtor ?? creditor;
  return creditor ?? debtor;
}

/** The unstructured remittance lines, joined; a structured remittance falls back to its reference. */
function readRemittance(node: XmlNode): string | undefined {
  const remittance = asNode(node['RmtInf']);
  if (!remittance) return undefined;
  const lines = asArray(remittance['Ustrd']).flatMap((line) => {
    const text = textOf(line);
    return text ? [text] : [];
  });
  if (lines.length > 0) return lines.join(' ');
  return pathText(remittance, 'Strd', 'CdtrRefInf', 'Ref');
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

interface StatementGroup {
  currency?: string;
  label: string;
  statements: CamtStatement[];
}

interface RowDraft {
  additionalInfo?: string;
  amount?: number;
  currency?: string;
  date?: Date;
  idCandidate?: string;
  merchant?: string;
  raw: Record<string, unknown>;
  remittance?: string;
  sourceRow: number;
}

function buildResult(statements: CamtStatement[]): ImportParseResult {
  const groups = groupStatements(statements);
  const multiple = groups.length > 1;
  const rows: ParsedImportRow[] = [];
  const sourceAccounts: ImportSourceAccount[] = [];
  const warnings: ImportWarning[] = [];
  for (const group of groups) {
    const drafts: RowDraft[] = [];
    for (const statement of group.statements) {
      for (const entry of statement.entries) {
        if (entry.status !== undefined && entry.status !== 'BOOK') {
          warnings.push({ code: 'entry_not_booked', detail: entry.status, sourceRow: entry.line });
          continue;
        }
        drafts.push(...draftsOf(entry, group.currency));
      }
    }
    const groupRows = rowsOf(drafts, multiple ? group.label : undefined);
    rows.push(...groupRows);
    if (multiple) sourceAccounts.push({ ...(group.currency ? { currency: group.currency } : {}), label: group.label, rowCount: groupRows.length });
  }
  return { rows, sourceAccounts, warnings };
}

/** Statements of the same account (two periods in one file) are one source account. */
function groupStatements(statements: CamtStatement[]): StatementGroup[] {
  const groups = new Map<string, StatementGroup>();
  let anonymous = 0;
  for (const statement of statements) {
    const key = statement.iban ? `iban:${statement.iban}` : statement.otherId ? `id:${statement.otherId}` : `anonymous:${anonymous++}`;
    const existing = groups.get(key);
    if (existing) {
      existing.statements.push(statement);
      existing.currency ??= statement.currency;
    } else {
      groups.set(key, {
        currency: statement.currency,
        label: statement.iban ?? statement.otherId ?? `Account ${groups.size + 1}`,
        statements: [statement],
      });
    }
  }
  return [...groups.values()];
}

/** One entry, as its details when they add up, else as itself. */
function draftsOf(entry: CamtEntry, statementCurrency: string | undefined): RowDraft[] {
  const date = parseCamtDate(entry.bookingDate ?? entry.valueDate);
  const amount = parseCamtAmount(entry.amount ?? '');
  if (!date || amount === undefined) return [{ raw: rawOf(entry, undefined), sourceRow: entry.line }];
  const signed = signOf(amount, entry.creditDebit);
  const currency = entry.currency ?? statementCurrency;
  const details = splitDetails(entry, signed);
  if (details) {
    return details.map((detail) => ({
      amount: detail.signedAmount,
      currency: detail.currency ?? currency,
      date,
      idCandidate: detail.acctSvcrRef,
      merchant: clean(detail.counterparty, 255),
      raw: rawOf(entry, detail),
      remittance: detail.remittance ?? detail.additionalInfo,
      sourceRow: detail.line,
    }));
  }
  const first = entry.details[0];
  return [
    {
      amount: signed,
      currency,
      date,
      idCandidate: entry.acctSvcrRef ?? entry.ntryRef,
      merchant: clean(first?.counterparty, 255),
      raw: rawOf(entry, first),
      remittance: first?.remittance ?? first?.additionalInfo ?? entry.additionalInfo,
      sourceRow: entry.line,
    },
  ];
}

/** A detail with its signed amount, ready to be a row of its own. */
interface SignedDetail extends CamtDetail {
  signedAmount: number;
}

/** The entry's details, signed, when there are several and they add up to the entry; else undefined. */
function splitDetails(entry: CamtEntry, entryAmount: number): SignedDetail[] | undefined {
  if (entry.details.length < 2) return undefined;
  const signed: SignedDetail[] = [];
  for (const detail of entry.details) {
    const amount = parseCamtAmount(detail.amount ?? '');
    if (amount === undefined) return undefined;
    signed.push({ ...detail, signedAmount: signOf(amount, detail.creditDebit ?? entry.creditDebit) });
  }
  const total = signed.reduce((sum, detail) => sum + detail.signedAmount, 0);
  return Math.abs(total - entryAmount) > 0.005 ? undefined : signed;
}

function rowsOf(drafts: RowDraft[], label: string | undefined): ParsedImportRow[] {
  const candidates = new Map<string, number>();
  for (const draft of drafts) if (draft.idCandidate) candidates.set(draft.idCandidate, (candidates.get(draft.idCandidate) ?? 0) + 1);
  const occurrences = new Map<string, number>();
  return drafts.map((draft) => {
    if (!draft.date || draft.amount === undefined) return { error: draft.date ? 'Unreadable amount' : 'Unreadable date', raw: draft.raw, sourceRow: draft.sourceRow };
    const merchant = draft.merchant;
    const description = truncate(clean(draft.remittance, 500) ?? merchant ?? draft.additionalInfo ?? (draft.amount < 0 ? 'Payment' : 'Deposit'), 500);
    const trusted = draft.idCandidate !== undefined && candidates.get(draft.idCandidate) === 1;
    let externalId: string;
    if (trusted) {
      externalId = `camt:${draft.idCandidate!.slice(0, 240)}`;
    } else {
      const key = `${draft.date.toISOString().slice(0, 10)}|${draft.amount.toFixed(2)}`;
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      externalId = `camt053-fp:${key}|${occurrence}`;
    }
    const normalized: NormalizedImportRow = {
      amount: draft.amount,
      date: draft.date.toISOString(),
      description,
      externalId,
      externalIdTrusted: trusted,
      ...(draft.currency ? { currency: draft.currency } : {}),
      ...(merchant ? { merchant } : {}),
      ...(label ? { sourceAccountLabel: label } : {}),
    };
    return { normalized, raw: draft.raw, sourceRow: draft.sourceRow };
  });
}

function rawOf(entry: CamtEntry, detail: CamtDetail | undefined): Record<string, unknown> {
  return {
    acctSvcrRef: detail?.acctSvcrRef ?? entry.acctSvcrRef ?? '',
    amount: detail?.amount ?? entry.amount ?? '',
    creditDebit: detail?.creditDebit ?? entry.creditDebit ?? '',
    currency: detail?.currency ?? entry.currency ?? '',
    date: entry.bookingDate ?? entry.valueDate ?? '',
    description: detail?.remittance ?? detail?.additionalInfo ?? entry.additionalInfo ?? '',
    merchant: detail?.counterparty ?? '',
    ntryRef: entry.ntryRef ?? '',
  };
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// ---------------------------------------------------------------------------------------------
// Amounts and dates
// ---------------------------------------------------------------------------------------------

/** `Amt` with its `Ccy` attribute; the value keeps its own sign, which `CdtDbtInd` then states. */
function readAmount(value: unknown): { currency?: string; value: string } | undefined {
  const text = textOf(value);
  if (text === undefined) return undefined;
  const currency = normalizeCurrency(textOf(asNode(value)?.['@_Ccy']));
  return { ...(currency ? { currency } : {}), value: text };
}

/** The entry states the direction; an amount that already carries a sign keeps it when it states none. */
function signOf(amount: number, creditDebit: string | undefined): number {
  if (creditDebit === 'DBIT') return -Math.abs(amount);
  if (creditDebit === 'CRDT') return Math.abs(amount);
  return amount;
}

/** ISO 20022 writes a decimal point; a comma decimal separator is tolerated for banks that break the spec. */
function parseCamtAmount(value: string): number | undefined {
  let text = value.trim().replace(/\s+/g, '');
  if (text === '') return undefined;
  text = text.includes(',') && !text.includes('.') ? text.replace(',', '.') : text.replace(/,/g, '');
  const amount = Number(text);
  if (!Number.isFinite(amount)) return undefined;
  const rounded = Math.round(amount * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** `Dt` is `YYYY-MM-DD`; `DtTm` adds a time and a zone. The calendar day is the date. */
function parseCamtDate(value: string | undefined): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? '');
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date;
}

function normalizeCurrency(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  return code !== undefined && /^[A-Z]{3}$/.test(code) ? code : undefined;
}

/**
 * An IBAN as the account-mapping suggestion compares it: no spaces, upper case. Undefined when
 * the text is not an IBAN (two country letters, two check digits, then 11 to 30 alphanumerics).
 */
export function normalizeIban(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, '').toUpperCase();
  return text !== undefined && /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(text) ? text : undefined;
}

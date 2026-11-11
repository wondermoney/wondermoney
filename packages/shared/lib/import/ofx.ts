import type { ImportAdapter, ImportParseResult, ImportSourceAccount, ImportWarning, NormalizedImportRow, ParsedImportRow } from './types';

/**
 * OFX/QFX (Open Financial Exchange) statement reader, for the staged import session.
 *
 * It reads both OFX 1.x (SGML, where aggregate tags may never close) and OFX 2.x (XML), and
 * decodes the file by the header's `ENCODING`/`CHARSET` (or the XML declaration), including
 * Windows-1252 and ISO-8859-1. Every `STMTTRN` becomes a row: `DTPOSTED` is the date, `TRNAMT`
 * the signed amount, `NAME`/`PAYEE` the merchant, `MEMO` the description and `FITID` the id.
 *
 * A `FITID` is trusted only when it is non-empty and unique inside its statement. Empty or
 * repeated ids fall back to a date+amount fingerprint, marked `externalIdTrusted: false` so the
 * commit stores it as a fingerprint and not as a provider's unique id. Each `STMTRS`/`CCSTMTRS`
 * block is a source account labelled by `ACCTID`; a file with more than one asks for a mapping.
 * Balance-only statements and investment statements (`INVSTMTRS`) are skipped with a warning.
 */

export interface OfxAdapterOptions {
  /** The currency of a row whose statement names none: the target account's. Unused: a row with no currency takes the account's. */
  accountCurrency?: string;
}

/** The file is not an OFX document at all. */
export class OfxUnreadableError extends Error {
  constructor(readonly code: 'not_ofx' | 'unreadable' = 'unreadable') {
    super(code === 'not_ofx' ? 'This file is not an OFX document' : 'Could not read the OFX file');
    this.name = 'OfxUnreadableError';
  }
}

/** Whether the bytes look like an OFX document (either version), by its header or first element. */
export function isOfxFile(input: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(input.subarray(0, 4096));
  return /(?:^|\n)\s*OFXHEADER\s*:/i.test(head) || /<\?OFX[\s>]/i.test(head) || /<OFX[\s>]/i.test(head);
}

export const ofxImportAdapter: ImportAdapter<OfxAdapterOptions> = {
  format: 'ofx',
  async parse(input) {
    const body = extractBody(decodeOfx(input));
    const tokens = tokenize(body);
    if (tokens.length === 0) throw new OfxUnreadableError('unreadable');
    const { statements, warnings } = scan(tokens);
    return buildResult(statements, warnings);
  },
};

// ---------------------------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------------------------

function decodeOfx(input: Uint8Array): string {
  const bytes = stripBom(input);
  const label = headerCharset(new TextDecoder('latin1').decode(bytes.subarray(0, 4096)));
  if (label) return new TextDecoder(label).decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function stripBom(input: Uint8Array): Uint8Array {
  return input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
}

/**
 * The charset the file declares: the OFX 1.x `ENCODING`/`CHARSET` header fields, or the OFX 2.x
 * XML declaration / `<?OFX?>` processing instruction. Undefined when it declares none.
 */
function headerCharset(header: string): string | undefined {
  const fields = new Map<string, string>();
  for (const line of header.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*:\s*(.*?)\s*$/.exec(line);
    if (match) fields.set(match[1]!.toUpperCase(), match[2]!);
  }
  const xmlEncoding = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(header)?.[1];
  const ofxPi = /<\?OFX([^>]*)>/i.exec(header)?.[1] ?? '';
  const piField = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(ofxPi)?.[1];
  return charsetLabel(fields.get('ENCODING') ?? piField('ENCODING'), fields.get('CHARSET') ?? piField('CHARSET') ?? xmlEncoding);
}

function charsetLabel(encoding: string | undefined, charset: string | undefined): string | undefined {
  const enc = encoding?.trim().toUpperCase();
  const cs = charset?.trim().toUpperCase();
  if (enc === 'UTF-8' || enc === 'UTF8' || cs === 'UTF-8' || cs === 'UTF8') return 'utf-8';
  if (enc === 'UNICODE') return 'utf-8';
  if (cs) {
    if (cs === '1252' || cs === 'CP1252' || cs === 'WINDOWS-1252') return 'windows-1252';
    if (cs === '8859-1' || cs === 'ISO-8859-1' || cs === 'ISO8859-1' || cs === 'LATIN1' || cs === 'LATIN-1') return 'iso-8859-1';
    if (cs === 'UTF-16' || cs === 'UTF16') return 'utf-16le';
    // Windows code pages 1250..1258 are all TextDecoder labels.
    if (/^\d+$/.test(cs)) return `windows-${cs}`;
    if (cs === 'NONE' || cs === 'USASCII' || cs === 'ASCII') return 'us-ascii';
    if (/^[A-Z0-9-]+$/.test(cs)) return cs.toLowerCase();
  }
  if (enc === 'USASCII' || enc === 'ASCII') return 'us-ascii';
  return undefined;
}

/** The document from its `<OFX>` element on, without comments, processing instructions or doctype. */
function extractBody(text: string): string {
  const index = text.search(/<OFX[\s>]/i);
  if (index < 0) throw new OfxUnreadableError('not_ofx');
  return text
    .slice(index)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
}

// ---------------------------------------------------------------------------------------------
// Tokenizing
// ---------------------------------------------------------------------------------------------

interface OfxToken {
  closing: boolean;
  /** The line in the file the tag starts on, 1-based. */
  line: number;
  name: string;
  selfClosing: boolean;
  /** The text after the tag and before the next one: a leaf's value, or whitespace. */
  value: string;
}

const TAG_PATTERN = /<\s*(\/?)\s*([A-Za-z0-9_.:-]+)((?:\s+[^<>]*?)?)\s*(\/?)\s*>/g;

/**
 * One pass over the document. SGML leaves values unclosed (`<NAME>CONTINENTE`), XML closes them
 * (`<NAME>CONTINENTE</NAME>`); either way a tag's value is the text up to the next tag, so the
 * scanner below can treat both versions the same.
 */
function tokenize(body: string): OfxToken[] {
  const tokens: OfxToken[] = [];
  let lastToken: OfxToken | undefined;
  let valueStart = 0;
  let line = 1;
  for (const match of body.matchAll(TAG_PATTERN)) {
    const index = match.index ?? 0;
    const before = body.slice(valueStart, index);
    if (lastToken && !lastToken.closing && !lastToken.selfClosing) lastToken.value = decodeEntities(before.trim());
    line += countNewlines(before);
    const token: OfxToken = {
      closing: match[1] === '/',
      line,
      name: (match[2] ?? '').toUpperCase(),
      selfClosing: match[4] === '/',
      value: '',
    };
    tokens.push(token);
    lastToken = token;
    valueStart = index + match[0].length;
  }
  if (lastToken && !lastToken.closing && !lastToken.selfClosing) lastToken.value = decodeEntities(body.slice(valueStart).trim());
  return tokens;
}

/** XML escapes its values; SGML files may carry the same entities, and decoding them is harmless. */
function decodeEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, name: string) => {
    switch (name.toLowerCase()) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const code = name.startsWith('#x') || name.startsWith('#X') ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
      }
    }
  });
}

function countNewlines(value: string): number {
  let count = 0;
  for (const char of value) if (char === '\n') count++;
  return count;
}

// ---------------------------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------------------------

interface OfxTransaction {
  amount?: string;
  datePosted?: string;
  fitId?: string;
  line: number;
  memo?: string;
  name?: string;
  type?: string;
}

interface OfxStatement {
  accountId?: string;
  currency?: string;
  hasBalance: boolean;
  investment: boolean;
  line: number;
  transactions: OfxTransaction[];
}

function scan(tokens: OfxToken[]): { statements: OfxStatement[]; warnings: ImportWarning[] } {
  const statements: OfxStatement[] = [];
  const warnings: ImportWarning[] = [];
  let current: OfxStatement | undefined;
  let transaction: OfxTransaction | undefined;

  const finishTransaction = () => {
    if (!transaction) return;
    if (current && !current.investment) current.transactions.push(transaction);
    transaction = undefined;
  };
  const finishStatement = () => {
    if (!current) return;
    finishTransaction();
    if (current.investment) {
      warnings.push({ code: 'investment_statement_skipped', detail: current.accountId ?? 'INVSTMTRS', sourceRow: current.line });
      statements.push(current);
    } else if (current.transactions.length === 0) {
      if (current.hasBalance) warnings.push({ code: 'balance_only', detail: current.accountId ?? 'statement', sourceRow: current.line });
    } else {
      statements.push(current);
    }
    current = undefined;
  };
  const startStatement = (line: number, investment: boolean) => {
    finishStatement();
    current = { hasBalance: false, investment, line, transactions: [] };
  };

  for (const token of tokens) {
    const { name } = token;
    if (token.closing) {
      if (name === 'STMTRS' || name === 'CCSTMTRS' || name === 'INVSTMTRS') finishStatement();
      else if (name === 'STMTTRN') finishTransaction();
      else if (name === 'STMTTRNRS' || name === 'CCSTMTTRNRS' || name === 'INVSTMTTRNRS') finishStatement();
      continue;
    }
    switch (name) {
      case 'STMTRS':
      case 'CCSTMTRS':
        startStatement(token.line, false);
        break;
      case 'INVSTMTRS':
        startStatement(token.line, true);
        break;
      case 'STMTTRNRS':
      case 'CCSTMTTRNRS':
      case 'INVSTMTTRNRS':
        finishStatement();
        break;
      case 'STMTTRN':
        if (current && !current.investment) {
          finishTransaction();
          transaction = { line: token.line };
        }
        break;
      case 'ACCTID':
        if (current && current.accountId === undefined) current.accountId = token.value;
        break;
      case 'CURDEF':
        if (current) current.currency = token.value;
        break;
      case 'LEDGERBAL':
      case 'AVAILBAL':
      case 'BALAMT':
        if (current) current.hasBalance = true;
        break;
      case 'DTPOSTED':
        if (transaction) transaction.datePosted = token.value;
        break;
      case 'TRNAMT':
        if (transaction) transaction.amount = token.value;
        break;
      case 'FITID':
        if (transaction) transaction.fitId = token.value;
        break;
      case 'NAME':
        if (transaction) transaction.name = token.value;
        break;
      case 'MEMO':
        if (transaction) transaction.memo = token.value;
        break;
      case 'TRNTYPE':
        if (transaction) transaction.type = token.value;
        break;
      default:
        break;
    }
  }
  finishStatement();
  return { statements, warnings };
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

interface StatementGroup {
  accountId?: string;
  currency?: string;
  label: string;
  transactions: OfxTransaction[];
}

function buildResult(statements: OfxStatement[], warnings: ImportWarning[]): ImportParseResult {
  const groups = groupStatements(statements.filter((statement) => !statement.investment));
  const multiple = groups.length > 1;
  const rows: ParsedImportRow[] = [];
  const sourceAccounts: ImportSourceAccount[] = [];
  for (const group of groups) {
    const fitIds = new Map<string, number>();
    for (const transaction of group.transactions) {
      const fitId = transaction.fitId?.trim();
      if (fitId) fitIds.set(fitId, (fitIds.get(fitId) ?? 0) + 1);
    }
    const occurrences = new Map<string, number>();
    const groupRows = group.transactions.map((transaction) => rowFor(transaction, { currency: group.currency, fitIds, label: multiple ? group.label : undefined, occurrences }));
    rows.push(...groupRows);
    if (multiple) sourceAccounts.push({ ...(group.currency ? { currency: group.currency } : {}), label: group.label, rowCount: groupRows.length });
  }
  return { rows, sourceAccounts, warnings };
}

/** Statements of the same account (two periods in one file) are one source account. */
function groupStatements(statements: OfxStatement[]): StatementGroup[] {
  const groups = new Map<string, StatementGroup>();
  let anonymous = 0;
  for (const statement of statements) {
    const accountId = statement.accountId?.trim();
    const key = accountId ? `id:${accountId}` : `anonymous:${anonymous++}`;
    const existing = groups.get(key);
    if (existing) {
      existing.transactions.push(...statement.transactions);
      if (existing.currency === undefined) existing.currency = normalizeCurrency(statement.currency);
    } else {
      groups.set(key, {
        accountId,
        currency: normalizeCurrency(statement.currency),
        label: accountId || `Account ${groups.size + 1}`,
        transactions: [...statement.transactions],
      });
    }
  }
  return [...groups.values()];
}

interface RowContext {
  currency?: string;
  fitIds: Map<string, number>;
  label?: string;
  occurrences: Map<string, number>;
}

function rowFor(transaction: OfxTransaction, context: RowContext): ParsedImportRow {
  const raw = {
    amount: transaction.amount ?? '',
    date: transaction.datePosted ?? '',
    description: transaction.memo ?? '',
    fitid: transaction.fitId ?? '',
    merchant: transaction.name ?? '',
    type: transaction.type ?? '',
  };
  const date = parseOfxDate(transaction.datePosted ?? '');
  const amount = parseOfxAmount(transaction.amount ?? '');
  if (!date) return { error: 'Unreadable date', raw, sourceRow: transaction.line };
  if (amount === undefined) return { error: 'Unreadable amount', raw, sourceRow: transaction.line };

  const merchant = clean(transaction.name, 255);
  const description = clean(transaction.memo, 500) ?? merchant ?? clean(transaction.type, 50) ?? (amount < 0 ? 'Payment' : 'Deposit');
  const fitId = transaction.fitId?.trim();
  const trusted = fitId !== undefined && fitId !== '' && context.fitIds.get(fitId) === 1;
  let externalId: string;
  if (trusted) {
    externalId = `fitid:${fitId.slice(0, 240)}`;
  } else {
    const key = `${date.toISOString().slice(0, 10)}|${amount.toFixed(2)}`;
    const occurrence = context.occurrences.get(key) ?? 0;
    context.occurrences.set(key, occurrence + 1);
    externalId = `ofx-fp:${key}|${occurrence}`;
  }
  const normalized: NormalizedImportRow = {
    amount,
    date: date.toISOString(),
    description,
    externalId,
    externalIdTrusted: trusted,
    ...(context.currency ? { currency: context.currency } : {}),
    ...(merchant ? { merchant } : {}),
    ...(context.label ? { sourceAccountLabel: context.label } : {}),
  };
  return { normalized, raw, sourceRow: transaction.line };
}

function clean(value: string | undefined, maxLength: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, maxLength) : undefined;
}

/** `YYYYMMDD`, optionally followed by a time and a timezone: the local posting date is the date. */
function parseOfxDate(value: string): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date;
}

/** OFX writes a decimal point; a comma decimal separator is tolerated for banks that break the spec. */
function parseOfxAmount(value: string): number | undefined {
  let text = value.trim().replace(/\s+/g, '');
  if (text === '') return undefined;
  text = text.includes(',') && !text.includes('.') ? text.replace(',', '.') : text.replace(/,/g, '');
  const amount = Number(text);
  if (!Number.isFinite(amount)) return undefined;
  const rounded = Math.round(amount * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeCurrency(value: string | undefined): string | undefined {
  const code = value?.trim().toUpperCase();
  return code !== undefined && /^[A-Z]{3}$/.test(code) ? code : undefined;
}

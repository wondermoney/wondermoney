#!/usr/bin/env node
// Refresh script for src/lib/calculators/data/savingsCertificatesRate.ts, the default base rate of the
// Certificados de Aforro Série F calculator.
//
// Source: IGCP, the Portuguese debt agency that issues the certificates. On the third-to-last business
// day of each month it sets the Série F base rate for the next month (ficha técnica: E3, the 3-month
// Euribor average of the previous 10 business days, within 0% to 2.50%) and publishes a notice,
// "Taxas de Juro dos Certificados de Aforro das Séries A, B, D, E e F em <mês> de <ano>", whose summary
// reads "A taxa de juro bruta para novas subscrições de Certificados de Aforro, Série F, em <mês> de
// <ano> foi fixada em 2,500%". A new subscription has no permanence premium in its first year, so that
// gross rate is the base rate. The notices are server-rendered HTML on igcp.pt; no API exists.
//
// The script searches IGCP's news list for those notices, takes the newest month, reads its notice and
// checks it before writing: the month in the list, the notice's title and its summary agree, the rate
// is within the 0% to 2.50% band with at most three decimals, and the month is the fetch month or the
// next one (an older newest notice means IGCP stopped publishing or changed its pages). Any failure
// throws before the file is touched, so the committed rate stays.
//
// Usage, from apps/landing (needs network; Node 18+ for fetch):
//
//   node scripts/build-savings-certificates-rate.mjs [--date YYYY-MM-DD]
//
// --date sets the fetch date (defaults to today, UTC). Run monthly by
// .github/workflows/landing-data-refresh.yml with the market-data set.

import { renameSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ORIGIN = "https://www.igcp.pt";
export const NOTICE_TITLE = "Taxas de Juro dos Certificados de Aforro";
export const LIST_URL = `${ORIGIN}/pt/noticias?title=${encodeURIComponent(NOTICE_TITLE)}`;
export const USER_AGENT = "WonderMoney-landing-build/1.0 (+https://github.com/wondermoney/wondermoney)";
/** The ceiling of the base rate in the ficha técnica, in percent. */
export const MAX_BASE_RATE = 2.5;

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const MONTH_PATTERN = MONTHS.join("|");
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** "novembro", "2026" to "2026-11"; throws on a name that is not a Portuguese month. */
function monthKey(name, year) {
  const index = MONTHS.indexOf(name.toLowerCase());
  if (index === -1) throw new Error(`IGCP: unknown month "${name}"`);
  return `${year}-${String(index + 1).padStart(2, "0")}`;
}

/** Tags out, entities decoded, whitespace collapsed. */
export function textOf(html) {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

/** The month a notice title names: "... em novembro de 2026" or "... em outubro 2026". */
export function titleMonth(title) {
  if (!title.startsWith(NOTICE_TITLE)) return null;
  const match = new RegExp(`\\bem (${MONTH_PATTERN}) (?:de )?(\\d{4})$`, "i").exec(title);
  return match ? monthKey(match[1], match[2]) : null;
}

/** IGCP's news list to the rate notices it links, as [{ url, title, month }], in page order. */
export function parseNoticeList(html) {
  const notices = [];
  for (const match of String(html).matchAll(/<a href="(\/pt\/noticias\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const title = textOf(match[2]);
    const month = titleMonth(title);
    if (month !== null) notices.push({ url: `${ORIGIN}${match[1]}`, title, month });
  }
  if (notices.length === 0) throw new Error("IGCP: the news list has no Série F rate notice");
  return notices;
}

/** The notice of the newest month in the list. */
export function latestNotice(notices) {
  return notices.reduce((latest, notice) => (notice.month > latest.month ? notice : latest));
}

/**
 * A notice page to { month, rate, publishedOn }: the month from its title, the Série F rate and month
 * from its summary, and the date it was published or last updated. Throws when a part is missing or
 * the title and the summary name different months.
 */
export function parseNotice(html) {
  const page = String(html);
  const heading = /<h1[^>]*class="[^"]*page-title[^"]*"[^>]*>([\s\S]*?)<\/h1>/.exec(page);
  if (!heading) throw new Error("IGCP: the notice has no title");
  const month = titleMonth(textOf(heading[1]));
  if (month === null) throw new Error(`IGCP: the notice title "${textOf(heading[1])}" names no month`);

  // The summary under the title. The meta description and the related-news teasers repeat it, not always
  // with the right year, so only this field counts.
  const summary = /<div class="content_description">([\s\S]*?)<\/div>\s*<\/div>/.exec(page);
  if (!summary) throw new Error("IGCP: the notice has no summary");
  const sentence = new RegExp(
    `Série F, em (${MONTH_PATTERN}) (?:de )?(\\d{4}) foi fixada em (\\d+(?:,\\d+)?) ?%`, "i",
  ).exec(textOf(summary[1]));
  if (!sentence) throw new Error(`IGCP: no Série F rate in the summary "${textOf(summary[1])}"`);
  const summaryMonth = monthKey(sentence[1], sentence[2]);
  if (summaryMonth !== month) throw new Error(`IGCP: the title names ${month} but the summary ${summaryMonth}`);
  const decimals = sentence[3].split(",")[1] ?? "";
  if (decimals.length > 3) throw new Error(`IGCP: rate ${sentence[3]}% has more than three decimals`);
  const rate = Number(sentence[3].replace(",", "."));

  const date = new RegExp(`content_date">\\s*Informação atualizada em\\s*(\\d{1,2}) (${MONTH_PATTERN}) (\\d{4})`, "i").exec(page);
  if (!date) throw new Error("IGCP: the notice has no publication date");
  const publishedOn = `${monthKey(date[2], date[3])}-${date[1].padStart(2, "0")}`;
  return { month, rate, publishedOn };
}

const nextMonth = (month) => {
  const [year, m] = month.split("-").map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`;
};

/** Throws when the notice must not become the calculator default; returns it otherwise. */
export function checkRate(notice, { fetchedOn }) {
  const { month, rate, publishedOn } = notice;
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_BASE_RATE) {
    throw new Error(`IGCP: rate ${rate}% is outside the 0% to ${MAX_BASE_RATE}% band of the ficha técnica`);
  }
  const current = fetchedOn.slice(0, 7);
  if (month < current) throw new Error(`IGCP: the newest notice is for ${month}, before ${current}: stale`);
  if (month > nextMonth(current)) throw new Error(`IGCP: the newest notice is for ${month}, after ${nextMonth(current)}`);
  if (publishedOn > fetchedOn) throw new Error(`IGCP: the notice is dated ${publishedOn}, after the fetch date ${fetchedOn}`);
  return notice;
}

export function renderModule({ month, rate, publishedOn, url }, { fetchedOn }) {
  return `// Generated by scripts/build-savings-certificates-rate.mjs. Do not edit by hand: rerun the script.
//
// The Série F base rate IGCP fixed for one month: the gross rate for new subscriptions, which have no
// permanence premium in their first year. The calculator starts at this rate; the visitor can change it.

export const SAVINGS_CERTIFICATES_BASE_RATE = {
  /** Annual gross rate in percent, as IGCP fixes it (at most three decimals). */
  rate: ${rate},
  /** The month the rate applies to, YYYY-MM. */
  month: ${JSON.stringify(month)},
  /** IGCP's notice for that month. */
  source: ${JSON.stringify(url)},
  /** The date on IGCP's notice, YYYY-MM-DD. */
  publishedOn: ${JSON.stringify(publishedOn)},
  /** When this file was generated. */
  fetchedOn: ${JSON.stringify(fetchedOn)},
} as const;
`;
}

async function getText(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status} for ${url}`);
  return response.text();
}

export const OUT_FILE = fileURLToPath(new URL("../src/lib/calculators/data/savingsCertificatesRate.ts", import.meta.url));

/** Fetches, validates and writes (through a temporary file). Throws before writing on bad data. */
export async function refresh({ fetchImpl = fetch, fetchedOn = new Date().toISOString().slice(0, 10), out = OUT_FILE } = {}) {
  const listed = latestNotice(parseNoticeList(await getText(fetchImpl, LIST_URL)));
  const notice = parseNotice(await getText(fetchImpl, listed.url));
  if (notice.month !== listed.month) throw new Error(`IGCP: the list names ${listed.month} but the notice ${notice.month}`);
  const rate = { ...checkRate(notice, { fetchedOn }), url: listed.url };
  writeFileSync(`${out}.next`, renderModule(rate, { fetchedOn }));
  renameSync(`${out}.next`, out);
  return rate;
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--date");
  const fetchedOn = at === -1 ? new Date().toISOString().slice(0, 10) : args[at + 1];
  if (!isDate(fetchedOn)) throw new Error("--date must be YYYY-MM-DD");
  const rate = await refresh({ fetchedOn });
  console.log(`Wrote the Série F base rate for ${rate.month}, ${rate.rate}% (IGCP notice of ${rate.publishedOn}), to ${OUT_FILE}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

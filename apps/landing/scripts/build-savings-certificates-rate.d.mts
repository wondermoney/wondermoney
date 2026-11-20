export const ORIGIN: string;
export const NOTICE_TITLE: string;
export const LIST_URL: string;
export const USER_AGENT: string;
export const MAX_BASE_RATE: number;
export const OUT_FILE: string;

export interface ListedNotice {
  url: string;
  title: string;
  month: string;
}
export interface Notice {
  month: string;
  rate: number;
  publishedOn: string;
}
export interface BaseRate extends Notice {
  url: string;
}

export function textOf(html: string): string;
export function titleMonth(title: string): string | null;
export function parseNoticeList(html: string): ListedNotice[];
export function latestNotice(notices: readonly ListedNotice[]): ListedNotice;
export function parseNotice(html: string): Notice;
export function checkRate(notice: Notice, options: { fetchedOn: string }): Notice;
export function renderModule(rate: BaseRate, options: { fetchedOn: string }): string;
export function refresh(options?: {
  fetchImpl?: typeof fetch;
  fetchedOn?: string;
  out?: string;
}): Promise<BaseRate>;

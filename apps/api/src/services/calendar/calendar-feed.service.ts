import type { EntityManager } from '@mikro-orm/postgresql';

import type { Appuser } from '@entity/Appuser';
import { SupportedLanguages } from '@entity/Appuser';
import type { Tenant } from '@entity/Tenant';
import { loadRecurringSchedule } from '@service/recurring/recurring-schedule.service';

import { formatIcsDate, type IcsEvent, renderIcsCalendar } from './ics';

/** How far ahead the feed projects. Long enough to fill a year view, short enough to stay small. */
const CALENDAR_FEED_WINDOW_DAYS = 90;
/** Advertised to the client; calendar apps refresh on their own schedule regardless. */
const CALENDAR_FEED_REFRESH_INTERVAL_HOURS = 12;

const DAY_MS = 86_400_000;

export const CALENDAR_LOCALES = ['en', 'es', 'pt'] as const;
export type CalendarLocale = (typeof CALENDAR_LOCALES)[number];

/** European Portuguese, matching the web and the assistant, not Intl's Brazilian default. */
const FORMATTING_LOCALE: Readonly<Record<CalendarLocale, string>> = { en: 'en', es: 'es', pt: 'pt-PT' };

interface CalendarText {
  calendarDescription: string;
  calendarName: string;
  recurringPayment: string;
}

const CALENDAR_TEXT: Readonly<Record<CalendarLocale, CalendarText>> = {
  en: {
    calendarDescription: 'Upcoming bills from WonderMoney',
    calendarName: 'WonderMoney bills',
    recurringPayment: 'Recurring payment',
  },
  es: {
    calendarDescription: 'Próximos pagos recurrentes de WonderMoney',
    calendarName: 'Pagos de WonderMoney',
    recurringPayment: 'Pago recurrente',
  },
  pt: {
    calendarDescription: 'Próximos pagamentos recorrentes do WonderMoney',
    calendarName: 'Pagamentos do WonderMoney',
    recurringPayment: 'Pagamento recorrente',
  },
};

export interface BillsCalendarInput {
  appuser: Pick<Appuser, 'language'>;
  em?: EntityManager;
  /** Overrides the account language, so a link can follow the language the reader chose. */
  locale?: CalendarLocale;
  now?: Date;
  tenant: Pick<Tenant, 'tenantKey'>;
}

/**
 * The `text/calendar` body of a household member's upcoming bills.
 *
 * Every event is an all-day reminder with the series name and its expected amount. Account
 * names, balances and account numbers never enter the feed: the schedule carries a display name
 * and an amount, and nothing else.
 */
export async function buildBillsCalendarFeed(input: BillsCalendarInput): Promise<string> {
  const now = input.now ?? new Date();
  const from = startOfUtcDay(now);
  const to = new Date(from.getTime() + CALENDAR_FEED_WINDOW_DAYS * DAY_MS);
  const locale = input.locale ?? calendarLocaleFor(input.appuser);
  const text = CALENDAR_TEXT[locale];

  const entries = await loadRecurringSchedule({ em: input.em, from, tenantKey: input.tenant.tenantKey, to });

  const seen = new Set<string>();
  const events: IcsEvent[] = [];
  for (const entry of entries) {
    const uid = calendarEventUid(entry.seriesKey, entry.date);
    // A series can produce two entries on one day in a rare edge (an expected date and an
    // unmatched payment); a calendar needs unique UIDs, so the first one wins.
    if (seen.has(uid)) continue;
    seen.add(uid);

    const amount = formatCalendarAmount(entry.expectedAmount, entry.currency, locale);
    events.push({
      date: entry.date,
      description: amount ? `${text.recurringPayment}: ${amount}` : text.recurringPayment,
      summary: amount ? `${entry.name} - ${amount}` : entry.name,
      uid,
    });
  }

  return renderIcsCalendar({
    calendarName: text.calendarName,
    description: text.calendarDescription,
    events,
    now,
    refreshIntervalHours: CALENDAR_FEED_REFRESH_INTERVAL_HOURS,
  });
}

/** Stable per series and day, so a client updates an event instead of duplicating it. */
function calendarEventUid(seriesKey: number, date: Date): string {
  return `wm-bill-${seriesKey}-${formatIcsDate(date)}@wonder.money`;
}

/** The account language, which is the only locale the API knows without a hint. */
function calendarLocaleFor(appuser: Pick<Appuser, 'language'>): CalendarLocale {
  return appuser.language === SupportedLanguages.PT ? 'pt' : 'en';
}

/**
 * The amount in the reader's locale, or `null` when the series records none.
 *
 * An unknown or missing currency falls back to a plain decimal so a feed never fails to render
 * because of one odd series.
 */
function formatCalendarAmount(
  amount: null | number | undefined,
  currency: null | string | undefined,
  locale: CalendarLocale,
): null | string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return null;
  const formattingLocale = FORMATTING_LOCALE[locale];
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat(formattingLocale, { currency, style: 'currency' }).format(amount);
    } catch {
      // An unknown ISO code throws; fall through to the plain number.
    }
  }
  return new Intl.NumberFormat(formattingLocale, { maximumFractionDigits: 2 }).format(amount);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

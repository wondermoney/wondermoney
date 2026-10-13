const isCurrencyCode = (currency: string) => /^[A-Z]{3}$/.test(currency);

export const normalizeFinancialLocale = (locale?: string) =>
  locale === "pt" ? "pt-PT" : locale;

// `whitespace-nowrap tabular-nums` on every branch, not just the colour: this
// is the shared helper behind every balance figure in the app, and a money
// value that wraps reads as two numbers. `-€121.61` was splitting across two
// lines in a 59px cell on /accounts at 320px. `tabular-nums` additionally
// keeps digits in vertical alignment down a column, which is the whole point
// of setting figures in mono.
/**
 * How a money figure is laid out, everywhere.
 *
 * `font-mono` is load-bearing, not decoration. § 1 names the Sans/Mono split as
 * the product's signature, and § 9's "Declined, deliberately" table records the
 * founder decision to keep money in Geist Mono rather than follow the reference
 * into sans numerals — that only works with a face shipping true tabular
 * figures, which Geist Sans does not.
 *
 * It was missing here, so every one of `<Amount>`'s call sites rendered money in
 * the sans while `CellNumeric` and the report tables set mono themselves. Same
 * figure, two faces, depending on which component happened to draw it.
 */
export const FINANCIAL_VALUE_LAYOUT = "font-mono whitespace-nowrap tabular-nums";

/*
 * Three helpers, not one, because a money figure is one of three things and
 * only two of them earn colour. See DESIGN_HISTORY.md rule 2.
 *
 * There used to be a single `getFinancialValueClassName` that painted every
 * negative red and every positive green, wherever it appeared. The budget
 * month view is what that looks like at scale: eight green amounts stacked
 * above eight green "100%"s, none of which carry information, and no headroom
 * left to mark the one row that is actually over budget. When everything is
 * coloured, nothing is.
 *
 * The sign is what communicates direction. Colour is for the exception.
 */

/**
 * A **level** — a balance, a total, an amount held. Never coloured by sign: a
 * negative balance is an ordinary fact and the minus sign already says so.
 * Where the distinction matters the surface labels it in words anyway (the
 * net-worth rows carry "of assets" / "of debts" beside the figure), which
 * makes colour a third redundant cue rather than a first one.
 */
export const getAmountClassName = () =>
  `text-foreground ${FINANCIAL_VALUE_LAYOUT}`;

/**
 * A **delta** — a change measured against a baseline: unrealised gain against
 * cost, a day's move, a period-over-period difference. Direction is the whole
 * point of the number here, so colour is carrying meaning rather than
 * decorating. Still never colour alone; callers render the sign too.
 */
export const getDeltaClassName = (value: number) => {
  if (value < 0) return `text-destructive-text ${FINANCIAL_VALUE_LAYOUT}`;
  if (value > 0) return `text-success-text ${FINANCIAL_VALUE_LAYOUT}`;
  return `text-muted-foreground ${FINANCIAL_VALUE_LAYOUT}`;
};

/**
 * A **level that becomes exceptional past a threshold** — budget headroom that
 * has gone negative, savings that have. Only the breach is marked; the
 * ordinary side stays neutral, so red still means something when it appears.
 */
export const getThresholdClassName = (value: number) =>
  value < 0
    ? `text-destructive-text ${FINANCIAL_VALUE_LAYOUT}`
    : `text-foreground ${FINANCIAL_VALUE_LAYOUT}`;

const formatCurrencyValue = (
  val: number,
  currency: string = "EUR",
  locale?: string,
  options?: Intl.NumberFormatOptions,
) => {
  if (!isCurrencyCode(currency)) {
    return new Intl.NumberFormat(normalizeFinancialLocale(locale), {
      notation: "standard",
      maximumFractionDigits: 2,
      ...options,
    }).format(val);
  }

  return new Intl.NumberFormat(normalizeFinancialLocale(locale), {
    style: "currency",
    notation: "standard",
    maximumFractionDigits: 2,
    currency,
    ...options,
  }).format(val);
};

export const formatCurrency = (
  val: number,
  currency: string = "EUR",
  options?: Intl.NumberFormatOptions,
) => formatCurrencyValue(val, currency, undefined, options);

export const formatCurrencyForLocale = (
  val: number,
  currency: string,
  locale: string,
  options?: Intl.NumberFormatOptions,
) => formatCurrencyValue(val, currency, locale, options);

export const formatCurrencyForScreenReader = (
  val: number,
  currency: string,
  locale: string,
  options?: Intl.NumberFormatOptions,
) =>
  new Intl.NumberFormat(normalizeFinancialLocale(locale), {
    style: "currency",
    currency,
    currencyDisplay: "name",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    ...options,
  }).format(val);

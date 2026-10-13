type LocaleInput = string

type CurrencyOptions = {
  locale: LocaleInput
  currency: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

type NumberOptions = {
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

const assertLocale = (locale: LocaleInput) => {
  if (!locale || typeof locale !== 'string') {
    throw new Error('A locale is required.')
  }
}

const assertCurrency = (currency: string) => {
  if (!currency || typeof currency !== 'string') {
    throw new Error('A currency code is required.')
  }
}

const assertFiniteValue = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new Error('A finite value is required.')
  }
}

const formatValue = (
  value: number,
  locale: LocaleInput,
  options: Intl.NumberFormatOptions,
): string => new Intl.NumberFormat(locale, options).format(value)

const isZero = (value: number) => value === 0 || Object.is(value, -0)

const formatSignedValue = (
  value: number,
  locale: LocaleInput,
  options: Intl.NumberFormatOptions,
): string => {
  const formatted = formatValue(isZero(value) ? 0 : value, locale, options)

  if (isZero(value) || value < 0) {
    return formatted
  }

  return `+${formatted}`
}

export function formatCurrency(value: number, options: CurrencyOptions): string {
  assertLocale(options.locale)
  assertCurrency(options.currency)
  assertFiniteValue(value)

  return formatValue(value, options.locale, {
    style: 'currency',
    currency: options.currency,
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  })
}

export function formatPercent(value: number, locale: LocaleInput, options: NumberOptions = {}): string {
  assertLocale(locale)
  assertFiniteValue(value)

  return formatSignedValue(value, locale, {
    style: 'percent',
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  })
}

/** Formats API percentage-point values (for example, 12.4 means 12.4%). */
export function formatPercentagePoints(
  value: number,
  locale: LocaleInput,
  options: NumberOptions = {},
): string {
  assertFiniteValue(value)
  return formatPercent(value / 100, locale, options)
}

export function formatSignedNumber(
  value: number,
  locale: LocaleInput,
  options: NumberOptions = {},
): string {
  assertLocale(locale)
  assertFiniteValue(value)

  return formatSignedValue(value, locale, {
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  })
}

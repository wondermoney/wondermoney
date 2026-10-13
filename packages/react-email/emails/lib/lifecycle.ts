export interface LifecycleTrackingProps {
  destinationUrl?: string;
  nextPath?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  unsubscribeUrl?: string;
}

export type DisplayValue = string | number;

export function formatCurrencyMinorUnits(
  value: number,
  currency = "EUR",
): string {
  const formatter = new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const majorValue = value / 10 ** fractionDigits;

  if (currency === "EUR") {
    return `€${new Intl.NumberFormat("pt-PT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(majorValue)}`;
  }

  return formatter.format(majorValue);
}

export function formatCount(value: DisplayValue): string {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("pt-PT").format(value);
}

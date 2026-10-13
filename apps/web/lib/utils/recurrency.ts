export enum Recurrency {
  MONTHLY_14 = "MONTHLY_14",
  MONTHLY = "MONTHLY",
  QUARTERLY = "QUARTERLY",
  ANNUALLY = "ANNUALLY",
  BI_ANNUALLY = "BI_ANNUALLY",
}

export const convertRecurrencyIntoMonthsInYear = (
  recurrency: string,
): number => {
  switch (recurrency) {
    case "MONTHLY":
      return 12;
    case "MONTHLY_14":
      return 14;
    case "QUARTERLY":
      return 4;
    case "ANNUALLY":
      return 1;
    case "BI_ANNUALLY":
      return 2;
    default:
      return 1;
  }
};

export const convertRecurrencyMonthsIntoString = (
  recurrency: number,
): Recurrency => {
  switch (recurrency) {
    case 12:
      return Recurrency.MONTHLY;
    case 14:
      return Recurrency.MONTHLY_14;
    case 4:
      return Recurrency.QUARTERLY;
    case 1:
      return Recurrency.ANNUALLY;
    case 2:
      return Recurrency.BI_ANNUALLY;
    default:
      return Recurrency.ANNUALLY;
  }
};

export const convertMonthlyAmountToAnuallizedMonthlyAmount = (
  amount: number,
  recurrency?: number,
) => {
  return (amount * (recurrency ?? 12)) / 12;
};

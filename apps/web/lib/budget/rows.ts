export type BudgetSubRow = {
  key: number;
  name: string;
  budgeted: number;
  icon: string;
  textColor: string;
  bgColor: string;
  isSystemCategory: boolean;
  recurrency?: number;
  spent: number;
  /**
   * What last month left over and carries into this one (negative when it
   * overspent); 0 or absent when rollover is off. A parent row holds the sum
   * of its subcategories'.
   */
  rolledOver?: number;
  /** Rollover is on for the row (a parent row: for any subcategory). */
  rolloverEnabled?: boolean;
  /** The carry rests on spending that could not be converted, so it may be too high. */
  rolloverIncomplete?: boolean;
};

export type BudgetRow = BudgetSubRow & { subRows: BudgetSubRow[] };

export type BudgetRowLike = {
  key?: number;
  name?: string;
  budgeted: number;
  spent?: number;
  recurrency?: number;
  icon?: string;
  textColor?: string;
  bgColor?: string;
  isSystemCategory?: boolean;
  rolledOver?: number;
  subRows?: BudgetRowLike[];
};

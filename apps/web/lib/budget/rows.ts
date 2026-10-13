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
  subRows?: BudgetRowLike[];
};

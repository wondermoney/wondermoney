export interface Budget {
  budgetKey: number;
  name: string;
  description?: string;
  /** Sent by `GET /v1/budget/:budgetKey`; not by the budget list. */
  rolloverCarriesOverspend?: boolean;
}

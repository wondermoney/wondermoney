import { isAxiosError } from "axios";

/**
 * The API answers 404 for the capabilities the current market-data plan does
 * not include — fundamentals, financials, earnings and news (RAD-449). That is
 * a permanent product limitation, not a failure, and the UI has to tell the two
 * apart: a 404 explains itself, anything else is an error state.
 */
export function isMarketDataNotCovered(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 404;
}

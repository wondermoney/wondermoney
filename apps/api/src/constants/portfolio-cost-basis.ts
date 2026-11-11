/**
 * How a portfolio relieves cost when a holding is sold.
 *
 * - `FIFO` sells the oldest purchase lots first (Portugal, Spain and most jurisdictions).
 * - `AVERAGE` relieves cost at the running average of the open position, which the sale leaves
 *   unchanged (Brazil and other average-cost jurisdictions).
 */
export enum PortfolioCostBasisMethod {
  AVERAGE = 'AVERAGE',
  FIFO = 'FIFO',
}

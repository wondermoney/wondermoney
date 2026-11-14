/**
 * Every threshold the deterministic insights use, in one place.
 *
 * The figures are in the viewer's base currency unless stated otherwise. They are deliberately
 * conservative: an insight that fires too eagerly is noise, and a home card that says a category
 * is "running hot" has to be right often enough to be believed.
 */
export const INSIGHTS = {
  /** No insight fires until this many days of the month have elapsed. */
  MIN_DAYS_ELAPSED: 7,
  SPENDING_VS_NORMAL: {
    /** Full months of history the baseline averages over. */
    BASELINE_MONTHS: 3,
    /**
     * The average baseline must be at least this much for a percentage to mean anything. Below it
     * a handful of euros can swing the figure by hundreds of percent.
     */
    MIN_BASELINE_AMOUNT: 20,
    /** Absolute deviation from the baseline, in percent, that makes a category worth a card. */
    DEVIATION_PERCENT: 25,
    /** At most this many spending cards, ranked by how far they deviate. */
    MAX_INSIGHTS: 3,
  },
} as const;

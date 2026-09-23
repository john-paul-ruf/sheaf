/**
 * D53's two budgets, fixed at the architecture's reference floor until F07
 * calibrates them per device (the D31 precedent). They are constants, not
 * estimates: a query or chart that reaches one stops there and says exactly
 * how far it got, and never substitutes a smaller answer silently.
 *
 * Every consumer takes its budget as an argument defaulting to these values,
 * so a test can prove the partial path with a small one while production code
 * reads only what is written here.
 */

/** A filtered, sorted or searched records page examines at most this many candidate rows. */
export const QUERY_CANDIDATE_ROW_BUDGET = 50_000;

/** A chart dataset reads at most this many source rows (the newest, by `record_pk`). */
export const CHART_SOURCE_ROW_BUDGET = 20_000;

/** A chart draws at most this many marks (the first categories in the chart's order). */
export const CHART_MARK_BUDGET = 1_000;

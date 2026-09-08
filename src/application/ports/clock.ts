/**
 * Time as a dependency (F01 port subset, D9).
 *
 * Nothing derives a durable value from wall-clock time: a clock reading is
 * display evidence and calibration input, never an ordering substitute
 * (database.md § Identifiers).
 */
export interface ClockPort {
  /** Unix epoch milliseconds. */
  nowEpochMs(): number;
}

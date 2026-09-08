/**
 * The F01 library surface (M37, SCR-011, decision D5).
 *
 * There is exactly one variant, `empty`, because in F01 there is exactly one
 * truth: no app can exist yet. The type carries no count, no last-opened time,
 * and no placeholder row — a field that could only ever hold a fiction is not
 * a field (STA-025).
 *
 * Both actions ship **disabled with a reason token** (D5). Import and adoption
 * arrive in F02/F06, and an enabled control that cannot complete is the
 * untruthful option; a disabled one with a stated reason is the honest interim.
 * The token is machine-readable on purpose: S07 renders the copy from its own
 * mock, and `Button` requires a text equivalent for every disabled state
 * (CTL-014's contract), so no surface can drop the explanation.
 */

export type LibraryActionId = "choose-workbook" | "connect-durable-home";

/** Why the action is off. Not copy — the key S07 maps to its mock's wording. */
export type LibraryActionReason =
  /** The import pipeline is F02; nothing here can parse a workbook yet. */
  | "import-not-available-in-this-release"
  /** Providers and adoption are F05/F06; there is no home to connect to. */
  | "durable-homes-not-available-in-this-release";

export interface LibraryActionVm {
  readonly id: LibraryActionId;
  /** library-empty.html, verbatim. */
  readonly label: string;
  readonly enabled: false;
  readonly reason: LibraryActionReason;
}

export interface EmptyLibraryVm {
  readonly screen: "SCR-011";
  readonly kind: "empty";
  readonly actions: readonly LibraryActionVm[];
  readonly announcement: string;
}

const ACTIONS: readonly LibraryActionVm[] = Object.freeze([
  Object.freeze({
    id: "choose-workbook" as const,
    label: "Choose a workbook",
    enabled: false as const,
    reason: "import-not-available-in-this-release" as const,
  }),
  Object.freeze({
    id: "connect-durable-home" as const,
    label: "Connect a durable home",
    enabled: false as const,
    reason: "durable-homes-not-available-in-this-release" as const,
  }),
]);

export function selectEmptyLibraryVm(): EmptyLibraryVm {
  return {
    screen: "SCR-011",
    kind: "empty",
    actions: ACTIONS,
    // library-empty.html, verbatim.
    announcement: "Your apps will live here.",
  };
}

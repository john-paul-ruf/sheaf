/**
 * Joins class names into a definite string.
 *
 * CSS Module lookups are `string | undefined` under `noUncheckedIndexedAccess`,
 * and React Aria's `className` props reject `undefined` under
 * `exactOptionalPropertyTypes`. This is the one place that reconciles them.
 */
export function cx(
  ...values: readonly (string | false | undefined)[]
): string {
  return values
    .filter((value): value is string => typeof value === "string" && value !== "")
    .join(" ");
}

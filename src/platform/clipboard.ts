/**
 * Copying text for the user (M51; SCR-019's "Copy handoff instructions").
 *
 * The answer is what the platform actually did, never what was hoped: the
 * async clipboard needs a secure context, a user gesture and, in some
 * browsers, a permission, and any of those can be missing. `unavailable` lets
 * the surface say so and show the text instead of claiming it was copied.
 *
 * The route injects this into the surface; `src/ui/**` never imports it.
 */

export type CopyTextResultV1 = "copied" | "unavailable";

export async function copyText(text: string): Promise<CopyTextResultV1> {
  const clipboard = globalThis.navigator?.clipboard as Clipboard | undefined;
  if (clipboard === undefined) return "unavailable";
  try {
    await clipboard.writeText(text);
    return "copied";
  } catch {
    return "unavailable";
  }
}

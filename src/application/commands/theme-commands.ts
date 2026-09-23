/**
 * The theme command (M34; CAP-37, CA-32, D56): one authored `theme.changed`
 * through the entrance every other write uses (invariant 1 — the caller hears
 * `changed` only after the encrypted commit).
 *
 * The worker composes the theme from a built-in palette (the tokens are never
 * the caller's) and hands it here with that palette's dark set. This command
 * is the authority on whether it may be stored:
 *
 * 1. **The logo is judged by its header, never decoded.** A PNG signature, an
 *    `IHDR` whose dimensions match the ones claimed and sit inside 256×256,
 *    and at most 64 KiB. The page re-encoded it; this is the second look D56
 *    asks for, and a lie about the size is refused rather than believed.
 * 2. **Contrast in every mode the theme renders** — the same pure gate the
 *    editor shows (`evaluateThemeContrast`). A failing theme is a typed
 *    refusal naming each failing pair, and nothing is written.
 * 3. **A theme identical to the one stored authors nothing**: an event would
 *    record a change that never happened.
 *
 * The theme names only the six app tokens (`AppThemeTokensV1` is closed), so a
 * system-owned property cannot reach a commit at all.
 */

import {
  APP_LOGO_MAX_BYTES,
  APP_LOGO_MAX_EDGE,
  evaluateThemeContrast,
  isThemeColor,
  themeRenderings,
  type AppThemeLogoV1,
  type AppThemeTokensV1,
  type AppThemeV1,
  type ThemeContrastCheckV1,
} from "../../domain/model/events.js";
import type { CommitReceiptV1 } from "../ports/event-repository.js";
import { commitEvents, liveRecordCount, type CommandDependenciesV1 } from "./execute-command.js";

export type ThemeCommandDependenciesV1 = Pick<CommandDependenciesV1, "clock" | "entropy" | "projection" | "repository">;

/** Why a logo was refused by its header. */
export const LOGO_REFUSAL_REASONS = Object.freeze(["unreadable", "over-bytes", "over-edge"] as const);

export type LogoRefusalReasonV1 = (typeof LOGO_REFUSAL_REASONS)[number];

export type ThemeRefusalV1 =
  /** The theme asks for a mode its palette has no set for. */
  | { readonly kind: "unknown-palette" }
  | { readonly kind: "invalid-accent" }
  | { readonly kind: "logo"; readonly reason: LogoRefusalReasonV1 }
  /** Every failing pair, in every mode the theme renders. */
  | { readonly kind: "contrast"; readonly failures: readonly ThemeContrastCheckV1[] };

export type ThemeCommandResultV1 =
  | { readonly outcome: "changed"; readonly theme: AppThemeV1; readonly commit: CommitReceiptV1 }
  | { readonly outcome: "unchanged"; readonly theme: AppThemeV1 }
  | { readonly outcome: "refused"; readonly refusal: ThemeRefusalV1 };

export interface ChangeThemeRequestV1 {
  readonly theme: AppThemeV1;
  /** The palette's dark set; null for a theme that can be drawn only in light. */
  readonly darkTokens: AppThemeTokensV1 | null;
}

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Signature (8) + IHDR length (4) + type (4) + width (4) + height (4). */
const PNG_HEADER_BYTES = 24;

/** The logo's header, read and nothing more (D56: the worker never decodes it). */
export function inspectLogo(logo: AppThemeLogoV1): LogoRefusalReasonV1 | null {
  const { bytes } = logo;
  if (bytes.byteLength > APP_LOGO_MAX_BYTES) return "over-bytes";
  if (bytes.byteLength < PNG_HEADER_BYTES || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return "unreadable";
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const isIhdr = view.getUint32(8) === 13 && String.fromCharCode(...bytes.subarray(12, 16)) === "IHDR";
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!isIhdr || width === 0 || height === 0 || width !== logo.width || height !== logo.height) {
    return "unreadable";
  }
  return width > APP_LOGO_MAX_EDGE || height > APP_LOGO_MAX_EDGE ? "over-edge" : null;
}

/** Judges a theme without writing anything: null means it may be stored. */
export function judgeTheme(request: ChangeThemeRequestV1): ThemeRefusalV1 | null {
  const { theme, darkTokens } = request;
  if (theme.customAccent !== undefined && !isThemeColor(theme.customAccent)) {
    return { kind: "invalid-accent" };
  }
  if (theme.logo !== undefined) {
    const reason = inspectLogo(theme.logo);
    if (reason !== null) return { kind: "logo", reason };
  }
  if ((theme.mode ?? "light") !== "light" && darkTokens === null) {
    return { kind: "unknown-palette" };
  }
  const failures = evaluateThemeContrast(themeRenderings(theme, darkTokens)).filter((check) => !check.passes);
  return failures.length === 0 ? null : { kind: "contrast", failures };
}

const sameBytes = (first: Uint8Array, second: Uint8Array): boolean =>
  first.byteLength === second.byteLength && first.every((byte, index) => byte === second[index]);

function sameTheme(first: AppThemeV1, second: AppThemeV1): boolean {
  const tokensEqual = (Object.keys(first.tokens) as (keyof AppThemeTokensV1)[]).every(
    (token) => first.tokens[token] === second.tokens[token],
  );
  const logosEqual =
    first.logo === undefined || second.logo === undefined
      ? first.logo === second.logo
      : first.logo.width === second.logo.width &&
        first.logo.height === second.logo.height &&
        sameBytes(first.logo.bytes, second.logo.bytes);
  return (
    first.themeKey === second.themeKey &&
    tokensEqual &&
    (first.mode ?? "light") === (second.mode ?? "light") &&
    (first.density ?? "comfortable") === (second.density ?? "comfortable") &&
    first.customAccent === second.customAccent &&
    logosEqual
  );
}

export async function changeTheme(
  deps: ThemeCommandDependenciesV1,
  request: ChangeThemeRequestV1,
): Promise<ThemeCommandResultV1> {
  const refusal = judgeTheme(request);
  if (refusal !== null) return { outcome: "refused", refusal };

  const before = deps.projection.execute({ kind: "app-state" }).theme;
  if (sameTheme(before, request.theme)) return { outcome: "unchanged", theme: before };

  const committed = await commitEvents(
    deps,
    [{ subject: {}, event: { kind: "theme.changed", payload: { before, after: request.theme } } }],
    { rowCountAfter: liveRecordCount(deps.projection) },
  );
  return { outcome: "changed", theme: request.theme, commit: committed.commit };
}

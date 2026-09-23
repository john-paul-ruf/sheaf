/**
 * The theme column's worker edge and its one page-side job (M36 → M32;
 * CAP-37, CA-32, D56).
 *
 * Reading the palettes and saving a theme are request/response pairs, like
 * the records and structure adapters. A save is acknowledged only by the
 * worker's answer, which comes after the encrypted commit (invariant 1).
 *
 * **The logo is decoded here, on the page (D56).** The chosen file (PNG, JPEG
 * or WebP) is decoded, drawn at most 256×256 px and re-encoded as PNG. A file
 * that cannot be read, or whose PNG is still over 64 KiB, is refused with its
 * reason and the initials remain. The worker checks the PNG's header and
 * bounds again, and never decodes it.
 */

import { APP_LOGO_MAX_BYTES, APP_LOGO_MAX_EDGE } from "../../domain/model/events.js";
import type {
  AppLogoWireV1,
  ChangeThemeRequestV1,
  ChangeThemeResponseV1,
  ListThemePalettesResponseV1,
} from "../../workers/protocol/messages.js";
import type { RecordsWorkerPort } from "./records-services.js";

/** What theme.html's file control accepts. */
export const LOGO_MEDIA_TYPES: readonly string[] = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

/** Decodes an image and re-encodes it as a PNG no wider or taller than `maxEdge`. Rejects if unreadable. */
export interface LogoCodecPort {
  readonly toPng: (
    file: Blob,
    maxEdge: number,
  ) => Promise<{ readonly bytes: Uint8Array; readonly width: number; readonly height: number }>;
}

export const browserLogoCodec: LogoCodecPort = {
  toPng: async (file, maxEdge) => {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2d context to draw the logo with");
      context.drawImage(bitmap, 0, 0, width, height);
      const png = await canvas.convertToBlob({ type: "image/png" });
      return { bytes: new Uint8Array(await png.arrayBuffer()), width, height };
    } finally {
      bitmap.close();
    }
  },
};

export type LogoPreparationV1 =
  | { readonly kind: "ready"; readonly logo: AppLogoWireV1 }
  | { readonly kind: "refused"; readonly reason: "unreadable" | "over-bytes" };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export interface ThemeServices {
  /** The built-in palettes (DF-1), from the worker's own constants. */
  readonly listThemePalettes: () => Promise<ListThemePalettesResponseV1>;
  /** SCR-036 "Save theme locally": answered after the commit, or refused with its reason. */
  readonly changeTheme: (input: Omit<ChangeThemeRequestV1, "kind">) => Promise<ChangeThemeResponseV1>;
  /** The chosen file as the logo the worker will take, or why it will not. */
  readonly prepareLogo: (file: Blob) => Promise<LogoPreparationV1>;
}

export function createThemeServices(port: RecordsWorkerPort, codec: LogoCodecPort = browserLogoCodec): ThemeServices {
  return {
    listThemePalettes: () => port.send({ kind: "listThemePalettes" }),
    changeTheme: (input) => port.send({ kind: "changeTheme", ...input }),
    prepareLogo: async (file) => {
      if (!LOGO_MEDIA_TYPES.includes(file.type)) return { kind: "refused", reason: "unreadable" };
      let png: Awaited<ReturnType<LogoCodecPort["toPng"]>>;
      try {
        png = await codec.toPng(file, APP_LOGO_MAX_EDGE);
      } catch {
        return { kind: "refused", reason: "unreadable" };
      }
      if (png.bytes.byteLength > APP_LOGO_MAX_BYTES) return { kind: "refused", reason: "over-bytes" };
      return { kind: "ready", logo: { pngBase64: toBase64(png.bytes), width: png.width, height: png.height } };
    },
  };
}

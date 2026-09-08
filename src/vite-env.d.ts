/// <reference types="vite/client" />

/** Build identity injected by `vite.config.ts` (`define`). */
declare const __SHEAF_BUILD_ID__: string;

interface Window {
  /** Identity of the served build, published by every entry document. */
  __sheafBuildId: string;
}

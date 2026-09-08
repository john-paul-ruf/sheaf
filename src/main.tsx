/**
 * M55 — the browser entry.
 *
 * Composition only: publish this artifact's identity, import the shell's one
 * stylesheet, mount the theme, and hand the page to the route table. No logic
 * beyond that lives here, nothing is loaded from outside this origin, and
 * `src/harness/**` is never reachable from this graph.
 *
 * The two build-identity lines are SESSION-01's mechanism (D15) and must be
 * preserved verbatim by anything that rewrites this file: the served-artifact
 * assertions in `tests/e2e/**` and `tests/browser/**` read exactly these.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ui/theme/base.css";
import { applyShellTheme } from "./ui/theme/theme.js";
import { SheafApp } from "./routes/route-table.js";

window.__sheafBuildId = __SHEAF_BUILD_ID__;
document.documentElement.dataset["sheafBuildId"] = __SHEAF_BUILD_ID__;

// Presentation only: `applyShellTheme` throws if a caller tries to remap a
// safety semantic or the focus ring, and F01 passes nothing at all.
applyShellTheme(document.documentElement);

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Sheaf entry element #root is missing");
}

createRoot(container).render(
  <StrictMode>
    <SheafApp />
  </StrictMode>,
);

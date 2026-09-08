import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

window.__sheafBuildId = __SHEAF_BUILD_ID__;
document.documentElement.dataset["sheafBuildId"] = __SHEAF_BUILD_ID__;

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Sheaf entry element #root is missing");
}

createRoot(container).render(
  <StrictMode>
    <main>Sheaf</main>
  </StrictMode>,
);

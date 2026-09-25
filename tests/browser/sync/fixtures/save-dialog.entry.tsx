import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BundleSaveDialog, type BundleSaveStage } from "../../../../src/ui/durability/bundle-save-dialog.js";
import "../../../../src/ui/theme/tokens.css";
import "../../../../src/ui/theme/base.css";

function Fixture() {
  const [stage, setStage] = useState<BundleSaveStage | null>(null);
  return <main><h1>Bundle save component proof</h1><button onClick={() => { setStage("awaitingConfirmation"); }}>Review delivered bundle</button>
    {stage !== null && <BundleSaveDialog stage={stage} appName="Cedar & Finch" confirmedAt="Never confirmed" pendingCount={1}
      onStart={() => { setStage("preparing"); }} onConfirm={() => { setStage("savedUser"); }} onClose={() => { setStage(null); }} />}</main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

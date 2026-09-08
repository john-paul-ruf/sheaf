import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConsequencesList } from "../../../src/ui/primitives/consequences-list.js";
import { EncryptionCallout } from "../../../src/ui/primitives/encryption-callout.js";
import {
  maskRecoveryCode,
  RecoveryCodeCard,
} from "../../../src/ui/primitives/recovery-code-card.js";
import {
  StatusBanner,
  type StatusTone,
} from "../../../src/ui/primitives/status-banner.js";
import "../../../src/ui/theme/base.css";
import { interact, query, queryAll, render, settle } from "./render.js";

const CODE = "LCL-7G4K-N8RD-2QPM-V6TX";

describe("StatusBanner — CTL-081 states", () => {
  const TONES: readonly StatusTone[] = ["info", "warning", "danger", "success"];

  it.each(TONES)("%s: names the state in text, not only in colour", async (tone) => {
    await render(
      <StatusBanner tone={tone} title="Backup queued">
        Saved locally. Retry when online.
      </StatusBanner>,
    );
    expect(document.body.textContent).toContain("Backup queued");
    expect(document.body.textContent).toContain("Saved locally.");
    expect(query("[data-tone]").getAttribute("data-tone")).toBe(tone);
  });

  it("interrupts for danger and waits its turn otherwise", async () => {
    const { rerender } = await render(
      <StatusBanner tone="danger" title="Token expired" />,
    );
    expect(query("[data-tone]").getAttribute("role")).toBe("alert");

    await rerender(<StatusBanner tone="success" title="Backup confirmed" />);
    expect(query("[data-tone]").getAttribute("role")).toBe("status");
  });

  it("renders a remedy beside the facts, or none at all", async () => {
    const { rerender } = await render(
      <StatusBanner tone="warning" title="Backup queued" />,
    );
    expect(queryAll("button")).toHaveLength(0);

    await rerender(
      <StatusBanner
        tone="warning"
        title="Backup queued"
        action={<button type="button">Back up now</button>}
      />,
    );
    expect(query("button").textContent).toBe("Back up now");
  });

  it("hides its glyph from assistive technology", async () => {
    await render(<StatusBanner tone="info" title="Listed only" />);
    expect(query('[aria-hidden="true"]').textContent).toBe("i");
  });
});

describe("EncryptionCallout — CTL-099 states", () => {
  it("local: reads as reassurance", async () => {
    await render(
      <EncryptionCallout scope="local" title="Encrypted on this device" />,
    );
    expect(query("[data-tone]").getAttribute("data-tone")).toBe("success");
    expect(document.body.textContent).toContain("Encrypted on this device");
  });

  it("durable home: reads as reassurance", async () => {
    await render(
      <EncryptionCallout
        scope="durable-home"
        title="Encrypted locally and in the durable home"
      />,
    );
    expect(query("[data-tone]").getAttribute("data-tone")).toBe("success");
  });

  it("export exception: is the one that warns", async () => {
    await render(
      <EncryptionCallout scope="export-exception" title="Export is plaintext">
        Anyone who opens the file can read it.
      </EncryptionCallout>,
    );
    expect(query("[data-tone]").getAttribute("data-tone")).toBe("danger");
    expect(query("[data-tone]").getAttribute("role")).toBe("alert");
    expect(document.body.textContent).toContain(
      "Anyone who opens the file can read it.",
    );
  });
});

describe("ConsequencesList — CTL-100 sections", () => {
  it("renders known inventory, survivors and encrypted unknowns", async () => {
    await render(
      <ConsequencesList
        known={{
          heading: "Known",
          items: ["4 local apps", "10 device-only changes"],
        }}
        survives={{ heading: "Survives", items: ["Provider ciphertext"] }}
        unknownWhileLocked={{
          heading: "Unknown while locked",
          items: ["Decrypted names and counts"],
        }}
      />,
    );

    expect(queryAll("section").map((s) => s.getAttribute("data-kind"))).toEqual([
      "known",
      "survives",
      "unknown",
    ]);
    expect(queryAll("li").map((li) => li.textContent)).toEqual([
      "4 local apps",
      "10 device-only changes",
      "Provider ciphertext",
      "Decrypted names and counts",
    ]);
  });

  it("a locked reset omits the inventory it cannot enumerate", async () => {
    await render(
      <ConsequencesList
        survives={{ heading: "Survives", items: ["Provider ciphertext"] }}
        unknownWhileLocked={{
          heading: "Unknown while locked",
          items: [
            "Sheaf cannot list what is encrypted. That is the encryption working.",
          ],
        }}
      />,
    );

    expect(queryAll("section").map((s) => s.getAttribute("data-kind"))).toEqual([
      "survives",
      "unknown",
    ]);
    // Nothing is counted or hinted at while locked.
    expect(document.body.textContent).not.toMatch(/\d+\s+(local )?apps?/);
  });
});

describe("RecoveryCodeCard — CTL-096 states", () => {
  function Harness(
    props: Partial<{
      readonly onCopy: (code: string) => Promise<void>;
      readonly onPrint: () => void;
    }> = {},
  ): React.ReactNode {
    const [saved, setSaved] = useState(false);
    return (
      <RecoveryCodeCard
        code={CODE}
        confirmLabel="I saved the local recovery code"
        confirmDetail="If I lose both, nobody can recover this device."
        isConfirmedSaved={saved}
        onConfirmedSavedChange={setSaved}
        scope={{ kind: "local-device" }}
        title="Write this down once"
        {...props}
      />
    );
  }

  const button = (label: string): HTMLButtonElement =>
    queryAll<HTMLButtonElement>("button").find(
      (candidate) => candidate.textContent === label,
    ) ??
    (() => {
      throw new Error(`no button ${label}`);
    })();

  it("hidden: masks the middle of the code and offers to reveal it", async () => {
    await render(<Harness />);
    const code = query("output").textContent ?? "";
    expect(code).not.toContain("7G4K");
    expect(code).toContain("•");
    expect(code.startsWith("LCL-")).toBe(true);
    expect(code.endsWith("-V6TX")).toBe(true);
  });

  it("revealed: shows the whole code and drops the reveal control", async () => {
    await render(<Harness />);
    await interact(() => {
      button("Reveal").click();
    });
    expect(query("output").textContent).toBe(CODE);
    expect(
      queryAll("button").some((b) => b.textContent === "Reveal"),
    ).toBe(false);
  });

  it("copied: confirms through a live region", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    await render(<Harness onCopy={onCopy} />);
    await interact(() => {
      button("Copy code").click();
    });
    await settle();

    expect(onCopy).toHaveBeenCalledWith(CODE);
    expect(query('[role="status"]').textContent).toBe("Copied");
  });

  it("copied: says so truthfully when the clipboard refuses", async () => {
    const onCopy = vi.fn().mockRejectedValue(new Error("denied"));
    await render(<Harness onCopy={onCopy} />);
    await interact(() => {
      button("Copy code").click();
    });
    await settle();

    expect(query('[role="status"]').textContent).toContain(
      "Copying is unavailable",
    );
  });

  it("printed: hands off to print and confirms", async () => {
    const onPrint = vi.fn();
    await render(<Harness onPrint={onPrint} />);
    await interact(() => {
      button("Print").click();
    });

    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(query('[role="status"]').textContent).toBe("Printed");
  });

  it("confirmed saved: is a caller-owned fact, and states the consequence", async () => {
    await render(<Harness />);
    const checkbox = query<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox.checked).toBe(false);

    await interact(() => {
      checkbox.click();
    });
    expect(checkbox.checked).toBe(true);
    expect(document.body.textContent).toContain(
      "If I lose both, nobody can recover this device.",
    );
  });

  it("names the scope of the secret it is showing", async () => {
    await render(<Harness />);
    expect(document.body.textContent).toContain("Local · this device");
  });

  it("maskRecoveryCode keeps the shape and hides the content", () => {
    expect(maskRecoveryCode(CODE)).toBe("LCL-••••-••••-••••-V6TX");
    expect(maskRecoveryCode("AB-CD")).toBe("AB-CD");
    expect(maskRecoveryCode("SOLID")).toBe("SOLID");
  });
});

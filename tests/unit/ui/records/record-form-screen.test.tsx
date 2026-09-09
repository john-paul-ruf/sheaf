import { describe, expect, it, vi } from "vitest";
import { selectRecordFormVm } from "../../../../src/application/view-models/records.js";
import type { RecordIssueViewV1 } from "../../../../src/workers/protocol/messages.js";
import {
  RecordFormScreen,
  type AuthoredEntryIntentV1,
} from "../../../../src/ui/records/record-form-screen.js";
import type {
  AppIdentity,
  AppNavigation,
} from "../../../../src/ui/records/app-frame.js";
import "../../../../src/ui/theme/base.css";
import {
  accessibleName,
  interact,
  query,
  queryAll,
  render,
  typeInto,
} from "../render.js";
import {
  APP_ID,
  FIELD_IDS,
  OPTION_IDS,
  TABLE_ID,
  detail,
  session,
  table,
} from "./fixtures.js";

/**
 * SCR-028 and SCR-029 as rendered (CAP-16, D23, D25, invariants 1 and 5).
 *
 * The four claims this file exists to hold:
 *
 * 1. every field type brings its own control and keyboard;
 * 2. what the person typed reaches the worker as the *truthful* wire kind,
 *    including when that kind is "text in a number field";
 * 3. a refusal is rendered at field level and leaves the form usable;
 * 4. nothing is acknowledged here — the success sentence belongs to the
 *    confirmed outcome, on the screen the route sends the person to.
 */

const nav: AppNavigation = {
  library: "#/library",
  appHome: `#/app/${APP_ID}`,
  appHistory: `#/app/${APP_ID}/history`,
  tables: [
    {
      tableId: TABLE_ID,
      displayName: "Visits",
      href: `#/app/${APP_ID}/t/${TABLE_ID}`,
    },
  ],
};

const identity: AppIdentity = {
  appId: APP_ID,
  displayName: "Field Log",
  theme: session().theme,
};

interface FormOptions {
  readonly edit?: boolean;
  readonly issues?: readonly RecordIssueViewV1[];
  readonly busy?: boolean;
  readonly onSave?: (entries: readonly AuthoredEntryIntentV1[]) => void;
}

async function renderForm(options: FormOptions = {}): Promise<void> {
  const vm = selectRecordFormVm({
    table: table(),
    ...(options.edit === true ? { record: detail() } : {}),
    ...(options.issues === undefined ? {} : { issues: options.issues }),
    ...(options.busy === undefined ? {} : { busy: options.busy }),
  });
  await render(
    <RecordFormScreen
      app={identity}
      cancelHref={`#/app/${APP_ID}/t/${TABLE_ID}`}
      nav={nav}
      onSave={options.onSave ?? vi.fn()}
      vm={vm}
    />,
  );
}

/** The input (or the sheet trigger) a field renders. */
function control(fieldId: string): HTMLElement {
  const group = query(`[data-field="${fieldId}"]`);
  const found = group.querySelector<HTMLElement>("input, button, p");
  if (found === null) throw new Error(`no control for ${fieldId}`);
  return found;
}

describe("SCR-028 — the typed inputs come from the field's type", () => {
  it("gives every field type its own control and keyboard", async () => {
    await renderForm();

    const text = control(FIELD_IDS.visitId);
    expect(text.getAttribute("type")).toBe("text");
    expect(text.getAttribute("inputmode")).toBe("text");

    // A number is text with the decimal keypad: `type="number"` cannot hold
    // the invalid state CTL-030 requires, and would round-trip through a float.
    const amount = control(FIELD_IDS.amount);
    expect(amount.getAttribute("type")).toBe("text");
    expect(amount.getAttribute("inputmode")).toBe("decimal");

    expect(control(FIELD_IDS.visitDate).getAttribute("type")).toBe("date");
    expect(control(FIELD_IDS.visitDate).dataset["control"]).toBe(
      "native-date-picker",
    );

    const phone = control(FIELD_IDS.phone);
    expect(phone.getAttribute("type")).toBe("tel");
    expect(phone.getAttribute("inputmode")).toBe("tel");

    const email = control(FIELD_IDS.email);
    expect(email.getAttribute("type")).toBe("email");
    expect(email.getAttribute("inputmode")).toBe("email");

    const url = control(FIELD_IDS.url);
    expect(url.getAttribute("type")).toBe("url");
    expect(url.getAttribute("inputmode")).toBe("url");

    expect(control(FIELD_IDS.followUp).getAttribute("type")).toBe("checkbox");
    expect(control(FIELD_IDS.site).dataset["control"]).toBe("option-sheet");
  });

  it("announces the enum trigger as its field and its current value", async () => {
    await renderForm({ edit: true });

    const trigger = control(FIELD_IDS.site);
    expect(accessibleName(trigger)).toBe("Site Alder Court");
  });

  it("names the currency the amount is in", async () => {
    await renderForm();
    expect(
      query(`[data-field="${FIELD_IDS.amount}"]`).textContent,
    ).toContain("Amount in USD.");
  });

  it("renders typed refusals itself, not the browser's", async () => {
    await renderForm();
    expect(query("form").hasAttribute("novalidate")).toBe(true);
  });

  it("marks a required field as required", async () => {
    await renderForm();
    expect(
      query(`[data-field="${FIELD_IDS.status}"]`).textContent,
    ).toContain("(required)");
  });
});

describe("SCR-028 — what is typed becomes the truthful wire value", () => {
  it("sends a canonical decimal as a number and anything else as text", async () => {
    const onSave = vi.fn();
    await renderForm({ onSave });

    await typeInto(
      control(FIELD_IDS.amount) as HTMLInputElement,
      "1250.00",
    );
    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenLastCalledWith([
      { fieldId: FIELD_IDS.amount, value: { kind: "number", decimal: "1250.00" } },
    ]);

    // "TBD" is not a number the domain holds. It crosses as what it is, and
    // the one validator is what refuses it (invariant 5).
    await typeInto(control(FIELD_IDS.amount) as HTMLInputElement, "TBD");
    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenLastCalledWith([
      { fieldId: FIELD_IDS.amount, value: { kind: "text", text: "TBD" } },
    ]);
  });

  it("sends a date as its epoch day", async () => {
    const onSave = vi.fn();
    await renderForm({ onSave });

    await typeInto(
      control(FIELD_IDS.visitDate) as HTMLInputElement,
      "2026-03-19",
    );
    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenLastCalledWith([
      { fieldId: FIELD_IDS.visitDate, value: { kind: "date", epochDay: 20_531 } },
    ]);
  });

  it("leaves an untouched field out of a create, so it stays missing", async () => {
    const onSave = vi.fn();
    await renderForm({ onSave });

    await typeInto(control(FIELD_IDS.visitId) as HTMLInputElement, "1050");
    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenLastCalledWith([
      { fieldId: FIELD_IDS.visitId, value: { kind: "text", text: "1050" } },
    ]);
  });

  it("sends a cleared field on an edit as blank, not as missing", async () => {
    const onSave = vi.fn();
    await renderForm({ edit: true, onSave });

    await typeInto(control(FIELD_IDS.visitId) as HTMLInputElement, "");
    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenLastCalledWith([
      { fieldId: FIELD_IDS.visitId, value: { kind: "blank" } },
    ]);
  });

  it("offers the imported original for editing, exactly as it arrived", async () => {
    await renderForm({ edit: true });
    expect((control(FIELD_IDS.amount) as HTMLInputElement).value).toBe("TBD");
  });

  it("applies an enum through SHT-001 and sends the option id", async () => {
    const onSave = vi.fn();
    await renderForm({ onSave });

    await interact(() => {
      control(FIELD_IDS.site).click();
    });
    const sheet = query('[data-sheet="SHT-001"]');
    const options = [...sheet.querySelectorAll("button")].map(
      (button) => button.textContent,
    );
    // Only active options are offered; the retired one is not a new choice.
    expect(options).toEqual(["Ridgeway Depot", "Alder Court"]);

    await interact(() => {
      sheet.querySelectorAll("button")[1]?.click();
    });
    const apply = queryAll("button").find(
      (button) => button.textContent === "Apply choice",
    );
    await interact(() => {
      apply?.click();
    });
    expect(control(FIELD_IDS.site).textContent).toBe("Alder Court");

    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenLastCalledWith([
      {
        fieldId: FIELD_IDS.site,
        value: { kind: "option", optionId: OPTION_IDS.alder },
      },
    ]);
  });
});

describe("SCR-029 — a refusal is explained, and the form stays usable", () => {
  const rejection: readonly RecordIssueViewV1[] = [
    {
      fieldId: FIELD_IDS.amount,
      kind: "value",
      severity: "blocking",
      messageKey: "validation.wrong-type",
      messageParameters: { field: "Quoted amount", expected: "currency" },
    },
    {
      fieldId: FIELD_IDS.status,
      kind: "value",
      severity: "blocking",
      messageKey: "validation.required",
      messageParameters: { field: "Status" },
    },
  ];

  it("explains each failure in user language, beside its own field", async () => {
    await renderForm({ edit: true, issues: rejection });

    expect(query(`[data-field="${FIELD_IDS.amount}"]`).textContent).toContain(
      "This value is not the kind this field holds.",
    );
    expect(query(`[data-field="${FIELD_IDS.status}"]`).textContent).toContain(
      "This field needs a value before the record can be saved.",
    );
    // The whole report, not the first issue (D23).
    expect(
      queryAll('[data-severity="blocking"]').map((node) => node.textContent),
    ).toHaveLength(2);
  });

  it("marks the refused inputs invalid", async () => {
    await renderForm({ edit: true, issues: rejection });
    expect(control(FIELD_IDS.amount).getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps Save alive after a refusal, so the correction can be sent", async () => {
    const onSave = vi.fn();
    await renderForm({ edit: true, issues: rejection, onSave });

    const save = queryAll("button").find(
      (button) => button.textContent === "Save on this device",
    );
    expect(save?.hasAttribute("disabled")).toBe(false);

    await typeInto(control(FIELD_IDS.amount) as HTMLInputElement, "430.50");
    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("acknowledges nothing while the write is in flight (invariant 1)", async () => {
    const onSave = vi.fn();
    await renderForm({ edit: true, busy: true, onSave });

    const save = queryAll("button").find(
      (button) => button.textContent === "Save on this device",
    );
    expect(save?.hasAttribute("disabled")).toBe(true);
    expect(query('[data-screen="SCR-029"]').textContent).toContain(
      "This record is being written to this device.",
    );
    expect(query('[data-screen="SCR-029"]').textContent).not.toContain(
      "Saved on this device.",
    );

    await interact(() => {
      query<HTMLFormElement>("form").requestSubmit();
    });
    expect(onSave).not.toHaveBeenCalled();
  });
});

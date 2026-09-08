import type { ReactNode } from "react";
import { StatusBanner } from "./status-banner.js";

/**
 * Which encryption boundary a callout is describing.
 * `export-exception` is the one place Sheaf hands out plaintext.
 */
export type EncryptionScope = "local" | "durable-home" | "export-exception";

/**
 * CTL-099 encrypted-vs-plaintext callout.
 *
 * States: local, durable home, export exception. The copy is the caller's —
 * design.md §Content Patterns requires exact, scope-naming wording, and this
 * control must not invent it. What the scope decides is the tone: the export
 * exception is the only one that reads as a warning rather than reassurance.
 */
export interface EncryptionCalloutProps {
  readonly scope: EncryptionScope;
  /** Exact screen copy, e.g. "Encrypted locally and in the durable home". */
  readonly title: string;
  readonly children?: ReactNode;
  readonly className?: string;
}

export function EncryptionCallout({
  scope,
  title,
  children,
  className,
}: EncryptionCalloutProps): ReactNode {
  return (
    <StatusBanner
      tone={scope === "export-exception" ? "danger" : "success"}
      title={title}
      {...(className === undefined ? {} : { className })}
    >
      {children}
    </StatusBanner>
  );
}

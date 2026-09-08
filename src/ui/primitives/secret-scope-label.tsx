import type { ReactNode } from "react";
import styles from "./secret-scope-label.module.css";

/**
 * Which secret a surface is talking about. design.md §Content Patterns:
 * "Never *Enter your passphrase*" — the scope is always named.
 */
export type SecretScope =
  | { readonly kind: "local-device" }
  | { readonly kind: "vault"; readonly vaultName: string };

/**
 * CTL-097 secret-scope label.
 *
 * States: local device, named durable-home vault. Icon plus text — the two
 * scopes are never distinguished by hue alone.
 */
export interface SecretScopeLabelProps {
  readonly scope: SecretScope;
}

export function SecretScopeLabel({ scope }: SecretScopeLabelProps): ReactNode {
  const text =
    scope.kind === "local-device"
      ? "Local · this device"
      : `Vault · ${scope.vaultName}`;

  return (
    <span className={styles["root"]} data-scope={scope.kind}>
      <span aria-hidden="true">{scope.kind === "local-device" ? "⌁" : "▣"}</span>
      {text}
    </span>
  );
}

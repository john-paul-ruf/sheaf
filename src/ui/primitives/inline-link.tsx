import type { ReactNode } from "react";
import { Link } from "react-aria-components";
import { cx } from "./class-names.js";
import styles from "./inline-link.module.css";

/**
 * CTL-020 inline link.
 *
 * States: default, hover, focus, visited-neutral, external handoff.
 *
 * F01 renders internal hash routes only. The external-handoff variant is
 * declared here so its absence is explicit rather than forgotten, and it fails
 * closed: design.md requires an approved external-handoff affordance, no F01
 * surface has one, and inventing it would breach architectural invariant 10.
 * A later feature replaces the throw with the approved affordance.
 */
export type InlineLinkTarget =
  | { readonly kind: "internal"; readonly href: string }
  | { readonly kind: "externalHandoff"; readonly href: string };

export interface InlineLinkProps {
  readonly target: InlineLinkTarget;
  readonly children: ReactNode;
  readonly className?: string;
}

export function InlineLink({
  target,
  children,
  className,
}: InlineLinkProps): ReactNode {
  if (target.kind === "externalHandoff") {
    throw new Error(
      "InlineLink externalHandoff has no approved F01 use: design.md defines " +
        "no external-handoff affordance for the security surfaces. Route this " +
        "through a design-fill request rather than inventing one.",
    );
  }

  return (
    <Link className={cx(styles["root"], className)} href={target.href}>
      {children}
    </Link>
  );
}

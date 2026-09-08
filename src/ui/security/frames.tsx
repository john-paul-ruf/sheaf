import type { ReactNode } from "react";
import { AppShell, type ShellDestination } from "../layout/app-shell.js";
import { AuthShell } from "../layout/auth-shell.js";
import { cx } from "../primitives/class-names.js";
import visuallyHidden from "../primitives/visually-hidden.module.css";

/**
 * The two frames every F01 security surface sits in, plus the anchors those
 * surfaces link to (M41).
 *
 * The hrefs arrive as data because the URL scheme is M54's, not M41's: a
 * screen states *where it goes*, the route table decides *what that spells*.
 */
export interface SecurityNavigation {
  readonly welcome: string;
  readonly setup: string;
  readonly unlock: string;
  readonly recover: string;
  readonly resetLocked: string;
  readonly library: string;
  readonly securitySettings: string;
  readonly passphraseChange: string;
  readonly recoveryCodes: string;
  readonly resetReadable: string;
}

/** The mocks' header mark. A word, so it needs no asset and no network (D7). */
const WORDMARK = "Sheaf";

/**
 * One live region per frame, carrying M37's `announcement` for whichever state
 * is showing.
 *
 * It lives here rather than in each screen so no surface can forget it, and it
 * is `status` rather than `alert` because the urgent cases already interrupt
 * on their own: CTL-087 is an `alert`, and a danger banner is an `alert`. This
 * is the polite channel for step changes, busy states, and countdowns.
 */
function Announcement({
  announcement,
}: {
  readonly announcement: string | undefined;
}): ReactNode {
  if (announcement === undefined) {
    return null;
  }
  return (
    <span className={cx(visuallyHidden["root"])} role="status">
      {announcement}
    </span>
  );
}

export interface LockedFrameProps {
  /** Header status beside the wordmark, e.g. "No network needed". */
  readonly headerAside?: ReactNode;
  /** M37's announcement for the state now showing. */
  readonly announcement?: string;
  readonly children: ReactNode;
}

/** SCR-001–004 and SCR-008: no navigation exists while the store is locked. */
export function LockedFrame({
  headerAside,
  announcement,
  children,
}: LockedFrameProps): ReactNode {
  return (
    <AuthShell
      wordmark={WORDMARK}
      {...(headerAside === undefined ? {} : { headerAside })}
    >
      <Announcement announcement={announcement} />
      {children}
    </AuthShell>
  );
}

/** Which shell destination the current screen belongs to. */
export type ShellArea = "library" | "security";

export interface UnlockedFrameProps {
  readonly nav: SecurityNavigation;
  readonly area: ShellArea;
  readonly title: string;
  readonly topBarActions?: ReactNode;
  /** M37's announcement for the state now showing. */
  readonly announcement?: string;
  readonly children: ReactNode;
}

/**
 * SCR-005–007, SCR-009 and SCR-011.
 *
 * F01 ships two destinations because F01 has two screens behind the shell;
 * the mock's upload, durable-home and budget entries arrive with the features
 * that give them somewhere to go. Returning to the library is labelled
 * **All apps** (design.md §Shell and generated-app boundary).
 */
export function UnlockedFrame({
  nav,
  area,
  title,
  topBarActions,
  announcement,
  children,
}: UnlockedFrameProps): ReactNode {
  const destinations: readonly ShellDestination[] = [
    {
      id: "library",
      label: "All apps",
      href: nav.library,
      glyph: "⌂",
      ...(area === "library" ? { isCurrent: true } : {}),
    },
    {
      id: "security",
      label: "Security",
      href: nav.securitySettings,
      glyph: "S",
      ...(area === "security" ? { isCurrent: true } : {}),
    },
  ];

  return (
    <AppShell
      destinations={destinations}
      wordmark={WORDMARK}
      title={title}
      {...(topBarActions === undefined ? {} : { topBarActions })}
    >
      <Announcement announcement={announcement} />
      {children}
    </AppShell>
  );
}

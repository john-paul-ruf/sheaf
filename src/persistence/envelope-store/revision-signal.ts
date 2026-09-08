/**
 * Cross-tab revision notice.
 *
 * A commit in one tab makes every other tab's expected revision stale. The
 * notice carries the new transaction revision and nothing else — it is
 * published to a same-origin BroadcastChannel, so it may never say anything a
 * locked observer is not already allowed to see (cleartext budget: the
 * revision is an allowed clear fact).
 *
 * The channel is a required runtime capability (D14); a context without it
 * simply never notices, which is the fail-closed behavior — a missed notice
 * costs an optimistic-concurrency retry, never a lost write.
 */

export const REVISION_CHANNEL_NAME = "sheaf-local-revision";

export interface RevisionNotice {
  readonly revision: number;
}

function isRevisionNotice(value: unknown): value is RevisionNotice {
  return (
    typeof value === "object" &&
    value !== null &&
    Number.isSafeInteger((value as RevisionNotice).revision)
  );
}

/** Announces a committed revision to the other tabs, never to this one. */
export function publishRevision(revision: number): void {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }
  const channel = new BroadcastChannel(REVISION_CHANNEL_NAME);
  channel.postMessage({ revision } satisfies RevisionNotice);
  channel.close();
}

/** Returns the unsubscribe function; the channel closes with it. */
export function subscribeRevision(
  onRevision: (revision: number) => void,
): () => void {
  if (typeof BroadcastChannel === "undefined") {
    return () => undefined;
  }
  const channel = new BroadcastChannel(REVISION_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (isRevisionNotice(event.data)) {
      onRevision(event.data.revision);
    }
  };
  return () => {
    channel.close();
  };
}

import { ioRecord } from "./io-messages.js";

/** One in-flight frame, bounded wait, abort rejects the outstanding request. */
export function createIoChannel(port: MessagePort, signal: AbortSignal) {
  let sequence = 0;
  let busy = false;
  port.start();
  return async (body: Readonly<Record<string, unknown>>): Promise<unknown> => {
    signal.throwIfAborted();
    if (busy) throw new Error("IO channel already has an outstanding frame");
    busy = true;
    const seq = sequence++;
    try {
      return await new Promise((resolve, reject) => {
        const finish = (error?: Error, value?: unknown) => {
          clearTimeout(timer);
          port.removeEventListener("message", receive);
          port.removeEventListener("messageerror", malformed);
          signal.removeEventListener("abort", aborted);
          if (error === undefined) resolve(value); else reject(error);
        };
        const receive = (event: MessageEvent<unknown>) => {
          try {
            const data = ioRecord(event.data);
            if (data["seq"] !== seq || data["ioVersion"] !== 1 || data["ok"] !== true) throw new Error("IO frame refused");
            finish(undefined, data["value"]);
          } catch { finish(new Error("IO frame refused")); }
        };
        const malformed = () => { finish(new Error("invalid IO frame")); };
        const aborted = () => { finish(new Error("IO cancelled")); };
        const timer = setTimeout(() => { finish(new Error("IO timed out")); }, 60_000);
        port.addEventListener("message", receive);
        port.addEventListener("messageerror", malformed);
        signal.addEventListener("abort", aborted, { once: true });
        try { port.postMessage({ ioVersion: 1, seq, ...body }); }
        catch { finish(new Error("IO send failed")); }
      });
    } finally { busy = false; }
  };
}

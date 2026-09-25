import type { FileSavePort } from "../application/ports/file-save.js";

interface WritableFile {
  write(blob: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
export type SavePickerV1 = (options: { suggestedName: string }) => Promise<{
  createWritable(): Promise<WritableFile>;
}>;

/** No writable handle escapes this invocation or survives cancellation. */
export function createFileSavePort(picker: SavePickerV1 | undefined =
  (globalThis as typeof globalThis & { showSaveFilePicker?: SavePickerV1 }).showSaveFilePicker): FileSavePort {
  return { async save(blob, signal) {
    // A preparation error must remain handled even while the picker is open.
    const prepared = blob.then((value) => ({ value }), (error: unknown) => ({ error }));
    if (signal.aborted) return "cancelled";
    if (picker === undefined) {
      let url: string | undefined;
      let anchor: HTMLAnchorElement | undefined;
      try {
        const result = await untilAbort(prepared, signal);
        signal.throwIfAborted();
        if ("error" in result) throw result.error;
        url = URL.createObjectURL(result.value);
        anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "backup.sheaf";
        anchor.hidden = true;
        document.body.append(anchor);
        anchor.click();
        // Let the browser consume the URL before releasing the delivery resource.
        await untilAbort(new Promise<void>((resolve) => { setTimeout(resolve, 0); }), signal);
        signal.throwIfAborted();
        return "unconfirmed";
      } catch {
        return signal.aborted ? "cancelled" : "failed";
      } finally {
        anchor?.remove();
        if (url !== undefined) URL.revokeObjectURL(url);
      }
    }
    let writable: WritableFile | undefined;
    let closed = false;
    const abort = () => { void writable?.abort().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      const handle = await untilAbort(picker.call(globalThis, { suggestedName: "backup.sheaf" }), signal);
      signal.throwIfAborted();
      const result = await untilAbort(prepared, signal);
      signal.throwIfAborted();
      if ("error" in result) throw result.error;
      const stream = await untilAbort(handle.createWritable().then(async (stream) => {
        if (signal.aborted) { await stream.abort(); signal.throwIfAborted(); }
        return stream;
      }), signal);
      writable = stream;
      signal.throwIfAborted();
      await untilAbort(stream.write(result.value), signal);
      signal.throwIfAborted();
      await untilAbort(stream.close(), signal);
      closed = true;
      signal.throwIfAborted();
      return "saved";
    } catch (cause) {
      return signal.aborted || (cause instanceof DOMException && cause.name === "AbortError") ? "cancelled" : "failed";
    } finally {
      signal.removeEventListener("abort", abort);
      if (!closed && writable !== undefined) void writable.abort().catch(() => undefined);
      writable = undefined;
    }
  } };
}

function untilAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => { reject(new DOMException("Save cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    void work.then(resolve, reject).finally(() => { signal.removeEventListener("abort", abort); });
    if (signal.aborted) abort();
  });
}

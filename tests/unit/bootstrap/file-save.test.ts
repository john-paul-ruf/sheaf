import { describe, expect, it, vi } from "vitest";
import { createFileSavePort, type SavePickerV1 } from "../../../src/platform/file-save.js";

const signal = () => new AbortController().signal;
function destination() {
  const stream = { write: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined), abort: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };
  const createWritable = vi.fn().mockResolvedValue(stream);
  const picker: SavePickerV1 = vi.fn().mockResolvedValue({ createWritable });
  return { stream, picker, createWritable };
}

describe("native observable save", () => {
  it("opens synchronously during the gesture and confirms only after close", async () => {
    const target = destination();
    let supply!: (blob: Blob) => void;
    const file = new Blob(["ciphertext"]);
    const task = createFileSavePort(target.picker).save(new Promise((resolve) => { supply = resolve; }), signal());
    expect(target.picker).toHaveBeenCalledOnce();
    expect(target.createWritable).not.toHaveBeenCalled();
    supply(file);
    expect(await task).toBe("saved");
    expect(target.stream.write).toHaveBeenCalledWith(file);
    expect(target.stream.close).toHaveBeenCalledOnce();
    expect(target.stream.abort).not.toHaveBeenCalled();
  });
  it.each(["write", "close"] as const)("does not confirm a %s failure", async (method) => {
    const target = destination();
    target.stream[method].mockRejectedValue(new Error("disk full"));
    expect(await createFileSavePort(target.picker).save(Promise.resolve(new Blob()), signal())).toBe("failed");
    expect(target.stream.abort).toHaveBeenCalled();
  });
  it("distinguishes picker cancellation from failure", async () => {
    const cancelled: SavePickerV1 = () => Promise.reject(new DOMException("cancelled", "AbortError"));
    expect(await createFileSavePort(cancelled).save(Promise.resolve(new Blob()), signal())).toBe("cancelled");
    const failed: SavePickerV1 = () => Promise.reject(new Error("denied"));
    expect(await createFileSavePort(failed).save(Promise.resolve(new Blob()), signal())).toBe("failed");
  });
  it("does not invent fallback confirmation", async () => {
    expect(await createFileSavePort().save(Promise.resolve(new Blob()), signal())).toBe("unconfirmed");
  });
  it("lock stops a pending picker and a pending write", async () => {
    const controller = new AbortController();
    const target = destination();
    target.stream.write.mockImplementation(() => new Promise(() => undefined));
    const pending = createFileSavePort(target.picker).save(Promise.resolve(new Blob()), controller.signal);
    await vi.waitFor(() => { expect(target.stream.write).toHaveBeenCalled(); });
    controller.abort();
    expect(await pending).toBe("cancelled");
    expect(target.stream.abort).toHaveBeenCalled();
    const second = new AbortController();
    const picker: SavePickerV1 = () => new Promise(() => undefined);
    const picking = createFileSavePort(picker).save(Promise.resolve(new Blob()), second.signal);
    second.abort();
    expect(await picking).toBe("cancelled");
  });
  it("a rejected preparation never opens a writable destination", async () => {
    const target = destination();
    expect(await createFileSavePort(target.picker).save(Promise.reject(new Error("bad graph")), signal())).toBe("failed");
    expect(target.createWritable).not.toHaveBeenCalled();
  });
});

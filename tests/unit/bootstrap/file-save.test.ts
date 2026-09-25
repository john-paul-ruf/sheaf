import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileSavePort, type SavePickerV1 } from "../../../src/platform/file-save.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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
  it("delivers verified bytes before returning unconfirmed and releases delivery resources", async () => {
    let supply!: (blob: Blob) => void;
    const create = vi.fn(() => "blob:verified");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe("backup.sheaf");
      expect(this.href).toBe("blob:verified");
    });
    const pending = createFileSavePort().save(new Promise((resolve) => { supply = resolve; }), signal());
    expect(click).not.toHaveBeenCalled();
    const blob = new Blob(["verified ciphertext"]);
    supply(blob);
    expect(await pending).toBe("unconfirmed");
    expect(create).toHaveBeenCalledWith(blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:verified");
    expect(document.querySelector("a[download]")).toBeNull();
  });
  it("never delivers a rejected preparation", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    expect(await createFileSavePort().save(Promise.reject(new Error("invalid artifact")), signal())).toBe("failed");
    expect(click).not.toHaveBeenCalled();
  });
  it("cleans up after delivery throws and does not confirm", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:verified", revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("delivery refused"); });
    expect(await createFileSavePort().save(Promise.resolve(new Blob()), signal())).toBe("failed");
    expect(revoke).toHaveBeenCalledWith("blob:verified");
    expect(document.querySelector("a[download]")).toBeNull();
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

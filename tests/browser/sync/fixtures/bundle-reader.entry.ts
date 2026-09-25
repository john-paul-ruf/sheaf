const worker = new Worker(new URL("./bundle-reader.worker.ts", import.meta.url), { type: "module" });
Object.assign(window, { readBundle: (bytes: number[], secret: { kind: "passphrase" | "recovery"; value: string }) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { worker.terminate(); reject(new Error("artifact reader timed out")); }, 90_000);
  worker.onmessage = ({ data }: MessageEvent<{ ok: boolean; result?: unknown }>) => {
    clearTimeout(timer);
    if (data.ok) resolve(data.result); else reject(new Error("artifact rejected"));
  };
  worker.onerror = () => { clearTimeout(timer); reject(new Error("artifact worker failed")); };
  worker.postMessage({ bytes, secret });
}) });
addEventListener("pagehide", () => { worker.terminate(); }, { once: true });

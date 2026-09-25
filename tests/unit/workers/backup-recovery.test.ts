import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { ask, createTestHandler, importDemoApp, resetLocalDatabase, realEntropy } from "./data-worker.js";
import { envelopeCryptoAdapter, envelopeStoreAdapter } from "../../../src/workers/data/import-handlers.js";
import { createVaultCrypto } from "../../../src/crypto/vault-port.js";
import { decodeDomainId } from "../../../src/domain/model/ids.js";
import { encodeBase64Url } from "../../../src/domain/model/bytes.js";
import { sha256Chunks } from "../../../src/crypto/hash.js";
import { buildPublicationCandidate, readPublicationCandidate, readPublicationObject } from "../../../src/sync/protocol/publication.js";
import { bundleChunks } from "../../../src/sync/providers/bundle/format.js";
import { openBundle } from "../../../src/sync/providers/bundle/reader.js";
import { recoverBackupGraph } from "../../../src/workers/data/backup-graph.js";
import { decodeCanonical, type CborValue } from "../../../src/persistence/codecs/canonical-cbor.js";

it("recovers every current authored branch from vault-only bytes, rejects incomplete artifacts and destroys decoder keys", async () => {
  await resetLocalDatabase();
  const worker = createTestHandler().handler;
  const vaultCrypto = createVaultCrypto(realEntropy);
  const ports = { crypto: envelopeCryptoAdapter, vaultCrypto, entropy: realEntropy, hashChunks: sha256Chunks };
  const signal = new AbortController().signal;
  const passphrase = "artifact cedar lantern river";
  try {
    const local = await ask(worker, { kind: "setup", passphrase: "device copper heron meadow" });
    const appId = await importDemoApp(worker);
    const assigned = await worker.backup.createBundleHome(appId, "Artifact", passphrase);
    const structure = (await ask(worker, { kind: "getAppStructure", appId })).structure!;
    const jobs = structure.tables.find((table) => table.displayName === "Jobs")!;
    const status = jobs.fields.find((field) => field.displayName === "Status")!.fieldId;
    const change = { kind: "rename-table" as const, tableId: jobs.tableId, name: "Recovered jobs" };
    const preview = (await ask(worker, { kind: "previewSchemaChange", appId, change })).preview!;
    expect((await ask(worker, { kind: "applySchemaChange", appId, change, previewedSchemaRevision: preview.schemaRevision })).outcome.result).toBe("applied");
    expect((await ask(worker, { kind: "changeTheme", appId, themeKey: "indigo", mode: "dark", density: "compact", customAccent: null, logo: { kind: "keep" } })).outcome.result).toBe("changed");
    expect((await ask(worker, { kind: "saveChart", appId, chartId: null, expectedRevision: null, definition: {
      name: "Recovered chart", tableId: jobs.tableId, filters: [], pinned: true, type: "bar",
      groupBy: { kind: "field", fieldId: status }, seriesBy: null, measure: { kind: "count" }, sort: "category",
    } })).outcome.result).toBe("saved");
    const pin = await worker.backup.pin(appId);
    const exported = await worker.backup.exportGraph(assigned.homeId, pin.operationId, signal);
    const state = await worker.backup.read(assigned.homeId);
    const vaultKey = await vaultCrypto.openWithPassphrase(passphrase, decodeDomainId("vault", assigned.vaultId), state.secrets.passphraseKdf, state.secrets.passphraseWrappedVaultKey);
    let artifact: Blob;
    const incomplete: Blob[] = [];
    let expectedHash: Uint8Array;
    try {
      const candidate = await buildPublicationCandidate({ base: { kind: "create", secrets: state.secrets },
        vaultId: decodeDomainId("vault", assigned.vaultId), homeId: decodeDomainId("home", assigned.homeId),
        appKey: exported.appKey, vaultKey, graph: exported.graph, app: { displayName: "Artifact", appSchemaRevision: 2n }, committedAtMs: 1000n,
      }, ports, signal);
      const contents = readPublicationCandidate(candidate);
      expectedHash = contents.manifest.semanticSha256;
      const assemble = async (omit?: string) => {
        const parts: BlobPart[] = [];
        for await (const bytes of bundleChunks({ ...contents, objects: contents.objects.filter(({ id }) => id !== omit),
          read: (id, readSignal) => readPublicationObject(candidate, id, readSignal) }, signal)) parts.push(bytes as Uint8Array<ArrayBuffer>);
        return new Blob(parts);
      };
      artifact = await assemble();
      for (const kind of ["app.record-page", "app.baseline-page", "app.source-chunk", "app.snapshot-chunk", "app.event-segment"] as const) {
        const object = exported.graph.objects.find((entry) => entry.payloadKind === kind)!;
        expect(object, kind).toBeDefined();
        incomplete.push(await assemble(encodeBase64Url(object.reference.storageId)));
      }
    } finally { vaultCrypto.destroy(vaultKey); exported.dispose(); }
    worker.dispose(); await resetLocalDatabase();
    const noLocalReads = vi.spyOn(envelopeStoreAdapter, "getEnvelope").mockRejectedValue(new Error("decoder touched local storage"));
    try {
      for (const secret of [{ kind: "passphrase" as const, value: passphrase }, { kind: "recovery" as const, value: assigned.recoveryCode }]) {
        const controller = new AbortController();
        const bundle = await openBundle(artifact, secret, ports, controller.signal);
        const app = await bundle.openApp(decodeDomainId("app", appId));
        try {
          const graph = await recoverBackupGraph(ports.crypto, app, controller.signal);
          expect(await sha256Chunks(graph.canonicalAuthoredState(signal))).toEqual(expectedHash);
          expect(graph.manifest.confirmedFrontier).toEqual(app.manifest.confirmedFrontier);
          const parts: number[] = [];
          for await (const bytes of graph.canonicalAuthoredState(signal)) parts.push(...bytes);
          const authored = decodeCanonical(Uint8Array.from(parts)) as ReadonlyMap<string, CborValue>;
          for (const name of ["fields", "tables", "charts", "sheets", "baselines", "lineages", "records"]) expect((authored.get(name) as readonly CborValue[]).length, name).toBeGreaterThan(0);
          expect(JSON.stringify(authored.get("tables"), (_, value: unknown) => typeof value === "bigint" ? String(value) : value)).toContain("Recovered jobs");
          const appRow = (authored.get("app") as readonly (readonly CborValue[])[])[0]!;
          const theme = decodeCanonical(appRow[4] as Uint8Array) as ReadonlyMap<string, CborValue>;
          expect(theme.get("themeKey")).toBe("indigo"); expect(theme.get("mode")).toBe("dark");
          expect(JSON.stringify(authored.get("charts"), (_, value: unknown) => typeof value === "bigint" ? String(value) : value)).toContain("Recovered chart");
          await expect(recoverBackupGraph(ports.crypto, { ...app, manifest: { ...app.manifest, semanticSha256: new Uint8Array(32) } }, signal)).rejects.toThrow("mismatch");
          await expect(recoverBackupGraph(ports.crypto, { ...app, manifest: { ...app.manifest, baselinePages: [] } }, signal)).rejects.toThrow("mismatch");
          const checkpointFrame = await app.readFrame(app.manifest.checkpoint.storageId);
          controller.abort();
          await expect(app.read(app.manifest.checkpoint, "app.checkpoint-manifest")).rejects.toThrow();
          await expect(ports.crypto.open(checkpointFrame, "app.checkpoint", app.appKey, "app.checkpoint-manifest")).rejects.toThrow();
        } finally { bundle.close(); bundle.close(); }
      }
      for (const broken of [...incomplete, artifact.slice(0, artifact.size - 1)]) {
        await expect((async () => {
          const bundle = await openBundle(broken, { kind: "passphrase", value: passphrase }, ports, signal);
          try { await recoverBackupGraph(ports.crypto, await bundle.openApp(decodeDomainId("app", appId)), signal); }
          finally { bundle.close(); }
        })()).rejects.toThrow();
      }
      await expect(openBundle(artifact, { kind: "recovery", value: local.recoveryCode }, ports, signal)).rejects.toThrow();
      expect(noLocalReads).not.toHaveBeenCalled();
    } finally { noLocalReads.mockRestore(); }
  } finally { worker.dispose(); await resetLocalDatabase(); }
}, 120_000);

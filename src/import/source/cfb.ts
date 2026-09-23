/**
 * The bounded Compound File Binary reader (M13; invariant 8, FR-3).
 *
 * Legacy `.xls` workbooks and encrypted OOXML packages are CFB files: a small
 * FAT file system inside one file. Every structure in it is a pointer the file
 * controls, so every walk here is bounded and loop-checked:
 *
 * - the DIFAT, FAT, mini-FAT and every stream's sector chain are walked with a
 *   visited set; revisiting a sector is `directory-loop`, and no chain may be
 *   longer than {@link CONTAINER_BOUNDS_V1.maxCfbSectorChain} or than the file
 *   has sectors;
 * - the directory red-black tree is walked iteratively (never recursively)
 *   with a visited set, and holds at most `maxCfbDirectoryEntries` entries;
 * - a stream's chain must be exactly as long as its declared size needs.
 *
 * Opening reads the header, the FAT and the directory — never stream data.
 * An encrypted OOXML package is identified here ({@link requireUnencrypted})
 * so pre-flight can refuse it by name.
 */

import {
  BoundExceededError,
  CONTAINER_BOUNDS_V1,
  type ContainerBoundsV1,
} from "./bounds.js";
import type { RandomAccessSource } from "./source.js";

export interface CfbStreamInfoV1 {
  /** Storage names joined with `/`, the root storage omitted. */
  readonly path: string;
  readonly size: number;
}

export interface CfbHandleV1 {
  listStreams(): readonly CfbStreamInfoV1[];
  /** Directory names compare case-insensitively, as CFB specifies. */
  has(path: string): boolean;
  readStream(path: string, options: { readonly maxBytes: number }): Promise<Uint8Array>;
  streamStream(path: string): AsyncIterable<Uint8Array>;
  /** True when this is an encrypted OOXML package (`EncryptedPackage`). */
  readonly isEncryptedPackage: boolean;
}

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const HEADER_BYTES = 512;
const HEADER_DIFAT_ENTRIES = 109;
const DIRECTORY_ENTRY_BYTES = 128;
const MINI_SECTOR_BYTES = 64;
const MINI_STREAM_CUTOFF = 4096;
const MAX_REGULAR_SECTOR = 0xfffffffa;
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const NO_STREAM = 0xffffffff;
const TYPE_STORAGE = 1;
const TYPE_STREAM = 2;
const TYPE_ROOT = 5;
const STREAM_READ_BYTES = 65_536;

function fail(detail: BoundExceededError["detail"]): never {
  throw new BoundExceededError(detail);
}

const u16 = (bytes: Uint8Array, at: number): number =>
  (bytes[at] as number) | ((bytes[at + 1] as number) << 8);

const u32 = (bytes: Uint8Array, at: number): number =>
  (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;

interface DirectoryEntry {
  readonly name: string;
  readonly type: number;
  readonly left: number;
  readonly right: number;
  readonly child: number;
  readonly start: number;
  readonly size: number;
}

const readExactly = async (
  source: RandomAccessSource,
  offset: number,
  length: number,
): Promise<Uint8Array> => {
  if (offset + length > source.byteLength) {
    fail("truncated-container");
  }
  const bytes = await source.slice(offset, length);
  if (bytes.byteLength !== length) {
    fail("truncated-container");
  }
  return bytes;
};

const upper = (path: string): string => path.toUpperCase();

/**
 * Opens a CFB file by reading its header, FAT, mini-FAT and directory.
 * `bounds` exists so tests can prove each bound with small inputs.
 */
export async function openCfbContainer(
  source: RandomAccessSource,
  bounds: ContainerBoundsV1 = CONTAINER_BOUNDS_V1,
): Promise<CfbHandleV1> {
  const header = await readExactly(source, 0, HEADER_BYTES);
  if (!CFB_SIGNATURE.every((byte, index) => header[index] === byte)) {
    fail("unrecognized-content");
  }
  const sectorShift = u16(header, 30);
  if (u16(header, 28) !== 0xfffe || (sectorShift !== 9 && sectorShift !== 12)) {
    fail("malformed-structure");
  }
  if (u16(header, 32) !== 6 || u32(header, 56) !== MINI_STREAM_CUTOFF) {
    fail("malformed-structure");
  }
  const sectorSize = 1 << sectorShift;
  const perSector = sectorSize / 4;
  const sectorCount = Math.max(0, Math.floor((source.byteLength - sectorSize) / sectorSize));
  const fatSectorCount = u32(header, 44);
  if (fatSectorCount > sectorCount) {
    fail("malformed-structure");
  }

  const readSector = (sector: number): Promise<Uint8Array> => {
    if (sector > MAX_REGULAR_SECTOR) {
      fail("malformed-structure");
    }
    if (sector >= sectorCount) {
      fail("truncated-container");
    }
    return readExactly(source, (sector + 1) * sectorSize, sectorSize);
  };

  // DIFAT: the first 109 FAT sector numbers live in the header, the rest in a
  // chain of DIFAT sectors whose last slot points at the next one.
  const fatSectors: number[] = [];
  for (let index = 0; index < Math.min(fatSectorCount, HEADER_DIFAT_ENTRIES); index += 1) {
    fatSectors.push(u32(header, 76 + index * 4));
  }
  const seenDifat = new Set<number>();
  let difatSector = u32(header, 68);
  while (fatSectors.length < fatSectorCount) {
    if (difatSector === END_OF_CHAIN || difatSector === FREE_SECTOR) {
      fail("malformed-structure");
    }
    if (seenDifat.has(difatSector)) {
      fail("directory-loop");
    }
    seenDifat.add(difatSector);
    const difat = await readSector(difatSector);
    for (let slot = 0; slot < perSector - 1 && fatSectors.length < fatSectorCount; slot += 1) {
      fatSectors.push(u32(difat, slot * 4));
    }
    difatSector = u32(difat, (perSector - 1) * 4);
  }

  const fat = new Uint32Array(fatSectorCount * perSector);
  for (const [index, sector] of fatSectors.entries()) {
    const bytes = await readSector(sector);
    for (let slot = 0; slot < perSector; slot += 1) {
      fat[index * perSector + slot] = u32(bytes, slot * 4);
    }
  }

  /**
   * A whole chain, loop-checked and bounded. `extent` is how many sectors the
   * chain may address: pointing past it means the file ends too soon.
   */
  const chainOf = (start: number, table: Uint32Array, extent: number): number[] => {
    const chain: number[] = [];
    const seen = new Set<number>();
    let sector = start;
    while (sector !== END_OF_CHAIN) {
      if (sector >= table.length || chain.length >= bounds.maxCfbSectorChain) {
        fail("malformed-structure");
      }
      if (sector >= extent) {
        fail("truncated-container");
      }
      if (seen.has(sector)) {
        fail("directory-loop");
      }
      seen.add(sector);
      chain.push(sector);
      sector = table[sector] as number;
    }
    return chain;
  };

  const directorySectors = chainOf(u32(header, 48), fat, sectorCount);
  if (directorySectors.length * (sectorSize / DIRECTORY_ENTRY_BYTES) > bounds.maxCfbDirectoryEntries) {
    fail("expansion-limit");
  }
  const entries: DirectoryEntry[] = [];
  for (const sector of directorySectors) {
    const bytes = await readSector(sector);
    for (let at = 0; at < sectorSize; at += DIRECTORY_ENTRY_BYTES) {
      // The stored length counts the terminating NUL; 31 UTF-16 units at most.
      const nameLength = Math.min(Math.max(0, Math.floor(u16(bytes, at + 64) / 2) - 1), 31);
      const nameUnits: number[] = [];
      for (let unit = 0; unit < nameLength; unit += 1) {
        nameUnits.push(u16(bytes, at + unit * 2));
      }
      const highSize = u32(bytes, at + 124);
      entries.push({
        name: String.fromCharCode(...nameUnits).replace(/\u0000+$/, ""),
        type: bytes[at + 66] as number,
        left: u32(bytes, at + 68),
        right: u32(bytes, at + 72),
        child: u32(bytes, at + 76),
        start: u32(bytes, at + 116),
        size: sectorShift === 9 ? u32(bytes, at + 120) : u32(bytes, at + 120) + highSize * 0x1_0000_0000,
      });
    }
  }
  const root = entries[0] ?? fail("malformed-structure");
  if (root.type !== TYPE_ROOT) {
    fail("malformed-structure");
  }

  const streams = new Map<string, DirectoryEntry & { readonly path: string }>();
  const visited = new Set<number>([0]);
  const pending: { id: number; parent: string }[] = [{ id: root.child, parent: "" }];
  while (pending.length > 0) {
    const { id, parent } = pending.pop() as { id: number; parent: string };
    if (id === NO_STREAM) {
      continue;
    }
    const entry = entries[id];
    if (entry === undefined) {
      fail("malformed-structure");
    }
    if (visited.has(id)) {
      fail("directory-loop");
    }
    visited.add(id);
    pending.push({ id: entry.left, parent }, { id: entry.right, parent });
    const path = parent === "" ? entry.name : `${parent}/${entry.name}`;
    if (entry.type === TYPE_STORAGE) {
      pending.push({ id: entry.child, parent: path });
    } else if (entry.type === TYPE_STREAM) {
      if (entry.size > source.byteLength) {
        fail("truncated-container");
      }
      streams.set(upper(path), { ...entry, path });
    } else {
      fail("malformed-structure");
    }
  }

  const needsMiniStream = [...streams.values()].some(
    (entry) => entry.size > 0 && entry.size < MINI_STREAM_CUTOFF,
  );
  let miniFat = new Uint32Array(0);
  let miniStreamSectors: number[] = [];
  if (needsMiniStream) {
    const miniFatSectors = chainOf(u32(header, 60), fat, sectorCount);
    miniFat = new Uint32Array(miniFatSectors.length * perSector);
    for (const [index, sector] of miniFatSectors.entries()) {
      const bytes = await readSector(sector);
      for (let slot = 0; slot < perSector; slot += 1) {
        miniFat[index * perSector + slot] = u32(bytes, slot * 4);
      }
    }
    miniStreamSectors = chainOf(root.start, fat, sectorCount);
    if (miniStreamSectors.length * sectorSize < root.size) {
      fail("malformed-structure");
    }
  }

  const lookup = (path: string) => streams.get(upper(path)) ?? fail("malformed-structure");

  async function* streamStream(path: string): AsyncGenerator<Uint8Array, void, undefined> {
    const entry = lookup(path);
    if (entry.size === 0) {
      return;
    }
    if (entry.size < MINI_STREAM_CUTOFF) {
      const miniChain = chainOf(entry.start, miniFat, Math.ceil(root.size / MINI_SECTOR_BYTES));
      if (miniChain.length !== Math.ceil(entry.size / MINI_SECTOR_BYTES)) {
        fail("malformed-structure");
      }
      let remaining = entry.size;
      for (const mini of miniChain) {
        const offset = mini * MINI_SECTOR_BYTES;
        const container = miniStreamSectors[Math.floor(offset / sectorSize)];
        if (container === undefined || offset + MINI_SECTOR_BYTES > root.size) {
          fail("malformed-structure");
        }
        const length = Math.min(MINI_SECTOR_BYTES, remaining);
        yield await readExactly(
          source,
          (container + 1) * sectorSize + (offset % sectorSize),
          length,
        );
        remaining -= length;
      }
      return;
    }

    const chain = chainOf(entry.start, fat, sectorCount);
    if (chain.length !== Math.ceil(entry.size / sectorSize)) {
      fail("malformed-structure");
    }
    let remaining = entry.size;
    let index = 0;
    while (index < chain.length) {
      // Coalesce physically consecutive sectors into one bounded read.
      const first = chain[index] as number;
      let run = 1;
      while (
        index + run < chain.length &&
        chain[index + run] === first + run &&
        (run + 1) * sectorSize <= STREAM_READ_BYTES
      ) {
        run += 1;
      }
      const length = Math.min(run * sectorSize, remaining);
      yield await readExactly(source, (first + 1) * sectorSize, length);
      remaining -= length;
      index += run;
    }
  }

  const isEncryptedPackage =
    streams.has(upper("EncryptedPackage")) || streams.has(upper("EncryptionInfo"));

  return {
    listStreams: () =>
      [...streams.values()].map(({ path, size }) => ({ path, size })),
    has: (path) => streams.has(upper(path)),
    async readStream(path, { maxBytes }) {
      const entry = lookup(path);
      if (entry.size > maxBytes) {
        fail("expansion-limit");
      }
      const bytes = new Uint8Array(entry.size);
      let at = 0;
      for await (const chunk of streamStream(path)) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
      }
      return bytes;
    },
    streamStream,
    isEncryptedPackage,
  };
}

/** Refuses an encrypted OOXML package by name; Sheaf never decrypts it. */
export function requireUnencrypted(handle: CfbHandleV1): void {
  if (handle.isEncryptedPackage) {
    fail("encrypted-workbook");
  }
}

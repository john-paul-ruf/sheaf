/**
 * A deterministic Compound File Binary writer (version 3, 512-byte sectors)
 * for the workbook corpus (M58). F03 S01 writes encrypted-package and loop
 * fixtures with it; S04 reuses it for BIFF workbooks.
 *
 * Streams under 4096 bytes go to the mini stream, as the format requires.
 * Siblings are linked as a right-leaning chain — a valid (if unbalanced)
 * directory tree. The hostile options write exactly the structures a reader
 * must refuse: a directory cycle, a sector-chain cycle, a declared size that
 * disagrees with its chain.
 */

export interface CfbStreamSpec {
  /** Storage names joined with `/`. */
  readonly path: string;
  readonly data: Uint8Array;
}

export interface CfbWriteOptions {
  /** The last sibling under the root points back at the first. */
  readonly directoryLoop?: boolean;
  /** This stream's last FAT slot points back at its first sector. */
  readonly chainLoopPath?: string;
  /** Declared sizes written instead of the true ones. */
  readonly declaredSizes?: Readonly<Record<string, number>>;
}

const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;
const NO_STREAM = 0xffffffff;

interface Node {
  readonly name: string;
  readonly type: 1 | 2 | 5;
  readonly children: Node[];
  readonly stream?: CfbStreamSpec;
  id: number;
  start: number;
  size: number;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const writeCfb = (
  streams: readonly CfbStreamSpec[],
  options: CfbWriteOptions = {},
): Uint8Array => {
  const root: Node = { name: "Root Entry", type: 5, children: [], id: 0, start: END_OF_CHAIN, size: 0 };
  for (const stream of streams) {
    let parent = root;
    const segments = stream.path.split("/");
    for (const [index, segment] of segments.entries()) {
      const isLeaf = index === segments.length - 1;
      let child = parent.children.find((node) => node.name === segment);
      if (child === undefined) {
        child = isLeaf
          ? { name: segment, type: 2, children: [], stream, id: 0, start: END_OF_CHAIN, size: stream.data.length }
          : { name: segment, type: 1, children: [], id: 0, start: 0, size: 0 };
        parent.children.push(child);
      }
      parent = child;
    }
  }
  const nodes: Node[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift() as Node;
    node.id = nodes.length;
    nodes.push(node);
    queue.push(...node.children);
  }

  const small = nodes.filter((node) => node.stream !== undefined && node.stream.data.length > 0 && node.stream.data.length < CUTOFF);
  const large = nodes.filter((node) => node.stream !== undefined && node.stream.data.length >= CUTOFF);
  const miniSectors = small.reduce((sum, node) => sum + Math.ceil(node.size / MINI), 0);
  const miniStreamBytes = miniSectors * MINI;

  const directorySectors = Math.ceil((nodes.length * 128) / SECTOR);
  const miniFatSectors = Math.ceil((miniSectors * 4) / SECTOR);
  const miniStreamSectors = Math.ceil(miniStreamBytes / SECTOR);
  const streamSectors = large.map((node) => Math.ceil(node.size / SECTOR));
  const payloadSectors = directorySectors + miniFatSectors + miniStreamSectors + streamSectors.reduce((a, b) => a + b, 0);
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < payloadSectors + fatSectors) fatSectors += 1;
  if (fatSectors > 109) {
    throw new Error("cfb-writer writes at most 109 FAT sectors");
  }

  const total = fatSectors + payloadSectors;
  const fat = new Array<number>(fatSectors * (SECTOR / 4)).fill(FREE);
  for (let sector = 0; sector < fatSectors; sector += 1) fat[sector] = FAT_SECTOR;
  let next = fatSectors;
  const allocate = (count: number): number => {
    if (count === 0) return END_OF_CHAIN;
    const start = next;
    for (let index = 0; index < count; index += 1) {
      fat[start + index] = index === count - 1 ? END_OF_CHAIN : start + index + 1;
    }
    next += count;
    return start;
  };
  const directoryStart = allocate(directorySectors);
  const miniFatStart = allocate(miniFatSectors);
  root.start = allocate(miniStreamSectors);
  root.size = miniStreamBytes;
  for (const [index, node] of large.entries()) {
    node.start = allocate(streamSectors[index] as number);
  }

  const bytes = new Uint8Array((total + 1) * SECTOR);
  const at = (sector: number): number => (sector + 1) * SECTOR;

  const miniFat = new Array<number>(miniFatSectors * (SECTOR / 4)).fill(FREE);
  let mini = 0;
  for (const node of small) {
    const count = Math.ceil(node.size / MINI);
    node.start = mini;
    for (let index = 0; index < count; index += 1) {
      miniFat[mini + index] = index === count - 1 ? END_OF_CHAIN : mini + index + 1;
      const offset = (mini + index) * MINI;
      const target = at(root.start + Math.floor(offset / SECTOR)) + (offset % SECTOR);
      bytes.set((node.stream as CfbStreamSpec).data.subarray(index * MINI, (index + 1) * MINI), target);
    }
    mini += count;
  }
  for (const node of large) {
    bytes.set((node.stream as CfbStreamSpec).data, at(node.start));
  }

  const loopPath = options.chainLoopPath;
  if (loopPath !== undefined) {
    const node = nodes.find((candidate) => candidate.stream?.path === loopPath);
    if (node === undefined) throw new Error(`no stream ${loopPath}`);
    if (node.size >= CUTOFF) {
      let sector = node.start;
      while (fat[sector] !== END_OF_CHAIN) sector = fat[sector] as number;
      fat[sector] = node.start;
    } else {
      let sector = node.start;
      while (miniFat[sector] !== END_OF_CHAIN) sector = miniFat[sector] as number;
      miniFat[sector] = node.start;
    }
  }

  const header = view(bytes);
  bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  header.setUint16(24, 0x3e, true);
  header.setUint16(26, 3, true);
  header.setUint16(28, 0xfffe, true);
  header.setUint16(30, 9, true);
  header.setUint16(32, 6, true);
  header.setUint32(44, fatSectors, true);
  header.setUint32(48, directoryStart, true);
  header.setUint32(56, CUTOFF, true);
  header.setUint32(60, miniFatSectors === 0 ? END_OF_CHAIN : miniFatStart, true);
  header.setUint32(64, miniFatSectors, true);
  header.setUint32(68, END_OF_CHAIN, true);
  header.setUint32(72, 0, true);
  for (let index = 0; index < 109; index += 1) {
    header.setUint32(76 + index * 4, index < fatSectors ? index : FREE, true);
  }
  const words = view(bytes);
  fat.forEach((value, index) => words.setUint32(at(Math.floor(index / 128)) + (index % 128) * 4, value, true));
  miniFat.forEach((value, index) => words.setUint32(at(miniFatStart + Math.floor(index / 128)) + (index % 128) * 4, value, true));

  const entries = view(bytes);
  const directoryOffset = (id: number): number => at(directoryStart + Math.floor((id * 128) / SECTOR)) + ((id * 128) % SECTOR);
  for (let id = 0; id < directorySectors * (SECTOR / 128); id += 1) {
    const offset = directoryOffset(id);
    entries.setUint32(offset + 68, NO_STREAM, true);
    entries.setUint32(offset + 72, NO_STREAM, true);
    entries.setUint32(offset + 76, NO_STREAM, true);
  }
  for (const node of nodes) {
    const offset = directoryOffset(node.id);
    const name = node.name.slice(0, 31);
    for (let index = 0; index < name.length; index += 1) {
      entries.setUint16(offset + index * 2, name.charCodeAt(index), true);
    }
    entries.setUint16(offset + 64, (name.length + 1) * 2, true);
    bytes[offset + 66] = node.type;
    bytes[offset + 67] = 1;
    const firstChild = node.children[0];
    entries.setUint32(offset + 76, firstChild === undefined ? NO_STREAM : firstChild.id, true);
    node.children.forEach((child, index) => {
      const sibling = node.children[index + 1];
      entries.setUint32(directoryOffset(child.id) + 72, sibling === undefined ? NO_STREAM : sibling.id, true);
    });
    entries.setUint32(offset + 116, node.type === 1 ? 0 : node.start, true);
    const declared = node.stream === undefined ? undefined : options.declaredSizes?.[node.stream.path];
    entries.setUint32(offset + 120, declared ?? node.size, true);
  }
  if (options.directoryLoop === true) {
    const first = root.children[0];
    const last = root.children.at(-1);
    if (first === undefined || last === undefined) throw new Error("no root children to loop");
    entries.setUint32(directoryOffset(last.id) + 72, first.id, true);
  }
  return bytes;
};

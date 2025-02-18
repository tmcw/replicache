import {Chunk} from '../dag/mod';
import type {Entry} from './mod';
import {stringCompare} from './string-compare';
import {assertArray, assertNotNull, assertString} from '../asserts';
import {assertJSONValue} from '../json';
import * as flatbuffers from 'flatbuffers';
import {Leaf as LeafFB} from './generated/leaf/leaf';
import * as utf8 from '../utf8';

export class Leaf {
  private _chunk: Chunk<Entry[]> | undefined;
  readonly entries: Entry[];

  constructor(entries: Entry[]) {
    this.entries = entries;
  }

  static load(chunk: Chunk): Leaf {
    // Validate at load-time so we can assume data is valid thereafter.
    let entries: Entry[];
    const data = chunk.data;
    if (data instanceof Uint8Array) {
      entries = getEntriesFromFlatbuffer(data);
    } else {
      // Assert that the shape/type is correct
      assertEntries(data);
      entries = data;
    }

    // But also assert that entries is sorted and has no duplicate keys.
    const seen = new Set();
    for (let i = 0; i < entries.length - 1; i++) {
      const entry = entries[i];
      const next = entries[i + 1];
      if (entry[0] === next[0] || seen.has(entry[0])) {
        throw new Error('duplicate key');
      }
      if (entry[0] > next[0]) {
        throw new Error('unsorted key');
      }
      seen.add(entry[0]);
    }
    return new Leaf(entries);
  }

  get chunk(): Chunk<Entry[]> {
    if (this._chunk === undefined) {
      this._chunk = Chunk.new(this.entries, []);
    }
    return this._chunk;
  }

  [Symbol.iterator](): IterableIterator<Entry> {
    return this.entries.values();
  }

  binarySearch(key: string): {found: boolean; index: number} {
    const entries = this.entries;
    let size = entries.length;
    if (size === 0) {
      return {found: false, index: 0};
    }
    let base = 0;

    while (size > 1) {
      const half = Math.floor(size / 2);
      const mid = base + half;
      // mid is always in [0, size), that means mid is >= 0 and < size.
      // mid >= 0: by definition
      // mid < size: mid = size / 2 + size / 4 + size / 8 ...
      const entry = entries[mid];
      // No way that key can be None.
      const cmp = stringCompare(entry[0], key);
      base = cmp > 0 ? base : mid;
      size -= half;
    }
    // base is always in [0, size) because base <= mid.
    const entry = entries[base];
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const cmp = stringCompare(entry[0], key);
    if (cmp === 0) {
      return {found: true, index: base};
    }
    return {found: false, index: base + cmp};
  }
}

function assertEntry(v: unknown): asserts v is Entry {
  assertArray(v);
  if (v.length !== 2) {
    throw new Error('Invalid entry length');
  }
  assertString(v[0]);
  assertJSONValue(v[1]);
}

function assertEntries(v: unknown): asserts v is Entry[] {
  assertArray(v);
  for (const e of v) {
    assertEntry(e);
  }
}

export function getEntriesFromFlatbuffer(data: Uint8Array): Entry[] {
  const buf = new flatbuffers.ByteBuffer(data);
  const root = LeafFB.getRootAsLeaf(buf);
  const entries: Entry[] = [];
  for (let i = 0; i < root.entriesLength(); i++) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const entry = root.entries(i)!;
    const keyArray = entry.keyArray();
    assertNotNull(keyArray);
    const key = utf8.decode(keyArray);
    const valArray = entry.valArray();
    assertNotNull(valArray);
    const val = JSON.parse(utf8.decode(valArray));
    entries.push([key, val]);
  }
  return entries;
}

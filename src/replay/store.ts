// Where the tracks are kept: in the browser's IndexedDB, which holds far more
// than the localStorage the logbook lives in, gzipped. Each one under the
// number of its jump in the logbook and the time it went in, so that a track
// is never shown for another jump of the same number (after the logbook was
// cleared). Only the last ones are kept.

import { decodeTrack, encodeTrack, type Track } from './track';

// Still named after the project's first name: renaming it would lose the
// tracks already kept in every browser.
const DB = 'jumpsim';
const STORE = 'tracks';
/** The tracks kept, the oldest going first: some 100 to 300 kB each. */
export const MAX_TRACKS = 50;

/** A track's key: its jump's number, and when it was logged (ms since 1970). */
type Key = [n: number, time: number];

let db: Promise<IDBDatabase | null> | null = null;

/** The database, opened once; null where the browser has none (private browsing, some tests). */
function open(): Promise<IDBDatabase | null> {
  db ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T | null> {
  try {
    const base = await open();
    if (!base) return null;
    return await work(base.transaction(STORE, mode).objectStore(STORE));
  } catch {
    return null;
  }
}

async function pipe(bytes: Uint8Array, through: GenericTransformStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(through);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const gzipped = (b: Uint8Array): boolean => b[0] === 0x1f && b[1] === 0x8b;

/** Keeps the track of a jump, and lets the oldest go beyond MAX_TRACKS. */
export async function saveTrack(track: Track): Promise<void> {
  const raw = encodeTrack(track);
  const bytes = typeof CompressionStream === 'undefined' ? raw : await pipe(raw, new CompressionStream('gzip'));
  const key: Key = [track.meta.n, track.meta.time];
  await run('readwrite', async (store) => {
    await done(store.put(bytes, key));
    const keys = (await done(store.getAllKeys())) as Key[];
    keys.sort((a, b) => a[1] - b[1]);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_TRACKS))) store.delete(old);
  });
}

/** The track of a jump of the logbook, if it was kept. */
export async function loadTrack(n: number, time: number): Promise<Track | null> {
  const stored = await run('readonly', (store) => done(store.get([n, time] satisfies Key)));
  if (!(stored instanceof Uint8Array)) return null;
  try {
    const bytes = gzipped(stored) && typeof DecompressionStream !== 'undefined' ? await pipe(stored, new DecompressionStream('gzip')) : stored;
    return decodeTrack(bytes);
  } catch {
    return null;
  }
}

/** The jumps that have a track: their number and log time, as `${n}:${time}`. */
export async function storedTracks(): Promise<Set<string>> {
  const keys = (await run('readonly', (store) => done(store.getAllKeys()))) as Key[] | null;
  return new Set((keys ?? []).filter(Array.isArray).map(([n, time]) => trackId(n, time)));
}

export const trackId = (n: number, time: number): string => `${n}:${time}`;

export async function clearTracks(): Promise<void> {
  await run('readwrite', (store) => done(store.clear()));
}

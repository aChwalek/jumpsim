import { describe, expect, it } from 'vitest';
import { ROOM_NAME } from '../src/net/protocol';
import {
  LOAD_EVERY_MS,
  RoomState,
  bestOffset,
  clockSample,
  cleanName,
  nextLoad,
  publicDz,
  publicRoom,
  readRoomMessage,
  sameShared,
  sharedPart,
} from '../src/net/room';
import { defaultSetup } from '../src/setup';
import { DZS } from '../src/world/dzs';

describe('room state', () => {
  const room = (): RoomState => {
    const r = new RoomState();
    r.welcome({ id: 'b', joined: 200 }, [{ id: 'a', joined: 100 }, { id: 'c', joined: 300 }], 'Bea', false);
    return r;
  };

  it('is led by the first one in, then the next one when they go', () => {
    const r = room();
    expect(r.host?.id).toBe('a');
    expect(r.isHost).toBe(false);
    r.leave('a');
    expect(r.host?.id).toBe('b');
    expect(r.isHost).toBe(true);
  });

  it('settles a tie on the id', () => {
    const r = new RoomState();
    r.welcome({ id: 'z', joined: 100 }, [{ id: 'y', joined: 100 }], 'Zoe', false);
    expect(r.host?.id).toBe('y');
  });

  it('gives each a seat in the plane by the order they came, whoever is ready', () => {
    const r = room();
    expect(r.seat).toBe(1);
    r.hello('a', 'Ana', true);
    expect(r.seat).toBe(1);
    r.leave('a');
    expect(r.seat).toBe(0);
  });

  it('lists the players in the order they came', () => {
    expect(room().list.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('is all ready only when everyone says so, and nobody is once it starts', () => {
    const r = room();
    r.hello('a', 'Ana', true);
    r.self!.ready = true;
    expect(r.allReady).toBe(false);
    expect(r.readyCount).toBe(2);
    r.hello('c', 'Cy', true);
    expect(r.allReady).toBe(true);
    r.started();
    expect(r.readyCount).toBe(0);
  });

  it('ignores a hello from someone it does not know', () => {
    const r = room();
    r.hello('x', 'Xavier', true);
    expect(r.players.has('x')).toBe(false);
  });

  it('forgets everyone it knew when welcomed again', () => {
    const r = room();
    r.welcome({ id: 'd', joined: 400 }, [], 'Dan', false);
    expect(r.list.map((p) => p.id)).toEqual(['d']);
    expect(r.isHost).toBe(true);
  });
});

describe('room messages', () => {
  it('reads a hello, and keeps a name on one short line', () => {
    expect(readRoomMessage({ kind: 'hello', name: '  Ana\n\tde   la Tour du Pin et des Bois ', ready: true })).toEqual({
      kind: 'hello',
      name: 'Ana de la Tour du Pi',
      ready: true,
    });
    expect(readRoomMessage({ kind: 'hello', name: 3, ready: true })).toBeNull();
  });

  it('brings a setup back to a valid one, without the gear', () => {
    const m = readRoomMessage({ kind: 'setup', setup: { dz: 'pujaut', hour: 99, weather: { windKmh: -5 }, gear: { kind: 'triCell' } } });
    expect(m?.kind).toBe('setup');
    if (m?.kind !== 'setup') return;
    expect(m.setup.dz).toBe('pujaut');
    expect(m.setup.hour).toBeLessThanOrEqual(24);
    expect(m.setup.weather.windKmh).toBe(0);
    expect('gear' in m.setup).toBe(false);
  });

  it('turns away a start from nowhere and what it does not know', () => {
    expect(readRoomMessage({ kind: 'start', start: 'moon', setup: {} })).toBeNull();
    expect(readRoomMessage({ kind: 'start', start: 'plane', setup: {} })?.kind).toBe('start');
    expect(readRoomMessage({ kind: 'kick' })).toBeNull();
    expect(readRoomMessage(null)).toBeNull();
  });

  it('carries when the load left, if it says', () => {
    expect(readRoomMessage({ kind: 'start', start: 'plane', setup: {}, at: 1_700_000_000_123 })).toMatchObject({ at: 1_700_000_000_123 });
    for (const at of [undefined, 'soon', Number.NaN]) expect(readRoomMessage({ kind: 'start', start: 'plane', setup: {}, at })).not.toHaveProperty('at');
  });
});

describe('the room clock', () => {
  it('takes the server to have answered halfway through the trip', () => {
    // Ours says 1000 when asked, 1100 when answered; the server said 50 400 in between.
    expect(clockSample(1000, 50_400, 1100)).toEqual({ trip: 100, offset: 49_350 });
  });

  it('goes by the quickest trip, the least thrown off by a slow way one way', () => {
    // The truth: the server 49 350 ahead. A trip slow on the way back alone throws the slow one off by 100.
    const samples = [clockSample(0, 49_350 + 30, 60), clockSample(1000, 50_350 + 30, 1260), clockSample(2000, 51_350 + 10, 2020)];
    expect(bestOffset(samples)).toBe(49_350);
    expect(bestOffset([])).toBeNull();
  });
});

describe('shared setup', () => {
  it('leaves the gear out, and compares the rest', () => {
    const a = defaultSetup();
    const b = defaultSetup();
    b.gear.canopyAreaFt2 = 96;
    expect(sameShared(sharedPart(a), sharedPart(b))).toBe(true);
    b.weather.windKmh += 5;
    expect(sameShared(sharedPart(a), sharedPart(b))).toBe(false);
  });

  it('cleans names', () => {
    expect(cleanName('  a   b ')).toBe('a b');
  });
});

describe('public rooms', () => {
  it('has one for each drop zone, a valid room name, and back', () => {
    for (const { id } of DZS) {
      const room = publicRoom(id);
      expect(ROOM_NAME.test(room)).toBe(true);
      expect(publicDz(room)).toBe(id);
    }
  });

  it('is not for a private room', () => {
    expect(publicDz('saut-abc234')).toBeNull();
    expect(publicDz('dz-nowhere')).toBeNull();
  });
});

describe('loads', () => {
  it('leave on the clock, the next one after now', () => {
    expect(nextLoad(0)).toBe(LOAD_EVERY_MS);
    expect(nextLoad(LOAD_EVERY_MS - 1)).toBe(LOAD_EVERY_MS);
    expect(nextLoad(LOAD_EVERY_MS)).toBe(2 * LOAD_EVERY_MS);
    expect(nextLoad(5 * LOAD_EVERY_MS + 123)).toBe(6 * LOAD_EVERY_MS);
  });
});
